// Cheating witnesses (EVAL_DESIGN C1). Each starts from an honest input and changes what a cheater controls; the
// circuit must refuse it at the constraint meant to stop that cheat.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CircuitInput,
  circuitInput,
  FIELD_ORDER,
    LedgerTree,
} from "../src/index";
import { CONSTRAINT, runCircuit } from "./helpers/circuit";
import { buildSingleProof, honestRequest, makeScenario, Rng, type Scenario, type SingleProof } from "./helpers/scenario";

function honest(seed: number, payments: number, opts: { unswept?: number[] } = {}) {
  const rng = new Rng(seed);
  const s = makeScenario(rng, { payments, ...opts });
  const r = buildSingleProof(honestRequest(s, rng));
  if (!r.ok) assert.fail(`builder refused: ${r.error.code}`);
  return { s, w: r.value, rng };
}

type SlotArray = string[];
const slotKeys = ["used", "secretP", "amount", "payerId", "secretS", "amountS"] as const;
const pathKeys = ["vPathElements", "vPathIndices", "sPathElements", "sPathIndices"] as const;

/** Copies slot `from` over slot `to` (every per-slot input). */
function copySlot(input: CircuitInput, from: number, to: number): void {
  for (const k of slotKeys) (input[k] as SlotArray)[to] = (input[k] as SlotArray)[from]!;
  for (const k of pathKeys) (input[k] as string[][])[to] = [...(input[k] as string[][])[from]!];
}

function swapSlots(input: CircuitInput, a: number, b: number): void {
  for (const k of [...slotKeys, ...pathKeys]) {
    const arr = input[k] as (string | string[])[];
    [arr[a], arr[b]] = [arr[b]!, arr[a]!];
  }
}

async function refusedAt(input: CircuitInput, expectedLine: number, label: string): Promise<void> {
  const v = await runCircuit(input);
  if (v.accepted) assert.fail(`${label}: the circuit ACCEPTED a cheating witness`);
  assert.equal(v.incomeLine, expectedLine, `${label}: refused at income.circom:${v.incomeLine}, want ${expectedLine}`);
}

const vIdx = (w: SingleProof, slot: number) => BigInt(w.counted[slot]!.vouchIndex);

describe("income circuit: cheating witnesses are refused (C1)", () => {
  it("X04 refuses the same payment counted twice", async () => {
    const { w } = honest(41, 2);
    const input = structuredClone(w.input);
    copySlot(input, 0, 1);
    await refusedAt(input, CONSTRAINT.increasing(), "duplicate slot");
  });

  it("X04 refuses payments out of order", async () => {
    const { w } = honest(42, 2);
    const input = structuredClone(w.input);
    swapSlots(input, 0, 1);
    await refusedAt(input, CONSTRAINT.increasing(), "swapped slots");
  });

  it("X05 refuses a payment before fromIndex and one after toIndex", async () => {
    const { w } = honest(51, 2);
    await refusedAt({ ...w.input, fromIndex: String(vIdx(w, 0) + 1n) }, CONSTRAINT.fromBound(), "before from");
    await refusedAt({ ...w.input, toIndex: String(vIdx(w, 1) - 1n) }, CONSTRAINT.toBound(), "after to");
    await refusedAt({ ...w.input, fromIndex: String(1n << 20n) }, CONSTRAINT.fromBits(), "from beyond 2^20");
  });

  it("X06 refuses an inflated amount", async () => {
    const { w } = honest(61, 2);
    const input = structuredClone(w.input);
    (input.amount as SlotArray)[0] = String(BigInt((input.amount as SlotArray)[0]!) + 1n);
    await refusedAt(input, CONSTRAINT.vouchRoot(), "amount + 1");
  });

  it("X07 refuses a fabricated note that is not in the ledger", async () => {
    const { w, rng } = honest(71, 1);
    const input = structuredClone(w.input);
    (input.secretP as SlotArray)[0] = String(rng.field());
    await refusedAt(input, CONSTRAINT.vouchRoot(), "fabricated note");
  });

  it("X08 refuses a vouched payment with no S leaf (never swept, so the payer could claw it back)", async () => {
    const { s, w } = honest(81, 2, { unswept: [1] });
    assert.deepEqual(w.skipped, [{ record: 1, reason: "notSwept" }]);
    const p = s.payments[1]!;
    const anyOtherLeaf = w.counted[0]!.sweepIndex; // a real S leaf, but not this payment's
    const cheat = slotsWithExtra(s, w, {
      ...p,
      used: 1,
      vPath: s.tree.path(s.vouchIndex[1]!),
      sPath: s.tree.path(anyOtherLeaf),
    });
    await refusedAt(cheat, CONSTRAINT.sweepRoot(), "unswept payment");
  });

  it("X09 refuses the payer presenting the recipient's swept payment (cannot open Cs)", async () => {
    const { w, rng } = honest(91, 1);
    const input = structuredClone(w.input);
    (input.secretS as SlotArray)[0] = String(rng.field()); // the payer knows secretP, amount, payerId; not secretS
    await refusedAt(input, CONSTRAINT.sweepRoot(), "payer's guess of secretS");
  });

  it("refuses a zero sweep secret", async () => {
    const { w } = honest(92, 1);
    const input = structuredClone(w.input);
    (input.secretS as SlotArray)[0] = "0";
    await refusedAt(input, CONSTRAINT.secretSNonZero(), "secretS = 0");
  });

  it("refuses a wrong threshold, and one outside 68 bits", async () => {
    const { w } = honest(101, 2);
    const total = w.counted.reduce((a, c) => a + c.amount, 0n);
    await refusedAt({ ...w.input, threshold: String(total + 1n) }, CONSTRAINT.threshold(), "total + 1");
    await refusedAt({ ...w.input, threshold: String(FIELD_ORDER - 1n) }, CONSTRAINT.thresholdBits(), "p - 1");
  });

  it("refuses a false count, above and below", async () => {
    const { w } = honest(111, 2);
    await refusedAt({ ...w.input, count: "3" }, CONSTRAINT.count(), "count 3 of 2");
    await refusedAt({ ...w.input, count: "1" }, CONSTRAINT.count(), "count 1 of 2");
  });

  it("refuses a wrong root: an earlier ledger root and a random one", async () => {
    const { s, w, rng } = honest(121, 2);
    const earlier = new LedgerTree(s.leaves.slice(0, w.counted[1]!.sweepIndex)).root;
    await refusedAt({ ...w.input, ledgerRoot: String(earlier) }, CONSTRAINT.vouchRoot(), "earlier root");
    await refusedAt({ ...w.input, ledgerRoot: String(rng.field()) }, CONSTRAINT.vouchRoot(), "random root");
  });

  it("refuses a gap between used slots", async () => {
    const { w } = honest(131, 3);
    const input = structuredClone(w.input);
    (input.used as SlotArray)[1] = "0";
    await refusedAt({ ...input, count: "2" }, CONSTRAINT.noGap(), "used = 1,0,1");
  });

  it("refuses zero payments", async () => {
    const { w } = honest(141, 1);
    const input = structuredClone(w.input);
    (input.used as SlotArray)[0] = "0";
    await refusedAt({ ...input, count: "0", threshold: "0" }, CONSTRAINT.atLeastOne(), "no used slot");
  });
});

/** The honest slots plus one extra, re-laid out with the same public signals (count + 1). */
function slotsWithExtra(s: Scenario, w: SingleProof, extra: Parameters<typeof circuitInput>[1][number]) {
  const slots = w.counted.map((c) => {
    const p = s.payments[c.record]!;
    return { ...p, used: 1 as const, vPath: s.tree.path(c.vouchIndex), sPath: s.tree.path(c.sweepIndex) };
  });
  return circuitInput({ ...w.publicSignals, count: w.publicSignals.count + 1n }, [...slots, extra]);
}
