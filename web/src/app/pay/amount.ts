import { parseUnits } from "viem";

/** "12.5" → 12_500_000n (tUSD8 has 6 decimals). Null for anything that is not a positive amount with ≤ 6 decimals. */
export function parseTusd8(text: string): bigint | null {
  const t = text.trim();
  if (!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(t)) return null;
  const v = parseUnits(t, 6);
  return v > 0n ? v : null;
}
