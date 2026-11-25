// PRD §6, recipient side: seen → sweeping → swept | unknown. `unknown` has no resend edge; it is resolved only by
// checking the chain by nullifier (and the relayer's record by its hash).
import { z } from "zod";
import { noteSchema, type Note } from "./notes";
import type { ChainView } from "./recipient";
import type { RelayRecord } from "./clients";

export const inboxEntrySchema = z
  .object({
    commitment: z.string(),
    state: z.enum(["seen", "sweeping", "swept", "unknown"]),
    /** The fresh note the sweep moves the money into. Saved before the sweep is sent. */
    fresh: noteSchema.nullable(),
    /** A split sweep's second note (D32 F4). Absent in vaults made before split sweeps; null for a whole sweep. */
    rest: noteSchema.nullable().optional(),
    requestId: z.string().nullable(),
    hash: z.string().nullable(),
    /** Last refusal or unknown outcome, as a closed code and a plain message. */
    lastError: z.object({ code: z.string(), message: z.string() }).strict().nullable(),
  })
  .strict();
export type InboxEntry = z.output<typeof inboxEntrySchema>;
export type InboxState = InboxEntry["state"];

export const seen = (commitment: string): InboxEntry => ({ commitment, state: "seen", fresh: null, requestId: null, hash: null, lastError: null });

/** Allowed only from `seen`: the fresh note is stored with the entry before anything is sent. */
export function startSweep(e: InboxEntry, fresh: Note, rest: Note | null = null): InboxEntry {
  if (e.state !== "seen") throw new Error(`cannot sweep from ${e.state}`);
  return { ...e, state: "sweeping", fresh, rest, requestId: null, hash: null, lastError: null };
}

/** After the relayer answered (or did not). A refusal means nothing was sent: back to `seen`. */
export function afterSubmit(e: InboxEntry, reply: { ok: true; value: RelayRecord } | { ok: false; error: { code: string; message: string } }): InboxEntry {
  if (e.state !== "sweeping") throw new Error(`no sweep in flight from ${e.state}`);
  if (!reply.ok) {
    if (reply.error.code === "TxOutcomeUnknown") return { ...e, state: "unknown", lastError: reply.error };
    return { ...e, state: "seen", fresh: null, rest: null, lastError: reply.error };
  }
  const r = reply.value;
  const base = { ...e, requestId: r.requestId, hash: r.hash };
  if (r.state === "unknown") return { ...base, state: "unknown", lastError: r.error };
  if (r.state === "dropped") return { ...base, state: "seen", fresh: null, rest: null, lastError: r.error };
  return base; // accepted, pending, mined: confirmed only by the chain view (reconcile)
}

/**
 * Moves an entry by what the chain shows. Swept only when the ledger has the S leaf for this note with OUR fresh
 * commitment (a mined receipt alone is not enough). Spent by someone else stays visible as a lost payment.
 */
export function reconcile(e: InboxEntry, view: ChainView, record: RelayRecord | null): InboxEntry {
  if (view.kind === "swept" && e.fresh && view.sweepCommitment === e.fresh.commitment) return { ...e, state: "swept", lastError: null };
  if (e.state === "seen" || e.state === "swept") return e;
  if (view.kind === "swept" || view.kind === "spent-elsewhere") {
    return { ...e, state: "seen", lastError: { code: "AlreadySpent", message: "This payment was spent by someone else before your sweep landed (the payer took it back). Your sweep did not move it." } };
  }
  if (record?.state === "dropped") return { ...e, state: "seen", fresh: null, rest: null, lastError: record.error ?? { code: "TxRejected", message: "The sweep never landed. Nothing changed." } };
  if (record?.state === "mined" && record.reverted) return { ...e, state: "seen", fresh: null, rest: null, lastError: record.error ?? { code: "TxRejected", message: "The sweep reverted. Nothing changed." } };
  if (record?.state === "unknown" || (e.state === "unknown" && !record)) return { ...e, state: "unknown" };
  return e; // still sweeping: pending, or mined but the index has not caught up
}
