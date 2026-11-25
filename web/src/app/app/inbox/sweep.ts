"use client";
// One sweep, following PRD §6: seen → sweeping (fresh note saved first) → swept | unknown. Never resends.
import type { CheckedTrees } from "@shaida/index";
import { afterSubmit, chainViewOf, prepareSweep, reconcile, seen, splitPartOf, startSweep, type IncomingPayment, type InboxEntry, type RelayRecord, type VaultData } from "@shaida/pay";
import type { Result } from "@shaida/proofs";
import type { Wiring } from "@/lib/flows";
import { problemOf, type Problem } from "@/lib/problem";

type Update = (f: (d: VaultData) => VaultData) => Promise<VaultData>;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const entryOf = (d: VaultData | null, commitment: string): InboxEntry => d?.inbox.find((e) => e.commitment === commitment) ?? seen(commitment);

export function putEntry(d: VaultData, e: InboxEntry): VaultData {
  const rest = d.inbox.filter((x) => x.commitment !== e.commitment);
  return { ...d, inbox: [...rest, e] };
}

/** Split sweeps (D32 F4, off by default) put the largest whole tUSD8 below the payment in one note and the rest in another. */
export const SPLIT_UNIT = 1_000_000n;

/** Returns a problem to show, or null when the sweep is confirmed by the ledger's S leaf. */
export async function sweepOne(w: Wiring, update: Update, current: VaultData, p: IncomingPayment, opts: { readonly split: boolean }): Promise<Problem | null> {
  const entry = entryOf(current, p.note.commitment);
  if (entry.state !== "seen") return { code: "InputRejected", message: `This payment is already ${entry.state}. Nothing was sent.` };
  const trees = await w.trees();
  if (!trees.ok) return trees.error;
  const view = await chainViewOf(trees.value, p, w.isSpent);
  if (view.kind !== "unspent") return { code: view.kind === "unvouched" ? "InputRejected" : "AlreadySpent", message: `This payment can't be swept: ${view.kind.replace(/-/g, " ")}. Nothing was sent.` };

  let prepared;
  try {
    const part = opts.split ? splitPartOf(BigInt(p.note.amountWei), SPLIT_UNIT) : null;
    prepared = await prepareSweep(w.ctx, trees.value, p, part === null ? {} : { split: part });
  } catch (e) {
    return problemOf(e, "proving the sweep");
  }
  if (!prepared.ok) return prepared.error;
  const sweeping = startSweep(entry, prepared.value.fresh, prepared.value.rest);
  await update((d) => putEntry(d, sweeping));

  const reply = await w.relay.post("sweep", prepared.value.body());
  const sent = afterSubmit(sweeping, reply);
  await update((d) => putEntry(d, sent));
  if (sent.state !== "sweeping") return sent.lastError;
  if (!reply.ok) return reply.error;
  const settled = await w.relay.settle(reply.value.requestId, { sleep });
  return settleEntry(w, update, p, settled.ok ? settled.value : null);
}

/** Moves a sweeping/unknown entry by what the chain and its record show. Used after a sweep and on "Check again". */
export async function settleEntry(w: Wiring, update: Update, p: IncomingPayment, record: RelayRecord | null): Promise<Problem | null> {
  const trees: Result<CheckedTrees> = await w.trees();
  if (!trees.ok) return trees.error;
  const view = await chainViewOf(trees.value, p, w.isSpent);
  let outcome: InboxEntry | null = null;
  await update((d) => {
    outcome = reconcile(entryOf(d, p.note.commitment), view, record);
    return putEntry(d, outcome);
  });
  const e = outcome as InboxEntry | null;
  if (!e || e.state === "swept") return null;
  if (e.state === "sweeping") return { code: "TxOutcomeUnknown", message: "Sent and mined, waiting for the index to show the sweep. Check again shortly; nothing will be resent." };
  return e.lastError ?? (e.state === "unknown" ? { code: "TxOutcomeUnknown", message: "No confirmation yet. It is checked by its hash and never sent again." } : null);
}
