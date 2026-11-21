import { keccak256, stringToHex, type Hex } from "viem";
import type { Refusal, RelayState, RelayStore, RequestRecord } from "./types";

/** Keys are chain-scoped: the same nullifier on another chain is another payment. */
export const recordKey = (chainId: number, key: string): string => `${chainId}:${key}`;

/** A read through the store's queue (sees every earlier update). */
export const withState = <T>(store: RelayStore, f: (s: RelayState) => T): Promise<T> => store.read().then(f);

/** The request itself (function + parsed body), so only an identical request is answered with an existing record. */
export const requestHashOf = (fn: string, body: unknown): Hex =>
  keccak256(stringToHex(`${fn}\n${JSON.stringify(body, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))}`));

/** A key frees up again only when its tx can never have an effect: dropped, or mined and reverted. */
export const keyIsLive = (r: RequestRecord): boolean => r.state !== "dropped" && !(r.state === "mined" && r.reverted === true);

/** A DIFFERENT request for a key another live record holds: refused, by what the key protects. Nothing sent. */
export function takenRefusal(key: string, holder: RequestRecord): Refusal {
  const done = holder.state === "mined";
  const kind = key.split(":")[1];
  if (kind === "nullifier") {
    return { code: "AlreadySpent", message: done ? "This note was already spent on chain. Nothing was sent." : "Another request is already spending this note. Nothing was sent." };
  }
  if (kind === "vouch") return { code: "AlreadyVouched", message: "This payment already has (or is getting) a vouch. Nothing was sent." };
  if (kind === "memo") return { code: "InputRejected", message: "A memo for this payment was already posted (or is being posted). Nothing was sent." };
  return { code: "InputRejected", message: "This deposit commitment is already used by another request. Make a new note; nothing was sent." };
}
