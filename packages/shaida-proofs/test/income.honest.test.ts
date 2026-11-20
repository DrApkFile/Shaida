import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { buildIncomeWitness, type IncomeWitness, type Result } from "../src/index.js";
import { endSnarkjs, r1csHolds, runCircuit } from "./helpers/circuit.js";
import { honestRequest, makeScenario, Rng } from "./helpers/scenario.js";

after(endSnarkjs);

function built(r: Result<IncomeWitness>): IncomeWitness {
  if (!r.ok) assert.fail(`builder refused: ${r.error.code}: ${r.error.message}`);
  return r.value;
}

describe("income circuit: honest proofs (C2)", () => {
  it("H1 accepts one vouched, swept payment at exactly the threshold", async () => {
    const rng = new Rng(101);
    const s = makeScenario(rng, { payments: 1, noise: 2 });
    const w = built(buildIncomeWitness(honestRequest(s, rng, { threshold: s.payments[0]!.amount })));
    assert.equal(w.publicSignals.count, 1n);
    assert.deepEqual((await runCircuit(w.input)).accepted, true);
    assert.equal(await r1csHolds(w.input), true, "every R1CS constraint holds");
  });

  it("H2 accepts three payments from different payers among other people's leaves, and a sub-period of two", async () => {
    const rng = new Rng(202);
    const s = makeScenario(rng, { payments: 3, noise: 4 });
    const total = s.payments.reduce((a, p) => a + p.amount, 0n);
    const all = built(buildIncomeWitness(honestRequest(s, rng, { threshold: total / 2n })));
    assert.equal(all.publicSignals.count, 3n);
    assert.equal((await runCircuit(all.input)).accepted, true);

    const [, second, third] = [...s.vouchIndex].sort((a, b) => a - b);
    const sub = built(
      buildIncomeWitness(honestRequest(s, rng, { fromIndex: BigInt(second!), toIndex: BigInt(third!) })),
    );
    assert.equal(sub.publicSignals.count, 2n);
    assert.deepEqual(sub.skipped.map((x) => x.reason), ["outOfRange"]);
    assert.equal((await runCircuit(sub.input)).accepted, true);
  });

  it("accepts the full 8-slot case", async () => {
    const rng = new Rng(808);
    const s = makeScenario(rng, { payments: 8, noise: 1 });
    const w = built(buildIncomeWitness(honestRequest(s, rng)));
    assert.equal(w.publicSignals.count, 8n);
    assert.equal((await runCircuit(w.input)).accepted, true);
    assert.equal(await r1csHolds(w.input), true);
  });
});

describe("witness builder: named refusals (PRD §4, D10)", () => {
  it("NotEnoughSlots: refuses 9 payments in one period", () => {
    const rng = new Rng(909);
    const s = makeScenario(rng, { payments: 9, noise: 0 });
    const r = buildIncomeWitness(honestRequest(s, rng));
    assert.equal(r.ok ? "built" : r.error.code, "NotEnoughSlots");
  });

  it("NoSweptPayments: zero payments in the period", () => {
    const rng = new Rng(1);
    const s = makeScenario(rng, { payments: 2 });
    const beyond = BigInt(s.leaves.length + 10);
    const r = buildIncomeWitness(honestRequest(s, rng, { fromIndex: beyond, toIndex: beyond }));
    assert.equal(r.ok ? "built" : r.error.code, "NoSweptPayments");
  });

  it("BelowThreshold: refuses a threshold above the swept total", () => {
    const rng = new Rng(2);
    const s = makeScenario(rng, { payments: 2 });
    const total = s.payments.reduce((a, p) => a + p.amount, 0n);
    const r = buildIncomeWitness(honestRequest(s, rng, { threshold: total + 1n }));
    assert.equal(r.ok ? "built" : r.error.code, "BelowThreshold");
  });

  it("UnknownRoot: refuses leaves that do not give the checked root (incomplete sync)", () => {
    const rng = new Rng(3);
    const s = makeScenario(rng, { payments: 2 });
    const r = buildIncomeWitness(honestRequest(s, rng, { ledgerLeaves: s.leaves.slice(0, -1) }));
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
      const r = buildIncomeWitness(honestRequest(s, rng, c));
      assert.equal(r.ok ? "built" : r.error.code, "InputRejected", JSON.stringify(Object.keys(c)));
    }
  });

  it("X04 counts a payment listed twice once", () => {
    const rng = new Rng(5);
    const s = makeScenario(rng, { payments: 1 });
    const w = built(buildIncomeWitness(honestRequest(s, rng, { payments: [s.payments[0], s.payments[0]] })));
    assert.equal(w.publicSignals.count, 1n);
    assert.deepEqual(w.skipped, [{ record: 1, reason: "duplicate" }]);
  });

  it("X08 skips a vouched payment that was never swept, X07 one with no V leaf", () => {
    const rng = new Rng(6);
    const s = makeScenario(rng, { payments: 3, unswept: [1], unvouched: [2] });
    const w = built(buildIncomeWitness(honestRequest(s, rng)));
    assert.equal(w.publicSignals.count, 1n);
    assert.deepEqual(w.skipped, [
      { record: 1, reason: "notSwept" },
      { record: 2, reason: "notVouched" },
    ]);
  });
});
