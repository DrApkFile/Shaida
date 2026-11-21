"use client";
import { useState } from "react";
import type { RelayRecord } from "@shaida/pay";
import type { Wiring } from "@/lib/flows";

/** For an unknown outcome: reads the relayer's record by id (settled by its hash on chain). Never sends anything. */
export function CheckAgain({ w, requestId, onSettled }: { w: Wiring; requestId: string | null; onSettled(): void }) {
  const [rec, setRec] = useState<RelayRecord | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (!requestId) return null;
  const check = async () => {
    const r = await w.relay.status(requestId);
    if (!r.ok) { setNote(`${r.error.code}: ${r.error.message}`); return; }
    setRec(r.value);
    setNote(null);
    if (r.value.state === "mined") onSettled();
  };
  const word = rec ? (rec.state === "mined" ? (rec.reverted ? "mined but reverted: nothing changed" : `confirmed in block ${rec.block}`) : rec.state === "dropped" ? "never landed: nothing changed, you may try again" : `still ${rec.state}`) : null;
  return (
    <div className="stack">
      <button className="btn secondary small" type="button" onClick={() => void check()}>Check again (never resends)</button>
      {word && <p className="sub">Request {requestId.slice(0, 8)}…: {word}. Tx <span className="mono">{rec?.hash.slice(0, 18)}…</span></p>}
      {note && <p className="fine">{note}</p>}
    </div>
  );
}
