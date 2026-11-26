"use client";
// The Revoke button for one shared link (D35), with its confirm, and the states after: sending, waiting for the
// chain, revoked (block), or unknown (checked on chain, never resent). Old links say why they can't be revoked.
import { useState } from "react";
import { revokeViewOf, type SharedLink } from "@shaida/pay";
import type { Wiring } from "@/lib/flows";
import { NOT_REVOCABLE } from "@/lib/income/words";
import { useVault } from "@/lib/vault";
import { checkRevocation, revokeLink } from "./revoke";

export const REVOKE_CONFIRM = "Anyone you shared this with will see it as revoked. This can't be undone.";

export function RevokeControl({ w, link }: { w: Wiring | null; link: SharedLink }) {
  const vault = useVault();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const v = revokeViewOf(link);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try { await f(); } finally { setBusy(false); setAsking(false); }
  };

  if (v.kind === "not-revocable") return <span className="fine">{NOT_REVOCABLE}</span>;
  if (v.kind === "revoked") return <span className="status-pill bad" data-revoke="revoked">Revoked{v.block !== null ? ` in block ${v.block}` : ""}</span>;
  if (v.kind !== "revocable") {
    return (
      <span className="row" data-revoke={v.kind}>
        <span className="status-pill warn">{v.kind === "unknown" ? "Revoke: outcome unknown" : "Revoking…"}</span>
        {w && <button type="button" className="btn secondary small" disabled={busy} onClick={() => void run(() => checkRevocation(w, vault.update, link, null))}>Check again</button>}
        {v.r.lastError && <span className="fine">{v.r.lastError.code}: {v.r.lastError.message}</span>}
      </span>
    );
  }
  return (
    <span className="stack tight" data-revoke="revocable">
      {!asking ? (
        <button type="button" className="btn secondary small" disabled={!w || busy} onClick={() => setAsking(true)}>Revoke</button>
      ) : (
        <span className="notice warn stack tight" role="alertdialog" aria-label="Revoke this link?">
          <span>{REVOKE_CONFIRM}</span>
          <span className="row">
            <button type="button" className="btn small danger" disabled={busy || !w} onClick={() => w && void run(() => revokeLink(w, vault.update, link))}>{busy ? "Revoking…" : "Revoke it"}</button>
            <button type="button" className="btn secondary small" disabled={busy} onClick={() => setAsking(false)}>Keep it</button>
          </span>
        </span>
      )}
      {link.revokeError && <span className="fine">{link.revokeError.code}: {link.revokeError.message} Nothing was revoked.</span>}
    </span>
  );
}
