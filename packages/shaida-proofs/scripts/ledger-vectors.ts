// Fixed ShaidaLedger vectors: two payments by payer id 1, vouched then swept (V1, V2, S1, S2). The JS test proves
// an income witness over these leaves (circuit hashes = JS hashes); contracts/test/IncomeVectors.t.sol replays them
// through the real ShaidaLedger (contract leaves and roots = JS). Test-only secrets from a fixed seed.
import { LedgerTree, noteCommitment, nullifierOf, type PaymentRecord, sweepLeaf, TUSD8_FIELD, vouchLeaf } from "../src/index";
import { Rng } from "../test/helpers/scenario";

export const VECTORS_SEED = 44005;

const hex32 = (v: bigint) => `0x${v.toString(16).padStart(64, "0")}`;

export function ledgerVectors() {
  const rng = new Rng(VECTORS_SEED);
  const payerId = 1n; // PayerRegistry ids start at 1
  const records: PaymentRecord[] = [3_000_000n, 1_250_000n].map((amount) => ({
    secretP: rng.field(),
    amount,
    payerId,
    secretS: rng.field(),
    amountS: amount,
  }));
  const notes = records.map((r) => {
    const cp = noteCommitment(r.secretP, r.amount, TUSD8_FIELD);
    const nullifier = nullifierOf(r.secretP, cp);
    const cs = noteCommitment(r.secretS, r.amountS, TUSD8_FIELD);
    return { cp, nullifier, cs, vLeaf: vouchLeaf(payerId, cp), sLeaf: sweepLeaf(nullifier, cs) };
  });
  const events = [
    { kind: "vouchedPay", note: 0 },
    { kind: "vouchedPay", note: 1 },
    { kind: "sweep", note: 0 },
    { kind: "sweep", note: 1 },
  ] as const;
  const leaves: bigint[] = [];
  const roots: bigint[] = [];
  for (const e of events) {
    const n = notes[e.note]!;
    leaves.push(e.kind === "vouchedPay" ? n.vLeaf : n.sLeaf);
    roots.push(new LedgerTree(leaves).root);
  }
  const json = {
    generatedBy: "pnpm --filter @shaida/proofs vectors (packages/shaida-proofs/scripts/gen-ledger-vectors.ts)",
    asset: hex32(TUSD8_FIELD),
    payerId: Number(payerId),
    emptyRoot: hex32(new LedgerTree([]).root),
    eventKinds: events.map((e) => e.kind),
    eventNotes: events.map((e) => e.note),
    paymentCommitments: notes.map((n) => hex32(n.cp)),
    nullifiers: notes.map((n) => hex32(n.nullifier)),
    sweepCommitments: notes.map((n) => hex32(n.cs)),
    leaves: leaves.map(hex32),
    roots: roots.map(hex32),
  };
  return { records, leaves, root: roots[roots.length - 1]!, json };
}
