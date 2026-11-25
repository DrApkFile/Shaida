// The prove form's defaults that affect privacy (D32). Pure.
//   F8: a link expires at 23:59:59 UTC of the chosen day, the same for everyone, so the expiry no longer gives away
//       the maker's time zone (the bot link of 2026-11-24 did: 22:59:59 UTC = 23:59:59 at UTC+1).
//   F9: the suggested threshold is rounded down to a round value and is never the exact total, so a link made with
//       the suggestion does not pin the total to one step.

const U = 1_000_000n;

/** End of the given calendar day ("YYYY-MM-DD") in UTC, as unix seconds; null for a malformed date. */
export function endOfDayUtc(iso: string): bigint | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  const back = new Date(ms);
  if (back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3])) return null; // 2026-02-30
  return BigInt(ms / 1000);
}

/** The round unit the suggestion uses: 5 tUSD8 from a 5 tUSD8 total, 10 from 50, else 1; never finer than the step. */
export function roundUnitFor(total: bigint, step: bigint): bigint {
  const round = total >= 50n * U ? 10n * U : total >= 5n * U ? 5n * U : U;
  const unit = round > step ? round : step;
  if (unit % step !== 0n) throw new Error(`the round unit ${unit} is not a multiple of the step ${step}`);
  return unit;
}

/**
 * The threshold the form suggests for a period's total: rounded down to the round unit, and one unit lower when that
 * would equal the total. Null when nothing round is below the total (a total of 1 tUSD8 or less at step 1).
 */
export function suggestedThreshold(total: bigint, step: bigint): bigint | null {
  if (step <= 0n) throw new Error("the step must be positive");
  const unit = roundUnitFor(total, step);
  let s = (total / unit) * unit;
  if (s >= total) s -= unit;
  return s > 0n ? s : null;
}
