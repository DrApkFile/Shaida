// Which income-proof key the app may use (CLAUDE.md: the ceremony key is not final yet). The throwaway key from
// packages/shaida-proofs/scripts/throwaway.ts is forgeable by whoever made it, so it is refused on Aevum 44005.
import { shaidaError, type Result } from "@shaida/proofs";

export const AEVUM_CHAIN_ID = 44005 as const;

export type IncomeKey = "throwaway" | "final";

export function incomeKeyFor(setting: string | undefined, chainId: number): Result<IncomeKey> {
  const key = setting?.trim() || "final";
  if (key !== "throwaway" && key !== "final") {
    return { ok: false, error: shaidaError("NotConfigured", `Income key setting "${key}" is neither "throwaway" nor "final". Nothing was built.`) };
  }
  if (key === "throwaway" && chainId === AEVUM_CHAIN_ID) {
    return { ok: false, error: shaidaError("NotConfigured", "The THROWAWAY income key is refused on Aevum testnet 44005: only the ceremony's final key may prove there. Nothing was built.") };
  }
  return { ok: true, value: key };
}
