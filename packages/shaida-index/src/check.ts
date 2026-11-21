// Client side of the indexer (PRD §8 A7: the indexer may lie). Recomputes both roots from the served leaves,
// recomputes every ledger leaf from its event fields, and asks both contracts isKnownRoot at the snapshot's
// block. Any failure refuses with UnknownRoot; nothing is built on an unchecked tree.
import { LedgerTree, shaidaError, sweepLeaf, vouchLeaf, type Result } from "@shaida/proofs";
import { isComplete, snapshotSchema, type Snapshot } from "./snapshot";

export interface RootReader {
  /** isKnownRoot(root) on the pool or the ledger, read at `block`. */
  isKnownRoot(contract: string, root: bigint, block: bigint): Promise<boolean>;
}

export interface CheckedTrees {
  readonly snapshot: Snapshot;
  readonly block: bigint;
  readonly pool: LedgerTree;
  readonly ledger: LedgerTree;
}

const hexOf = (n: bigint): string => `0x${n.toString(16).padStart(64, "0")}`;

const refuse = (message: string): Result<CheckedTrees> => ({
  ok: false,
  error: shaidaError("UnknownRoot", `${message} Nothing was built or sent; resync and try again.`),
});

export async function checkSnapshot(raw: unknown, expectChainId: number, reader: RootReader): Promise<Result<CheckedTrees>> {
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) return refuse("The index reply failed the schema.");
  const snapshot = parsed.data;
  if (snapshot.chainId !== expectChainId) return refuse(`The index is for chain ${snapshot.chainId}, not ${expectChainId}.`);
  if (!isComplete(snapshot)) {
    const why = snapshot.problems[0] ?? "its leaf counts were not checked at its last block";
    return refuse(`The local tree is incomplete (${why}).`);
  }
  for (const l of snapshot.ledgerLeaves) {
    const expected =
      l.kind === "vouch" ? vouchLeaf(BigInt(l.payerId), BigInt(l.commitment)) : sweepLeaf(BigInt(l.nullifier), BigInt(l.sweepCommitment));
    if (hexOf(expected) !== l.leaf) return refuse(`Ledger leaf ${l.index} does not match its own event fields.`);
  }
  const pool = new LedgerTree(snapshot.poolLeaves.map((h) => BigInt(h)));
  const ledger = new LedgerTree(snapshot.ledgerLeaves.map((l) => BigInt(l.leaf)));
  const block = BigInt(snapshot.syncedTo);
  if (!(await reader.isKnownRoot(snapshot.contracts.pool, pool.root, block))) {
    return refuse(`The pool root rebuilt from ${pool.size} served leaves is not known on chain at block ${block}.`);
  }
  if (!(await reader.isKnownRoot(snapshot.contracts.ledger, ledger.root, block))) {
    return refuse(`The ledger root rebuilt from ${ledger.size} served leaves is not known on chain at block ${block}.`);
  }
  return { ok: true, value: { snapshot, block, pool, ledger } };
}

/** Index of a pool leaf, or -1. */
export const poolIndexOf = (t: CheckedTrees, commitment: string): number => t.snapshot.poolLeaves.indexOf(commitment.toLowerCase());
