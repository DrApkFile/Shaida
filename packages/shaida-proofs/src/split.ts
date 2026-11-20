// How the witness builder splits one period into a bundle of proofs (D12): payments in V-leaf order, at most
// INCOME_SLOTS per proof, over disjoint leaf ranges that tile the asked period, with thresholds that add up to the
// asked threshold. Pure arithmetic, no hashing.
import { INCOME_SLOTS } from "./field.js";

export interface ChunkRange {
  readonly fromIndex: bigint;
  readonly toIndex: bigint;
}

/** Consecutive groups of at most `size` items, in order. */
export function chunk<T>(items: readonly T[], size: number = INCOME_SLOTS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Leaf ranges for chunks of sorted V indices: the first starts at `fromIndex`, the last ends at `toIndex`, and each
 * boundary falls halfway between the last V leaf of one chunk and the first of the next. The ranges are disjoint
 * and contiguous, and each holds exactly its chunk's V leaves.
 */
export function chunkRanges(vouchIndices: readonly (readonly number[])[], fromIndex: bigint, toIndex: bigint): ChunkRange[] {
  return vouchIndices.map((indices, k) => {
    const start = k === 0 ? fromIndex : midpoint(vouchIndices[k - 1]!, vouchIndices[k]!) + 1n;
    const end = k === vouchIndices.length - 1 ? toIndex : midpoint(vouchIndices[k]!, vouchIndices[k + 1]!);
    if (indices.length === 0 || start > BigInt(indices[0]!) || end < BigInt(indices.at(-1)!)) {
      throw new RangeError(`chunk ${k} does not fit its range ${start}–${end}`);
    }
    return { fromIndex: start, toIndex: end };
  });
}

/** floor((last V index of `left` + first V index of `right`) / 2): ≥ the former and < the latter. */
const midpoint = (left: readonly number[], right: readonly number[]): bigint =>
  (BigInt(left.at(-1)!) + BigInt(right[0]!)) / 2n;

/**
 * Splits `threshold` over chunks with these sums so that each share ≤ its sum and the shares add up to `threshold`
 * (requires threshold ≤ Σ sums). Water-filling: every chunk gets the same share, except chunks whose sum is below
 * that level, which get their whole sum. Shares are public, so this reveals a chunk's exact sum only when it is
 * below the level; an even or proportional split would fail or reveal more (D12).
 */
export function splitThreshold(sums: readonly bigint[], threshold: bigint): bigint[] {
  const total = sums.reduce((a, b) => a + b, 0n);
  if (threshold < 0n || threshold > total) throw new RangeError(`threshold ${threshold} is not within 0..${total}`);
  const order = sums.map((_, k) => k).sort((a, b) => (sums[a]! < sums[b]! ? -1 : sums[a]! > sums[b]! ? 1 : a - b));
  const shares = sums.map(() => 0n);
  let remaining = threshold;
  for (let pos = 0; pos < order.length; pos++) {
    const left = BigInt(order.length - pos);
    const k = order[pos]!;
    if (sums[k]! * left <= remaining) {
      shares[k] = sums[k]!;
      remaining -= sums[k]!;
      continue;
    }
    // Every chunk from here on has a sum > remaining / left, so each can take the level, and `extra` of them one more.
    const level = remaining / left;
    let extra = remaining % left;
    for (const j of order.slice(pos)) {
      shares[j] = level + (extra > 0n ? 1n : 0n);
      if (extra > 0n) extra--;
    }
    break;
  }
  return shares;
}
