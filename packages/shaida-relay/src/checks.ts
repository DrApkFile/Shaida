// Shared rails: signature windows, signer recovery, payer status. Each returns a refusal or null.
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import type { PinnedReader } from "./reads";
import { ReadReverted } from "./reads";
import type { Refusal, RelayContracts } from "./types";

/** Signatures may not outlive an hour (the kit's rail), and must leave a minute to be mined. */
export const MAX_WINDOW_SECONDS = 3600n;
export const MIN_REMAINING_SECONDS = 60n;

export function windowRefusal(until: bigint, nowSec: bigint, what: string): Refusal | null {
  if (until > nowSec + MAX_WINDOW_SECONDS) return { code: "SignatureInvalid", message: `The ${what} is valid for more than an hour. Sign again with a shorter window; nothing was sent.` };
  if (until < nowSec + MIN_REMAINING_SECONDS) return { code: "SignatureInvalid", message: `The ${what} expires in less than a minute (or has expired). Sign again; nothing was sent.` };
  return null;
}

type TypedData = Parameters<typeof recoverTypedDataAddress>[0];

/** Recovers the signer locally. A signature that does not parse, or is someone else's, is SignatureInvalid. */
export async function signerRefusal(typed: Omit<TypedData, "signature">, signature: Hex, expected: Address): Promise<Refusal | null> {
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({ ...typed, signature } as TypedData);
  } catch (e) {
    return { code: "SignatureInvalid", message: `The signature does not parse (${e instanceof Error ? e.message.split("\n")[0] : "unknown"}). Sign again; nothing was sent.` };
  }
  if (signer.toLowerCase() !== expected.toLowerCase()) {
    return { code: "SignatureInvalid", message: "The signature is not the payer's for this exact call. Sign again; nothing was sent." };
  }
  return null;
}

/** The payer must be an active registered payer (the relayer only pays gas for them: AEVUM_INTEGRATION §4 item 8). */
export async function payerRefusal(r: PinnedReader, c: RelayContracts, payer: Address): Promise<Refusal | null> {
  try {
    await r.activeIdOf(c.registry, payer);
    return null;
  } catch (e) {
    if (e instanceof ReadReverted && e.errorName === "PayerRevoked") {
      return { code: "PayerRevoked", message: "This payer's registration was revoked. Nothing was sent." };
    }
    if (e instanceof ReadReverted && e.errorName === "PayerNotRegistered") {
      return { code: "PayerNotRegistered", message: "This address is not a registered payer. Nothing was sent." };
    }
    throw e;
  }
}

/** D7: tUSD8 paused or the payer blacklisted, read before anything is simulated or signed by the relayer. */
export async function tokenRefusal(r: PinnedReader, c: RelayContracts, payer: Address): Promise<Refusal | null> {
  if (await r.bool(c.token, "paused", [])) return { code: "TokenPaused", message: "tUSD8 is paused by its issuer. Nothing was sent." };
  if (await r.bool(c.token, "isBlacklisted", [payer])) {
    return { code: "PayerBlacklisted", message: "The paying address is on tUSD8's blacklist. Nothing was sent." };
  }
  return null;
}

/** Spend rails shared by vouchedPay and sweep: unspent note, known pool root, fresh output notes. */
export async function spendRefusal(r: PinnedReader, c: RelayContracts, t: { root: Hex; nullifier: Hex; newCommitments: readonly [Hex, Hex] }): Promise<Refusal | null> {
  if (await r.bool(c.pool, "isSpent", [t.nullifier])) {
    return { code: "AlreadySpent", message: "This note was already spent (swept by its recipient, or moved). Nothing was sent." };
  }
  if (!(await r.bool(c.pool, "isKnownRoot", [t.root]))) {
    return { code: "UnknownRoot", message: "The proof was made against a pool root the chain does not know. Resync and prove again; nothing was sent." };
  }
  for (const out of t.newCommitments) {
    if (await r.bool(c.pool, "commitmentSeen", [out])) {
      return { code: "InputRejected", message: "An output note of this transfer is already in the pool. Nothing was sent." };
    }
  }
  return null;
}
