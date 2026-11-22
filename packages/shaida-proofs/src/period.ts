// Dates ↔ ledger leaf indices (D27), and threshold suggestions (D13). Pure: block times are passed in.
import { type Result, shaidaError } from "./errors";

/** One ledger leaf with its block time (unix seconds). `vouch` marks V leaves (S leaves are `false`). */
export interface TimedLeaf {
  readonly index: number;
  readonly time: bigint;
  readonly vouch: boolean;
}

const sorted = (leaves: readonly TimedLeaf[]) => [...leaves].sort((a, b) => a.index - b.index);

/**
 * The leaf range of a period [start, end] (unix seconds, inclusive): the first leaf at or after `start` to the last
 * at or before `end`. Leaves are appended in block order, so their times never decrease with the index.
 */
export function leafRangeForPeriod(leaves: readonly TimedLeaf[], start: bigint, end: bigint): Result<{ fromIndex: bigint; toIndex: bigint }> {
  if (start > end) return { ok: false, error: shaidaError("InputRejected", "The period ends before it starts. Nothing was built.") };
  const inside = sorted(leaves).filter((l) => l.time >= start && l.time <= end);
  const first = inside[0];
  const last = inside.at(-1);
  if (!first || !last) return { ok: false, error: shaidaError("NoSweptPayments", "No ledger leaf falls in this period, so no payment can be counted. Nothing was built.") };
  return { ok: true, value: { fromIndex: BigInt(first.index), toIndex: BigInt(last.index) } };
}

/**
 * What the reader is shown for a range (PRD §5 step 8): the block time of the first V leaf at index ≥ fromIndex and
 * of the last V leaf at index ≤ toIndex, or null when the range holds no V leaf we can date (RangeUnresolvable).
 */
export function datesForRange(leaves: readonly TimedLeaf[], fromIndex: bigint, toIndex: bigint): { fromDate: bigint; toDate: bigint } | null {
  const vouches = sorted(leaves).filter((l) => l.vouch && BigInt(l.index) >= fromIndex && BigInt(l.index) <= toIndex);
  const first = vouches[0];
  const last = vouches.at(-1);
  return first && last ? { fromDate: first.time, toDate: last.time } : null;
}

/** For an amount that is not a multiple of `step`: the nearest multiples below (if positive) and above. */
export function nearestValidThresholds(amount: bigint, step: bigint): { readonly valid: boolean; readonly below: bigint | null; readonly above: bigint } {
  if (step <= 0n) throw new RangeError("step must be positive");
  if (amount < 0n) return { valid: false, below: null, above: step };
  const below = (amount / step) * step;
  if (below === amount && amount > 0n) return { valid: true, below: amount, above: amount };
  return { valid: false, below: below > 0n ? below : null, above: below + step };
}
