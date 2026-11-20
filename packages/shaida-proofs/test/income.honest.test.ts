import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { buildIncomeBundle, type IncomeBundleWitness, INCOME_SLOTS, type Result } from "../src/index.js";
import { endSnarkjs, r1csHolds, runCircuit } from "./helpers/circuit.js";
import { buildSingleProof, honestRequest, makeScenario, Rng } from "./helpers/scenario.js";

after(endSnarkjs);

function built<T>(r: Result<T>): T {
  if (!r.ok) assert.fail(`builder refused: ${r.error.code}: ${r.error.message}`);
  return r.value;
}

describe("income circuit: honest proofs (C2)", () => {
  it("H1 accepts one vouched, swept payment at exactly the threshold", async () => {
    const rng = new Rng(101);
    const s = makeScenario(rng, { payments: 1, noise: 2 });
    const w = built(buildSingleProof(honestRequest(s, rng, { threshold: s.payments[0]!.amount })));
    assert.equal(w.publicSignals.count, 1n);
    assert.deepEqual((await runCircuit(w.input)).accepted, true);
    assert.equal(await r1csHolds(w.input), true, "every R1CS constraint holds");
  });

  it("H2 accepts three payments from different payers among other people's leaves, and a sub-period of two", async () => {
    const rng = new Rng(202);
    const s = makeScenario(rng, { payments: 3, noise: 4 });
    const total = s.payments.reduce((a, p) => a + p.amount, 0n);
    const all = built(buildSingleProof(honestRequest(s, rng, { threshold: total / 2n })));
    assert.equal(all.publicSignals.count, 3n);
    assert.equal((await runCircuit(all.input)).accepted, true);

    const [, second, third] = [...s.vouchIndex].sort((a, b) => a - b);
    const sub = built(
      buildSingleProof(honestRequest(s, rng, { fromIndex: BigInt(second!), toIndex: BigInt(third!) })),
    );
    assert.equal(sub.publicSignals.count, 2n);
    assert.deepEqual(sub.skipped.map((x) => x.reason), ["outOfRange"]);
    assert.equal((await runCircuit(sub.input)).accepted, true);
  });

  it("accepts the full 4-slot case", async () => {
    const rng = new Rng(808);
    const s = makeScenario(rng, { payments: INCOME_SLOTS, noise: 1 });
    const w = built(buildSingleProof(honestRequest(s, rng)));
    assert.equal(w.publicSignals.count, 4n);
    assert.equal((await runCircuit(w.input)).accepted, true);
    assert.equal(await r1csHolds(w.input), true);
  });
});

/** Every proof of a bundle is accepted, ranges tile the period, and the shares add up (D12). */
async function assertHonestBundle(b: IncomeBundleWitness, from: bigint, to: bigint, threshold: bigint): Promise<void> {
  const ps = b.proofs.map((p) => p.publicSignals);
  assert.equal(ps[0]!.fromIndex, from, "the first proof starts the period");
  assert.equal(ps.at(-1)!.toIndex, to, "the last proof ends it");
  for (let k = 1; k < ps.length; k++) assert.equal(ps[k]!.fromIndex, ps[k - 1]!.toIndex + 1n, `proof ${k + 1} starts after ${k}`);
  assert.equal(ps.reduce((a, p) => a + p.threshold, 0n), threshold, "Σ thresholds = the asked threshold");
  assert.equal(ps.reduce((a, p) => a + p.count, 0n), b.count, "Σ counts = payments counted");
  assert.equal(new Set(ps.map((p) => p.context)).size, 1, "one context");
  for (const [k, p] of b.proofs.entries()) {
    assert.ok(p.counted.length <= INCOME_SLOTS);
    const sum = p.counted.reduce((a, c) => a + c.amount, 0n);
    assert.ok(p.publicSignals.threshold <= sum, `proof ${k + 1}: share ≤ its sum`);
    for (const c of p.counted) {
      assert.ok(BigInt(c.vouchIndex) >= p.publicSignals.fromIndex && BigInt(c.vouchIndex) <= p.publicSignals.toIndex);
    }
    assert.equal((await runCircuit(p.input)).accepted, true, `proof ${k + 1} accepted`);
  }
}

describe("witness builder: bundles over disjoint ranges (D12)", () => {
  for (const [payments, sizes] of [[5, [4, 1]], [9, [4, 4, 1]], [12, [4, 4, 4]]] as const) {
    it(`splits ${payments} payments into proofs of ${sizes.join(" + ")}`, async () => {
      const rng = new Rng(500 + payments);
      const s = makeScenario(rng, { payments, noise: 2 });
      const total = s.payments.reduce((a, p) => a + p.amount, 0n);
      const req = honestRequest(s, rng, { threshold: (total * 9n) / 10n });
      const b = built(buildIncomeBundle(req));
      assert.deepEqual(b.proofs.map((p) => p.counted.length), [...sizes]);
      await assertHonestBundle(b, req.fromIndex, req.toIndex, req.threshold);
    });
  }

  it("splits a threshold equal to the total into each proof's exact sum", async () => {
    const rng = new Rng(77);
    const s = makeScenario(rng, { payments: 6 });
    const total = s.payments.reduce((a, p) => a + p.amount, 0n);
    const req = honestRequest(s, rng, { threshold: total });
    const b = built(buildIncomeBundle(req));
    for (const p of b.proofs) assert.equal(p.publicSignals.threshold, p.counted.reduce((a, c) => a + c.amount, 0n));
    await assertHonestBundle(b, req.fromIndex, req.toIndex, total);
  });

  it("builds the largest bundle: 32 payments in 8 proofs", () => {
    const rng = new Rng(3232);
    const s = makeScenario(rng, { payments: 32, noise: 0 });
    const b = built(buildIncomeBundle(honestRequest(s, rng)));
    assert.equal(b.proofs.length, 8);
    assert.equal(b.count, 32n);
  });
});

describe("witness builder: named refusals (PRD §4, D10)", () => {
  it("NotEnoughSlots: refuses 33 payments in one period (more than 8 proofs of 4)", () => {
    const rng = new Rng(909);
    const s = makeScenario(rng, { payments: 33, noise: 0 });
    const r = buildIncomeBundle(honestRequest(s, rng));
    assert.equal(r.ok ? "built" : r.error.code, "NotEnoughSlots");
  });

  it("NoSweptPayments: zero payments in the period", () => {
    const rng = new Rng(1);
    const s = makeScenario(rng, { payments: 2 });
    const beyond = BigInt(s.leaves.length + 10);
    const r = buildSingleProof(honestRequest(s, rng, { fromIndex: beyond, toIndex: beyond }));
    assert.equal(r.ok ? "built" : r.error.code, "NoSweptPayments");
  });

  it("BelowThreshold: refuses a threshold above the swept total", () => {
    const rng = new Rng(2);
    const s = makeScenario(rng, { payments: 2 });
    const total = s.payments.reduce((a, p) => a + p.amount, 0n);
    const r = buildSingleProof(honestRequest(s, rng, { threshold: total + 1n }));
    assert.equal(r.ok ? "built" : r.error.code, "BelowThreshold");
  });

  it("UnknownRoot: refuses leaves that do not give the checked root (incomplete sync)", () => {
    const rng = new Rng(3);
    const s = makeScenario(rng, { payments: 2 });
    const r = buildSingleProof(honestRequest(s, rng, { ledgerLeaves: s.leaves.slice(0, -1) }));
    assert.equal(r.ok ? "built" : r.error.code, "UnknownRoot");
    assert.equal(r.ok ? undefined : r.error.retryable, "yes");
  });

  it("InputRejected: refuses an amount of 2^64, a zero sweep secret, reversed range and unknown keys", () => {
    const rng = new Rng(4);
    const s = makeScenario(rng, { payments: 1 });
    const p = s.payments[0]!;
    const cases = [
      { payments: [{ ...p, amount: 1n << 64n }] },
      { payments: [{ ...p, secretS: 0n }] },
      { fromIndex: 5n, toIndex: 4n },
      { extra: 1 },
    ];
    for (const c of cases) {
      const r = buildSingleProof(honestRequest(s, rng, c));
      assert.equal(r.ok ? "built" : r.error.code, "InputRejected", JSON.stringify(Object.keys(c)));
    }
  });

  it("X04 counts a payment listed twice once", () => {
    const rng = new Rng(5);
    const s = makeScenario(rng, { payments: 1 });
    const w = built(buildSingleProof(honestRequest(s, rng, { payments: [s.payments[0], s.payments[0]] })));
    assert.equal(w.publicSignals.count, 1n);
    assert.deepEqual(w.skipped, [{ record: 1, reason: "duplicate" }]);
  });

  it("X08 skips a vouched payment that was never swept, X07 one with no V leaf", () => {
    const rng = new Rng(6);
    const s = makeScenario(rng, { payments: 3, unswept: [1], unvouched: [2] });
    const w = built(buildSingleProof(honestRequest(s, rng)));
    assert.equal(w.publicSignals.count, 1n);
    assert.deepEqual(w.skipped, [
      { record: 1, reason: "notSwept" },
      { record: 2, reason: "notVouched" },
    ]);
  });
});
