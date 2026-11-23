// When a ledger root came into being (D30, rule ProofTooOld). Gloam's tree keeps every root it ever had as known
// (IncrementalMerkleTreePoseidon.isKnownRoot), so "known" says nothing about age. The root after leaf k is formed in
// that leaf's block, and a proof over it was built at or after that time: now − rootTime bounds the proof's age from
// above, so the rule never accepts a proof older than the policy allows. Pure.
import { hashPair, TREE_DEPTH, zeroHashes } from "@shaida/proofs";

export interface DatedLeaf {
  readonly leaf: bigint;
  /** Block time (unix seconds) of the leaf's insertion. */
  readonly time: bigint;
}

/** Roots after each insertion, as Gloam's incremental tree computes them (same as LedgerTree of each prefix). */
export function prefixRoots(leaves: readonly bigint[]): bigint[] {
  const zeros = zeroHashes();
  const filled = zeros.slice(0, TREE_DEPTH);
  const roots: bigint[] = [];
  leaves.forEach((leaf, index) => {
    let node = leaf;
    let i = index;
    for (let level = 0; level < TREE_DEPTH; level++) {
      if ((i & 1) === 0) {
        filled[level] = node;
        node = hashPair(node, zeros[level]!);
      } else {
        node = hashPair(filled[level]!, node);
      }
      i >>= 1;
    }
    roots.push(node);
  });
  return roots;
}

/** Block time of the leaf whose insertion formed `root`, or null when no prefix of these leaves has that root. */
export function rootFormedAt(leaves: readonly DatedLeaf[], root: bigint): bigint | null {
  const roots = prefixRoots(leaves.map((l) => l.leaf));
  const k = roots.indexOf(root);
  return k < 0 ? null : leaves[k]!.time;
}
