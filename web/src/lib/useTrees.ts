"use client";
import { useQuery } from "@tanstack/react-query";
import type { CheckedTrees } from "@shaida/index";
import type { Result } from "@shaida/proofs";
import type { Wiring } from "./flows";

/** The pool and ledger trees from /api/index, recomputed here and checked against the chain (UnknownRoot if not). */
export function useTrees(w: Wiring | null) {
  return useQuery<Result<CheckedTrees>>({
    queryKey: ["trees", w?.net.chain.id],
    enabled: Boolean(w),
    queryFn: () => (w ? w.trees() : Promise.reject(new Error("not configured"))),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}
