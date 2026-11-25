"use client";
// Verify a proof link (PRD §5, D27). Public, no wallet. The proof is in the URL fragment, which the browser never
// sends to a server; this page reads public chain data only (the ledger snapshot, isKnownRoot and revokedAt).
// A code-protected link (D36) needs the reader's name and code; the code is typed here and never sent or stored.
import { useEffect, useMemo, useState } from "react";
import { claimedLinkKind, parseReaderCode, readerIdHashOf, verifyIncomeLink, type IncomeVerification } from "@shaida/proofs";
import { wiringFor } from "@/lib/flows";
import { leafTimes, verifyDepsFor } from "@/lib/income/chain";
import { useNetwork } from "@/lib/network";
import { templateOf, TEMPLATES, type Template } from "@/lib/templates";
import { NOT_REVOCABLE, readerModeLabel } from "@/lib/income/words";
import { useTrees } from "@/lib/useTrees";
import { ReaderCodeCard } from "./ReaderCodeCard";
import { Verdict } from "./Verdict";

export default function VerifyPage() {
  const { net } = useNetwork();
  const w = useMemo(() => wiringFor(net), [net]);
  const trees = useTrees(w.ok ? w.value : null);
  const [fragment, setFragment] = useState<string | null>(null);
  const [reader, setReader] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IncomeVerification | null>(null);
  const [template, setTemplate] = useState<Template>(TEMPLATES.income);

  useEffect(() => {
    const read = () => {
      setFragment(window.location.hash.slice(1) || null);
      setTemplate(templateOf(new URLSearchParams(window.location.search).get("for")));
      setResult(null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const t = trees.data?.ok ? trees.data.value : null;
  const id = readerIdHashOf(reader);
  const kind = fragment ? claimedLinkKind(fragment) : null;
  const wantsCode = kind?.readerMode === "code";
  const parsedCode = wantsCode && code.trim() !== "" ? parseReaderCode(code) : null;
  // An empty code is allowed: the verification itself refuses a code-protected link without one (WrongReader).
  const codeOk = parsedCode === null || parsedCode.ok;
  const verify = async () => {
    if (!w.ok || !t || !fragment || !id.ok || !codeOk) return;
    const readerCode = parsedCode?.ok ? parsedCode.value : null;
    setBusy(true);
    try {
      const leaves = await leafTimes(w.value, t);
      setResult(await verifyIncomeLink(fragment, verifyDepsFor(w.value, t, leaves, { nameHash: id.value, code: readerCode }, () => BigInt(Math.floor(Date.now() / 1000)))));
    } catch (e) {
      setResult({ status: "INCONCLUSIVE", error: { code: "RangeUnresolvable", message: `Could not read the chain: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}. Nothing was recorded.`, retryable: "yes", nextAction: "resync" } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="shell stack page verify-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Verify a proof · {net.chain.name} ({net.chain.id})</p>
          <h1>{template.verifyTitle}</h1>
          <p className="lede">{template.verifyLede}</p>
        </div>
      </header>
      {!w.ok && <div className="notice bad" role="alert"><strong className="mono">NotConfigured</strong> {w.problem}</div>}
      {!fragment ? (
        <div className="card empty"><strong>No proof in this link</strong><span>Open the full link you were sent: the proof is the long part after #.</span></div>
      ) : (
        <section className="card stack" aria-labelledby="who">
          <h2 id="who">Who are you?</h2>
          {kind && (
            <p className="fine link-kind" data-reader-mode={kind.readerMode} data-revocable={kind.revocable}>
              This link says: <strong>{readerModeLabel(kind.readerMode)}</strong>{kind.revocable ? "; its sender can revoke it" : `; ${NOT_REVOCABLE.toLowerCase()}`}. Verifying checks this.
            </p>
          )}
          <label className="field">
            <span>Your name, as the sender wrote it</span>
            <input name="reader" autoComplete="name" placeholder="Landlord Bola" value={reader} onChange={(e) => { setReader(e.target.value); setResult(null); }} />
            <span className="hint">{wantsCode ? "Case and spacing don't matter." : "The link is made out to a name, not a login: anyone with it who types that name sees the result. Case and spacing don't matter."}</span>
          </label>
          {wantsCode && (
            <label className="field">
              <span>Your reader code</span>
              <input name="reader-code" autoComplete="off" spellCheck={false} className="mono" placeholder="XXXX-XXXX-XXXX-XXXX" value={code} aria-invalid={parsedCode !== null && !parsedCode.ok} onChange={(e) => { setCode(e.target.value); setResult(null); }} />
              <span className="hint">The code you gave the sender. It stays in this browser.</span>
            </label>
          )}
          <button type="button" className="btn big" disabled={!id.ok || !codeOk || !t || busy} onClick={() => void verify()}>
            {busy ? "Checking…" : !t ? (trees.data && !trees.data.ok ? "Ledger unavailable" : "Reading the ledger…") : "Verify"}
          </button>
          {trees.data && !trees.data.ok && <div className="notice warn" role="alert"><strong className="mono">{trees.data.error.code}</strong> {trees.data.error.message}</div>}
        </section>
      )}
      {result && w.ok && fragment && <Verdict v={result} w={w.value} fragment={fragment} template={template} codeProtected={wantsCode} />}
      <ReaderCodeCard />
      <p className="fine">Checked in this browser with the ceremony&apos;s final verification key against {net.chain.name}. Proofs are never sent to Shaida&apos;s server.</p>
    </main>
  );
}
