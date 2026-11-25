// Revoking a shared link (D35), holder side. PRD §6 shape: revocable → sending → pending → revoked | unknown.
// `unknown` has no resend edge: it is resolved only by reading Revocations.revokedAt(salt) on chain (the truth) and
// the relayer's record by its id. A refusal before sending (nothing sent) goes back to revocable with its code.
// Pure: the relayer reply and the chain read are passed in.
import { revokeSaltOf } from "@shaida/proofs";
import { z } from "zod";
import type { RelayRecord } from "./clients";

const decimal = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);

export const revocationSchema = z
  .object({
    state: z.enum(["sending", "pending", "revoked", "unknown"]),
    requestId: z.string().nullable(),
    hash: z.string().regex(/^0x[0-9a-f]{64}$/).nullable(),
    /** The block Revocations recorded, once read from the chain. */
    block: decimal.nullable(),
    lastError: z.object({ code: z.string(), message: z.string() }).strict().nullable(),
  })
  .strict();
export type Revocation = z.output<typeof revocationSchema>;

/** What the dashboard shows for one shared link. */
export type RevokeView =
  | { readonly kind: "not-revocable" } // made before D35: no secret, nothing to revoke with
  | { readonly kind: "revocable"; readonly lastError: Revocation["lastError"] }
  | { readonly kind: "sending" | "pending" | "unknown"; readonly r: Revocation }
  | { readonly kind: "revoked"; readonly block: bigint | null; readonly hash: string | null };

export function revokeViewOf(link: { readonly revokeSecret?: string | undefined; readonly revocation?: Revocation | undefined }): RevokeView {
  if (link.revokeSecret === undefined) return { kind: "not-revocable" };
  const r = link.revocation;
  if (!r) return { kind: "revocable", lastError: null };
  if (r.state === "revoked") return { kind: "revoked", block: r.block === null ? null : BigInt(r.block), hash: r.hash };
  return { kind: r.state, r };
}

/** The relayer body. Allowed only from `revocable` (never from unknown, pending or revoked). */
export function revokeRequest(link: { readonly revokeSecret?: string | undefined; readonly revocation?: Revocation | undefined }, chainId: number): { chainId: number; secret: string } {
  const v = revokeViewOf(link);
  if (v.kind !== "revocable") throw new Error(`cannot send a revoke from ${v.kind}`);
  return { chainId, secret: link.revokeSecret! };
}

/** The salt the link's context uses, from its secret (what Revocations marks). */
export const saltOfLink = (link: { readonly revokeSecret: string }): bigint => revokeSaltOf(BigInt(link.revokeSecret));

export const sendingRevocation = (): Revocation => ({ state: "sending", requestId: null, hash: null, block: null, lastError: null });

/** After the relayer answered, or did not. A refusal means nothing was sent: back to revocable (no revocation). */
export function afterRevokePost(reply: { ok: true; value: RelayRecord } | { ok: false; error: { code: string; message: string } }): Revocation | undefined {
  if (!reply.ok) {
    if (reply.error.code === "TxOutcomeUnknown") return { state: "unknown", requestId: null, hash: null, block: null, lastError: reply.error };
    // AlreadyRevoked: nothing was sent now; reconcile() reads the chain and moves it to revoked.
    if (reply.error.code === "AlreadyRevoked") return { state: "pending", requestId: null, hash: null, block: null, lastError: reply.error };
    return undefined;
  }
  const r = reply.value;
  if (r.state === "unknown") return { state: "unknown", requestId: r.requestId, hash: r.hash, block: null, lastError: r.error };
  if (r.state === "dropped") return undefined;
  return { state: "pending", requestId: r.requestId, hash: r.hash, block: null, lastError: null };
}

/**
 * Moves a revocation by what the chain says. `revokedAt` is Revocations.revokedAt(salt) at a recent block (0: not
 * revoked there), or "unreadable". Revoked only when the chain says so; a mined receipt alone is not enough.
 */
export function reconcileRevocation(r: Revocation, revokedAt: bigint | "unreadable", record: RelayRecord | null): Revocation | undefined {
  if (revokedAt !== "unreadable" && revokedAt > 0n) return { ...r, state: "revoked", block: revokedAt.toString(), lastError: null };
  if (record?.state === "dropped" || (record?.state === "mined" && record.reverted)) return undefined; // never landed: revocable again
  if (r.state === "sending") return { ...r, state: "unknown", lastError: { code: "TxOutcomeUnknown", message: "The page stopped before the relayer answered. It is checked on chain and never sent again." } };
  if (record?.state === "unknown") return { ...r, state: "unknown", lastError: record.error };
  return r; // pending (or mined, and the chain read is behind), or unknown with nothing new: unchanged
}
