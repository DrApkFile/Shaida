import type { RelayState, RelayStore } from "./types";

/** Keys are chain-scoped: the same nullifier on another chain is another payment. */
export const recordKey = (chainId: number, key: string): string => `${chainId}:${key}`;

/** A read through the store's queue (sees every earlier update). */
export const withState = <T>(store: RelayStore, f: (s: RelayState) => T): Promise<T> => store.read().then(f);
