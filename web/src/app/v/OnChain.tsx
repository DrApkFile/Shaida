"use client";
// Optional (PRD §3): "Check on-chain" calls IncomeVerifier.check for each proof (a view, explicit gas, nothing sent);
// "Record check" sends attest, a public record that a proof for this link's context passed: opt-in behind a warning
// (D32 F3). Legacy txs.
import { useState } from "react";
import { decodeFragment, incomeLinkSchema } from "@shaida/proofs";
import { ProblemBox } from "@/components/ProblemBox";
import { PublicRecordConsent } from "@/components/PublicRecordConsent";
import type { Wiring } from "@/lib/flows";
import { attestOnChain, checkOnChain, settleAttest, type AttestOutcome } from "@/lib/income/chain";
import { useAttestSender } from "@/lib/income/signer";
import { DEMO_CHAIN_ID } from "@/lib/payer";
import type { Problem } from "@/lib/problem";

export function OnChain({ w, fragment }: { w: Wiring; fragment: string }) {
  const [checked, setChecked] = useState<bigint | null>(null);
  const [records, setRecords] = useState<AttestOutcome[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const demo = w.net.chain.id === DEMO_CHAIN_ID;
  const sender = useAttestSender(demo ? "demo" : "wallet");
  const decoded = decodeFragment(fragment);
  const link = decoded.ok ? incomeLinkSchema.safeParse(decoded.json) : null;
  if (!link?.success) return null;
  const proofs = link.data.proofs;
  const explorer = w.net.hasExplorer ? w.net.chain.blockExplorers?.default.url : undefined;

  const run = async (f: () => Promise<void>) => { setBusy(true); setProblem(null); try { await f(); } finally { setBusy(false); } };
  const check = () => run(async () => {
    for (const p of proofs) {
      const r = await checkOnChain(w, p.proof, p.publicSignals);
      if (!r.ok) { setChecked(null); setProblem(r.error); return; }
      setChecked(r.block);
    }
  });
  const record = () => run(async () => {
    if (!sender || !agreed) return;
    const out: AttestOutcome[] = [];
    for (const p of proofs) {
      const r = await attestOnChain(w, p.proof, p.publicSignals, sender.send);
      out.push(r);
      setRecords([...out]);
      if (r.state !== "mined") { setProblem(r.error); return; }
    }
  });
  const recheck = (hash: `0x${string}`) => run(async () => {
    const r = await settleAttest(w, hash);
    setRecords((rs) => rs.map((x) => (x.hash === hash ? r : x)));
    if (r.state !== "mined") setProblem(r.error);
  });

  return (
    <div className="stack tight on-chain">
      <div className="row">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => void check()}>Check on-chain</button>
      </div>
      <PublicRecordConsent agreed={agreed} onChange={setAgreed} />
      <div className="row">
        <button type="button" className="btn outline" disabled={busy || !sender || !agreed} onClick={() => void record()}>Record check{sender?.kind === "demo" ? " (demo signer)" : ""}</button>
      </div>
      {!sender && <p className="fine">Connect a wallet on {w.net.chain.name} to record a check. Checking on-chain needs no wallet.</p>}
      {checked !== null && <p className="notice good on-chain-ok">IncomeVerifier.check passed for {proofs.length} proof{proofs.length > 1 ? "s" : ""} at block {checked.toString()}. Nothing was sent.</p>}
      {records.map((r) => (
        <p key={r.hash ?? "none"} className={`notice ${r.state === "mined" ? "good" : r.state === "unknown" ? "warn" : "bad"} attest-record`}>
          {r.state === "mined" ? `Recorded in block ${r.block.toString()}: ` : r.state === "unknown" ? "Sent, not confirmed yet: " : "Not recorded: "}
          {r.hash && (explorer ? <a className="mono attest-hash" href={`${explorer}/tx/${r.hash}`} target="_blank" rel="noreferrer">{r.hash}</a> : <span className="mono break attest-hash">{r.hash}</span>)}
          {r.state === "unknown" && r.hash && <button type="button" className="btn small secondary" disabled={busy} onClick={() => void recheck(r.hash as `0x${string}`)}>Check again</button>}
        </p>
      ))}
      <ProblemBox problem={problem} />
      {demo && <p className="fine"><span className="demo-tag">Demo</span> On the local fork the record is sent by a one-off account made in this tab, funded with fork ETH. Its tx hash has no public explorer.</p>}
    </div>
  );
}
