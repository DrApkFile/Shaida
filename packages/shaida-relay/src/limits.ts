// Rate windows and the daily gas budget. Both live in the persisted RelayState (AEVUM_INTEGRATION §4 item 3).
import type { RelayState, RequestRecord } from "./types";

export interface RelayLimits {
  /** Requests per IP per minute, counted before the body is even parsed. */
  readonly perIpPerMinute: number;
  /** Relayed calls per payer per minute (deposit, vouchedPay, lateVouch). */
  readonly perPayerPerMinute: number;
  /** Gas the relayer may commit per UTC day: in-flight txs count their gas limit, mined ones their gasUsed. */
  readonly dailyGasBudget: bigint;
  /** Refuse when the relayer's balance is below this many wei (it could not pay for the call). */
  readonly minBalanceWei: bigint;
}

export const DEFAULT_LIMITS: RelayLimits = {
  perIpPerMinute: 20,
  perPayerPerMinute: 6,
  dailyGasBudget: 150_000_000n, // ≈ 54 vouched pays at 2.77M; ≈ 0.15 tQDAY at 1 gwei
  minBalanceWei: 10_000_000_000_000_000n, // 0.01 tQDAY
};

const WINDOW_MS = 60_000;

/** Counts this hit and says whether the bucket is over `max` in the last minute (sliding window). */
export function hit(s: RelayState, bucket: string, max: number, nowMs: number): boolean {
  const recent = (s.rate[bucket] ?? []).filter((t) => nowMs - t < WINDOW_MS);
  recent.push(nowMs);
  s.rate[bucket] = recent;
  if (Object.keys(s.rate).length > 10_000) {
    for (const [k, ts] of Object.entries(s.rate)) if (ts.every((t) => nowMs - t >= WINDOW_MS)) delete s.rate[k];
  }
  return recent.length > max;
}

export const utcDay = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 10);

/** Gas a record holds against its day's budget. */
export function committedGas(r: RequestRecord): bigint {
  switch (r.state) {
    case "dropped":
      return 0n;
    case "mined":
      return BigInt(r.gasUsed ?? r.gas);
    default:
      return BigInt(r.gas); // accepted, pending, unknown: reserved at the limit until settled
  }
}

export function gasCommitted(s: RelayState, day: string): bigint {
  let total = 0n;
  for (const r of Object.values(s.records)) if (r.budgetDay === day) total += committedGas(r);
  return total;
}
