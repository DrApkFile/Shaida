// Property test: random honest scenarios (1–13 payments, so bundles of 1–4 proofs, D12) must build, tile the period
// and be accepted; one random cheat applied to one proof of each must be refused. Every failure is collected with its seed, and the list must be empty.
// PROPERTY_RUNS (default 24) and PROPERTY_SEED (default: random, printed) reproduce a run.
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { describe, it } from "node:test";
import { buildIncomeBundle, type CircuitInput, FIELD_ORDER, type IncomeProofWitness, INCOME_SLOTS, SHARE_STEP } from "../src/index";
import { runCircuit } from "./helpers/circuit";
import { honestRequest, makeScenario, Rng, roundDown, showableThreshold } from "./helpers/scenario";

const RUNS = Number(process.env.PROPERTY_RUNS ?? 24);
const BASE_SEED = process.env.PROPERTY_SEED === undefined ? randomInt(2 ** 31) : Number(process.env.PROPERTY_SEED);

type Arr = string[];
type Mutation = (input: CircuitInput, w: IncomeProofWitness, rng: Rng) => boolean; // false: not applicable

const bump = (input: CircuitInput, key: string, slot: number, by: bigint) => {
  const arr = input[key] as Arr;
  arr[slot] = ((BigInt(arr[slot]!) + by) % FIELD_ORDER).toString();
};
const perSlot = ["used", "secretP", "amount", "payerId", "secretS", "amountS"];
const paths = ["vPathElements", "vPathIndices", "sPathElements", "sPathIndices"];
const n = (w: IncomeProofWitness) => w.counted.length;

const MUTATIONS: Record<string, Mutation> = {
  X06_inflateAmount: (i, w, r) => (bump(i, "amount", r.int(n(w)), 1n + BigInt(r.int(1000))), true),
  X07_fabricateNote: (i, w, r) => ((i.secretP as Arr)[r.int(n(w))] = r.field().toString(), true),
  X09_guessSweepSecret: (i, w, r) => ((i.secretS as Arr)[r.int(n(w))] = r.field().toString(), true),
  otherPayerId: (i, w, r) => (bump(i, "payerId", r.int(n(w)), 1n), true),
  otherSweepAmount: (i, w, r) => (bump(i, "amountS", r.int(n(w)), 1n), true),
  X04_duplicate: (i, w, r) => {
    if (n(w) < 2) return false;
    const j = r.int(n(w) - 1);
    for (const k of [...perSlot, ...paths]) (i[k] as unknown[])[j + 1] = structuredClone((i[k] as unknown[])[j]);
    return true;
  },
  X04_swap: (i, w, r) => {
    if (n(w) < 2) return false;
    const j = r.int(n(w) - 1);
    for (const k of [...perSlot, ...paths]) {
      const a = i[k] as unknown[];
      [a[j], a[j + 1]] = [a[j + 1], a[j]];
    }
    return true;
  },
  X05_fromAfterFirst: (i, w) => ((i.fromIndex = String(w.counted[0]!.vouchIndex + 1)), true),
  X05_toBeforeLast: (i, w) => {
    const last = w.counted[n(w) - 1]!.vouchIndex;
    if (last === 0) return false;
    i.toIndex = String(last - 1);
    return true;
  },
  thresholdAboveTotal: (i, w, r) => {
    const total = w.counted.reduce((a, c) => a + c.amount, 0n);
    i.threshold = String(total + 1n + BigInt(r.int(1000)));
    return true;
  },
  falseCount: (i, w, r) => ((i.count = String(n(w) + (r.int(2) === 0 ? 1 : -1))), true),
  wrongRoot: (i, _w, r) => ((i.ledgerRoot = r.field().toString()), true),
  gap: (i, w, r) => {
    if (n(w) < 2) return false;
    (i.used as Arr)[r.int(n(w) - 1)] = "0";
    i.count = String(n(w) - 1);
    return true;
  },
  zeroPayments: (i) => {
    i.used = (i.used as Arr).map(() => "0");
    i.count = "0";
    i.threshold = "0";
    return true;
  },
};

interface Failure {
  readonly seed: number;
  readonly what: string;
}

describe("income circuit: property over random honest and cheating witnesses", () => {
  it(`accepts every honest witness and refuses every cheat (${RUNS} seeds from ${BASE_SEED})`, async () => {
    console.log(`property: PROPERTY_SEED=${BASE_SEED} PROPERTY_RUNS=${RUNS}`);
    const failures: Failure[] = [];
    const tried: Record<string, number> = {};
    for (let run = 0; run < RUNS; run++) {
      const seed = BASE_SEED + run;
      const rng = new Rng(seed);
      const payments = 1 + rng.int(13); // 1..13: bundles of 1..4 proofs
      const unswept = rng.int(3) === 0 ? [rng.int(payments)] : [];
      const s = makeScenario(rng, { payments, unswept, noise: rng.int(4) });
      const countable = s.payments.filter((_, k) => s.vouchIndex[k]! >= 0 && s.sweepIndex[k]! >= 0);
      const base = honestRequest(s, rng);
      const showable = countable.length === 0 ? 0n : showableThreshold(base);
      const threshold = roundDown((showable * BigInt(rng.int(101))) / 100n);
      const request = { ...base, threshold };
      const r = buildIncomeBundle(request);

      const expected = countable.length === 0 ? "NoSweptPayments" : "ok";
      const got = r.ok ? "ok" : r.error.code;
      if (got !== expected) failures.push({ seed, what: `builder: expected ${expected}, got ${got}` });
      if (!r.ok) continue;
      const b = r.value;
      if (b.counted.length !== countable.length) failures.push({ seed, what: "builder: wrong count" });
      const ps = b.proofs.map((p) => p.publicSignals);
      if (b.proofs.length !== Math.ceil(countable.length / INCOME_SLOTS)) failures.push({ seed, what: "builder: wrong proof count" });
      if (ps[0]!.fromIndex !== request.fromIndex || ps.at(-1)!.toIndex !== request.toIndex) {
        failures.push({ seed, what: "bundle: does not span the period" });
      }
      if (ps.some((p, k) => k > 0 && p.fromIndex !== ps[k - 1]!.toIndex + 1n)) failures.push({ seed, what: "bundle: ranges not contiguous" });
      if (ps.reduce((a, p) => a + p.threshold, 0n) !== threshold) failures.push({ seed, what: "bundle: Σ thresholds ≠ threshold" });
      if (ps.reduce((a, p) => a + p.count, 0n) !== BigInt(countable.length)) failures.push({ seed, what: "bundle: Σ counts wrong" });
      for (const [k, p] of b.proofs.entries()) {
        const sum = p.counted.reduce((a, c) => a + c.amount, 0n);
        const share = p.publicSignals.threshold;
        if (share % SHARE_STEP !== 0n) failures.push({ seed, what: `C3 proof ${k + 1}: share ${share} is not whole tUSD8` });
        if (sum % SHARE_STEP !== 0n && share === sum) failures.push({ seed, what: `C3 proof ${k + 1}: share equals its unrounded sum` });
      }

      for (const [k, p] of b.proofs.entries()) {
        if (!(await runCircuit(p.input)).accepted) failures.push({ seed, what: `honest proof ${k + 1} refused` });
      }

      const w = rng.pick(b.proofs);
      const names = Object.keys(MUTATIONS);
      let name = rng.pick(names);
      const cheat = structuredClone(w.input);
      while (!MUTATIONS[name]!(cheat, w, rng)) name = rng.pick(names);
      tried[name] = (tried[name] ?? 0) + 1;
      const v = await runCircuit(cheat);
      if (v.accepted) failures.push({ seed, what: `cheat ACCEPTED: ${name}` });
    }
    console.log(`property: cheats tried ${JSON.stringify(tried)}`);
    assert.deepEqual(failures, []);
  });
});
