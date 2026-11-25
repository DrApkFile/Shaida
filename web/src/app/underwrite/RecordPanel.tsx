"use client";
// "Record decision" (D30): only for an APPROVE, only when the bot's recording is switched on, and opt-in behind a
// warning (D32 F3). The bot's own key calls
// IncomeVerifier.attest once per proof; the same proof asked again shows the first record and sends nothing.
import { useState } from "react";
import { PublicRecordConsent } from "@/components/PublicRecordConsent";
import type { BotInfo, RecordOutcomeView, RecordView } from "@/lib/underwrite";

const STATE_WORDS: Record<RecordView["state"], string> = {
  claimed: "claimed, not sent yet",
  pending: "sent, waiting for a block",
  mined: "recorded on chain",
  reverted: "reverted on chain (nothing recorded)",
  dropped: "refused by the node (nothing recorded; not retried)",
  unknown: "sent, no answer yet (checked by its hash, never sent again)",
};

function Records({ records, explorer }: { records: readonly RecordView[]; explorer: string | null }) {
  return (
    <ul className="reasons">
      {records.map((r) => (
        <li key={r.proofKey}>
          <span className={`status-pill ${r.state === "mined" ? "good" : r.state === "pending" || r.state === "claimed" ? "busy" : "warn"}`}>{r.state}</span>{" "}
          {STATE_WORDS[r.state]}
          {r.hash && (explorer ? <> · <a className="mono" href={`${explorer}/tx/${r.hash}`} target="_blank" rel="noreferrer">{r.hash.slice(0, 12)}…</a></> : <span className="mono"> · {r.hash.slice(0, 12)}…</span>)}
          {r.block && <> · block {r.block}</>}
        </li>
      ))}
    </ul>
  );
}

export function RecordPanel({ recording, outcome, busy, explorer, onRecord }: {
  recording: BotInfo["recording"]; outcome: RecordOutcomeView | null; busy: boolean; explorer: string | null; onRecord: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  if (!recording.enabled) {
    return <p className="notice">Recording is switched off on this bot, so this approval stays off chain. Nothing was sent.</p>;
  }
  return (
    <section className="card stack" aria-labelledby="record">
      <h2 id="record">3. Record the approval (optional)</h2>
      <p className="fine">
        The bot&apos;s own wallet <span className="mono break">{recording.botAddress ?? "—"}</span> calls IncomeVerifier.attest for each proof in the link
        (about 267,000 gas each, paid by the bot). At most {recording.dailyCount} records a day; each proof is recorded once, ever.
      </p>
      {outcome === null && (
        <>
          <PublicRecordConsent agreed={agreed} onChange={setAgreed} />
          <button type="button" className="btn secondary" disabled={busy || !agreed} onClick={onRecord}>{busy ? "Recording…" : "Record on chain"}</button>
        </>
      )}
      {outcome?.ok && <div className="notice good">{outcome.repeated ? "Already recorded by the bot; nothing new was sent." : "Recorded."}</div>}
      {outcome && !outcome.ok && <div className="notice warn" role="alert"><strong className="mono">{outcome.error.code}</strong> {outcome.error.message}</div>}
      {outcome && outcome.records.length > 0 && <Records records={outcome.records} explorer={explorer} />}
    </section>
  );
}
