import { isAnvilAccount } from "@aevum-kit/aevum";

/** Chains where a public anvil key may relay: local anvil and `make fork`. */
export const LOCAL_CHAIN_IDS: ReadonlySet<number> = new Set([31337, 440050]);

/** anvil's default keys are public; on a real network bots would drain such a relayer at once. */
export const signerAllowedOn = (address: string, chainId: number): boolean => LOCAL_CHAIN_IDS.has(chainId) || !isAnvilAccount(address);
