"use client";
// One revoke (D35), PRD §6 shape: revocable → sending (saved first) → pending → revoked | unknown. Never resends: an
// unknown or pending revoke is settled only by Revocations.revokedAt(salt) on chain and the relayer's record.
import { afterRevokePost, reconcileRevocation, revokeRequest, saltOfLink, sendingRevocation, type RelayRecord, type Revocation, type SharedLink, type VaultData } from "@shaida/pay";
import { revocationsReadAbi } from "@shaida/index";
import type { Wiring } from "@/lib/flows";

type Update = (f: (d: VaultData) => VaultData) => Promise<VaultData>;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Shared links are keyed by their fragment (unique: each carries fresh proofs and a fresh salt). */
const put = (d: VaultData, fragment: string, patch: Partial<SharedLink>, clear: readonly ("revocation" | "revokeError")[] = []): VaultData => ({
  ...d,
  shared: d.shared.map((s) => {
    if (s.fragment !== fragment) return s;
    const next: SharedLink = { ...s, ...patch };
    for (const k of clear) delete next[k];
    return next;
  }),
});

const store = (update: Update, fragment: string, r: Revocation | undefined, error?: { code: string; message: string }) =>
  update((d) => (r ? put(d, fragment, { revocation: r }, ["revokeError"]) : put(d, fragment, error ? { revokeError: error } : {}, ["revocation"])));

/** revokedAt(salt) at the latest block: > 0 once revoked; "unreadable" never changes the state. */
async function revokedAtNow(w: Wiring, link: SharedLink): Promise<bigint | "unreadable"> {
  if (!link.revokeSecret) return "unreadable";
  try {
    return await w.client.readContract({ address: w.contracts.revocations, abi: revocationsReadAbi, functionName: "revokedAt", args: [saltOfLink({ revokeSecret: link.revokeSecret })] });
  } catch (e) {
    console.warn("revokedAt read failed", e instanceof Error ? e.message.split("\n")[0] : "error");
    return "unreadable";
  }
}

export async function revokeLink(w: Wiring, update: Update, link: SharedLink): Promise<void> {
  const body = revokeRequest(link, w.net.chain.id); // throws unless revocable: no second send from this browser
  await store(update, link.fragment, sendingRevocation()); // saved before anything is sent
  const reply = await w.relay.post("revoke", body);
  const after = afterRevokePost(reply);
  await store(update, link.fragment, after, reply.ok ? undefined : reply.error);
  if (!after) return;
  const settled = after.requestId ? await w.relay.settle(after.requestId, { sleep }) : null;
  await checkRevocation(w, update, { ...link, revocation: after }, settled?.ok ? settled.value : null);
}

/** Moves a sending/pending/unknown revocation by what the chain (and the record, if any) shows. "Check again". */
export async function checkRevocation(w: Wiring, update: Update, link: SharedLink, record: RelayRecord | null): Promise<void> {
  const r = link.revocation;
  if (!r || r.state === "revoked") return;
  let rec = record;
  if (!rec && r.requestId) {
    const s = await w.relay.status(r.requestId);
    rec = s.ok ? s.value : null;
  }
  const next = reconcileRevocation(r, await revokedAtNow(w, link), rec);
  await store(update, link.fragment, next, next ? undefined : rec?.error ?? { code: "TxRejected", message: "The revoke never landed. Nothing changed; you can revoke again." });
}
