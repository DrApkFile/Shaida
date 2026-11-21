// How the witness builder splits one period into a bundle of proofs (D12): payments in V-leaf order, at most
// INCOME_SLOTS per proof, over disjoint leaf ranges that tile the asked period, with thresholds that add up to the
// asked threshold, each a multiple of the share step (D13). Pure arithmetic, no hashing.
import { INCOME_SLOTS, SHARE_STEP } from "./field.js";

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

/** The largest bundle threshold these chunk sums can carry when every share is a multiple of `step` (D13). */
export function showableTotal(sums: readonly bigint[], step: bigint = SHARE_STEP): bigint {
  return sums.reduce((total, sum) => total + (sum / step) * step, 0n);
}

/**
 * Splits `threshold` over chunks with these sums so that each share is a multiple of `step`, ≤ its sum, and the
 * shares add up to `threshold` (requires threshold to be a multiple of step and ≤ showableTotal). Water-filling in
 * whole steps: every chunk gets the same share, except chunks whose sum, rounded down to the step, is below that
 * level; those get the rounded-down sum. Shares are public, so a capped share shows a chunk's sum only to the step
 * (D13), and an uncapped share shows only that the sum is at least the level; an even or proportional split would
 * fail or reveal more (D12).
 */
export function splitThreshold(sums: readonly bigint[], threshold: bigint, step: bigint = SHARE_STEP): bigint[] {
  if (step <= 0n) throw new RangeError(`step ${step} must be positive`);
  if (threshold < 0n || threshold % step !== 0n) throw new RangeError(`threshold ${threshold} is not a non-negative multiple of ${step}`);
  const showable = showableTotal(sums, step);
  if (threshold > showable) throw new RangeError(`threshold ${threshold} is above ${showable}, the most these sums show in steps of ${step}`);
  return waterFill(sums.map((sum) => sum / step), threshold / step).map((units) => units * step);
}

/** Water-filling over whole units: requires 0 ≤ total ≤ Σ caps. */
function waterFill(caps: readonly bigint[], total: bigint): bigint[] {
  const order = caps.map((_, k) => k).sort((a, b) => (caps[a]! < caps[b]! ? -1 : caps[a]! > caps[b]! ? 1 : a - b));
  const shares = caps.map(() => 0n);
  let remaining = total;
  for (let pos = 0; pos < order.length; pos++) {
    const left = BigInt(order.length - pos);
    const k = order[pos]!;
    if (caps[k]! * left <= remaining) {
      shares[k] = caps[k]!;
      remaining -= caps[k]!;
      continue;
    }
    // Every chunk from here on has a cap > remaining / left, so each can take the level, and `extra` of them one more.
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
