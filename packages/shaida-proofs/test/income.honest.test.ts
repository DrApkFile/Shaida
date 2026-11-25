import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { buildIncomeBundle, type IncomeBundleWitness, INCOME_SLOTS, type Result, SHARE_STEP } from "../src/index";
import { endSnarkjs, r1csHolds, runCircuit } from "./helpers/circuit";
import { buildSingleProof, honestRequest, makeScenario, Rng, roundDown, showableThreshold } from "./helpers/scenario";

after(endSnarkjs);

function built<T>(r: Result<T>): T {
  if (!r.ok) assert.fail(`builder refused: ${r.error.code}: ${r.error.message}`);
  return r.value;
}

describe("income circuit: honest proofs (C2)", () => {
  it("H1 accepts one vouched, swept payment at exactly the threshold", async () => {
    const rng = new Rng(101);
    const s = makeScenario(rng, { payments: 1, noise: 2, amounts: [7_000_000n] });
    const w = built(buildSingleProof(honestRequest(s, rng, { threshold: 7_000_000n })));
    assert.equal(w.publicSignals.threshold, 7_000_000n);
    assert.equal(w.publicSignals.count, 1n);
    assert.deepEqual((await runCircuit(w.input)).accepted, true);
    assert.equal(await r1csHolds(w.input), true, "every R1CS constraint holds");
  });

  it("H2 accepts three payments from different payers among other people's leaves, and a sub-period of two", async () => {
    const rng = new Rng(202);
    const s = makeScenario(rng, { payments: 3, noise: 4 });
    const total = s.payments.reduce((a, p) => a + p.amount, 0n);
    const all = built(buildSingleProof(honestRequest(s, rng, { threshold: roundDown(total / 2n) })));
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

  it("F4 counts a split-swept payment at its full amount: the sweep note holds 1 of 2 tUSD8, the proof shows ≥ 2", async () => {
    const rng = new Rng(404);
    const s = makeScenario(rng, { payments: 1, noise: 2, amounts: [2_000_000n], sweptAmounts: [1_000_000n] });
    const w = built(buildSingleProof(honestRequest(s, rng, { threshold: 2_000_000n })));
    assert.equal(w.publicSignals.threshold, 2_000_000n);
    assert.equal((await runCircuit(w.input)).accepted, true);
    assert.equal(await r1csHolds(w.input), true);
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
      const base = honestRequest(s, rng);
      const req = { ...base, threshold: roundDown((showableThreshold(base) * 9n) / 10n) };
      const b = built(buildIncomeBundle(req));
      assert.deepEqual(b.proofs.map((p) => p.counted.length), [...sizes]);
      await assertHonestBundle(b, req.fromIndex, req.toIndex, req.threshold);
    });
  }

  it("C3 splits the largest showable threshold into each proof's sum rounded down to whole tUSD8", async () => {
    const rng = new Rng(77);
    const s = makeScenario(rng, { payments: 6 });
    const base = honestRequest(s, rng);
    const req = { ...base, threshold: showableThreshold(base) };
    const b = built(buildIncomeBundle(req));
    for (const p of b.proofs) {
      assert.equal(p.publicSignals.threshold, roundDown(p.counted.reduce((a, c) => a + c.amount, 0n)));
    }
    await assertHonestBundle(b, req.fromIndex, req.toIndex, req.threshold);
  });

  it("C3 rounds shares to a coarser step when asked (5 tUSD8): a capped share shows its sum only to 5 tUSD8", () => {
    const step = 5_000_000n;
    const amounts = [3_100_000n, 4_200_000n, 2_300_000n, 1_400_000n, 9_900_000n]; // chunks 11.0 and 9.9 tUSD8
    const rng = new Rng(78);
    const s = makeScenario(rng, { payments: 5, amounts, noise: 1 });
    const b = built(buildIncomeBundle(honestRequest(s, rng, { threshold: 15_000_000n, shareStep: step })));
    const shares = b.proofs.map((p) => p.publicSignals.threshold);
    assert.deepEqual(shares, [10_000_000n, 5_000_000n], "11.0 → 10, 9.9 → 5: both capped, both rounded down to 5");
    const r = buildIncomeBundle(honestRequest(s, rng, { threshold: 16_000_000n, shareStep: step }));
    assert.equal(r.ok ? "built" : r.error.code, "InputRejected", "a threshold that is not a multiple of the step");
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
    const r = buildSingleProof(honestRequest(s, rng, { threshold: roundDown(total) + SHARE_STEP }));
    assert.equal(r.ok ? "built" : r.error.code, "BelowThreshold");
  });

  it("BelowThreshold: refuses a threshold the payments reach only before rounding each proof's share (D13)", () => {
    // chunks of 4 × 0.6 and 1 × 0.6 tUSD8: 3.0 in total, but whole-tUSD8 shares can show only 2 + 0
    const rng = new Rng(22);
    const s = makeScenario(rng, { payments: 5, amounts: Array(5).fill(600_000n), noise: 1 });
    const r = buildIncomeBundle(honestRequest(s, rng, { threshold: 3_000_000n }));
    assert.equal(r.ok ? "built" : r.error.code, "BelowThreshold");
    assert.match(r.ok ? "" : r.error.message, /at most 2000000/);
    assert.equal(buildIncomeBundle(honestRequest(s, rng, { threshold: 2_000_000n })).ok, true);
  });

  it("UnknownRoot: refuses leaves that do not give the checked root (incomplete sync)", () => {
    const rng = new Rng(3);
    const s = makeScenario(rng, { payments: 2 });
    const r = buildSingleProof(honestRequest(s, rng, { ledgerLeaves: s.leaves.slice(0, -1) }));
    assert.equal(r.ok ? "built" : r.error.code, "UnknownRoot");
    assert.equal(r.ok ? undefined : r.error.retryable, "yes");
  });

  it("InputRejected: refuses an amount of 2^64, a zero sweep secret, reversed range, unknown keys and off-step thresholds", () => {
    const rng = new Rng(4);
    const s = makeScenario(rng, { payments: 1 });
    const p = s.payments[0]!;
    const cases = [
      { payments: [{ ...p, amount: 1n << 64n }] },
      { payments: [{ ...p, secretS: 0n }] },
      { fromIndex: 5n, toIndex: 4n },
      { extra: 1 },
      { threshold: 1n },
      { threshold: SHARE_STEP + 1n },
      { shareStep: 0n },
      { shareStep: 1_500_000n, threshold: 3_000_000n },
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
