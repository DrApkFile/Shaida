// Revocable links (D35): salt = Poseidon(REVOKE_TAG, revokeSecret). The secret stays in the holder's vault; sending it
// to Revocations.revoke marks the salt, and every verifier reads that mark (PRD §5 step 5a). The same Poseidon as the
// deployed PoseidonT3 (test RV05 checks the contract against these values). Pure: randomness injected.
import { poseidon2 } from "poseidon-lite";

/** Domain tag of the revoke salt, next to the ledger's 1 and 2 and the reader name's 3 (contracts/src/Revocations.sol). */
export const REVOKE_TAG = 4n;
export const REVOKE_SECRET_BYTES = 31; // 248 bits, below the BN254 field like the v1 random salt

/** The salt a revoke secret stands for. */
export const revokeSaltOf = (secret: bigint): bigint => poseidon2([REVOKE_TAG, secret]);

/** A revoke secret from 31 random bytes; never 0 (the contract refuses 0). The caller supplies the randomness. */
export function revokeSecretFromBytes(bytes: Uint8Array): bigint {
  if (bytes.length !== REVOKE_SECRET_BYTES) throw new RangeError(`a revoke secret needs ${REVOKE_SECRET_BYTES} random bytes, got ${bytes.length}`);
  const v = bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
  if (v === 0n) throw new RangeError("the random source returned 31 zero bytes");
  return v;
}

/** What a verifier learns from Revocations at its pinned block. `unreadable` is INCONCLUSIVE, never a pass. */
export type RevocationState =
  | { readonly state: "none" }
  | { readonly state: "revoked"; readonly block: bigint; readonly time: bigint }
  | { readonly state: "unreadable"; readonly code: "ChainUnreachable" | "NotConfigured"; readonly message: string };
