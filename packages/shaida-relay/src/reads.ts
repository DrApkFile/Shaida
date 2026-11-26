import type { Address } from "viem";
import type { RelayChain } from "./types";

/** A contract read reverted (e.g. PayerRegistry.activeIdOf for an unknown payer). */
export class ReadReverted extends Error {
  constructor(readonly errorName: string | null, message: string) {
    super(message);
    this.name = "ReadReverted";
  }
}


/** Reads pinned to one block, so every rail sees the same chain state. */
export interface PinnedReader {
  readonly block: bigint;
  bool(to: Address, fn: "paused" | "isBlacklisted" | "isSpent" | "isKnownRoot" | "commitmentSeen" | "vouched" | "authorizationState", args: readonly unknown[]): Promise<boolean>;
  activeIdOf(registry: Address, payer: Address): Promise<number>;
  /** Revocations.revokedAt(salt): the block it was revoked in, 0 if never (D35). */
  revokedAt(revocations: Address, salt: bigint): Promise<bigint>;
}

export function pinnedReader(chain: RelayChain, block: bigint): PinnedReader {
  return {
    block,
    bool: async (to, fn, args) => {
      const v = await chain.read(to, fn, args, block);
      if (typeof v !== "boolean") throw new Error(`${fn} returned ${typeof v}, expected boolean`);
      return v;
    },
    activeIdOf: async (registry, payer) => {
      const v = await chain.read(registry, "activeIdOf", [payer], block);
      if (typeof v !== "number") throw new Error(`activeIdOf returned ${typeof v}, expected number`);
      return v;
    },
    revokedAt: async (revocations, salt) => {
      const v = await chain.read(revocations, "revokedAt", [salt], block);
      if (typeof v !== "bigint") throw new Error(`revokedAt returned ${typeof v}, expected bigint`);
      return v;
    },
  };
}
