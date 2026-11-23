"use client";
// Verify a proof link (PRD §5, D27). Public, no wallet. The proof is in the URL fragment, which the browser never
// sends to a server; this page reads public chain data only (the ledger snapshot and isKnownRoot).
import { useEffect, useMemo, useState } from "react";
import { readerIdHashOf, verifyIncomeLink, type IncomeVerification } from "@shaida/proofs";
import { wiringFor } from "@/lib/flows";
import { leafTimes, verifyDepsFor } from "@/lib/income/chain";
import { useNetwork } from "@/lib/network";
import { templateOf, TEMPLATES, type Template } from "@/lib/templates";
import { useTrees } from "@/lib/useTrees";
import { Verdict } from "./Verdict";

export default function VerifyPage() {
  const { net } = useNetwork();
  const w = useMemo(() => wiringFor(net), [net]);
  const trees = useTrees(w.ok ? w.value : null);
  const [fragment, setFragment] = useState<string | null>(null);
  const [reader, setReader] = useState("");
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
  const verify = async () => {
    if (!w.ok || !t || !fragment || !id.ok) return;
    setBusy(true);
    try {
      const leaves = await leafTimes(w.value, t);
      setResult(await verifyIncomeLink(fragment, verifyDepsFor(w.value, t, leaves, id.value, () => BigInt(Math.floor(Date.now() / 1000)))));
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
          <label className="field">
            <span>Your name, as the sender wrote it</span>
            <input name="reader" autoComplete="name" placeholder="Landlord Bola" value={reader} onChange={(e) => { setReader(e.target.value); setResult(null); }} />
            <span className="hint">The link is made out to a name, not a login: anyone with it who types that name sees the result. Case and spacing don&apos;t matter.</span>
          </label>
          <button type="button" className="btn big" disabled={!id.ok || !t || busy} onClick={() => void verify()}>
            {busy ? "Checking…" : !t ? (trees.data && !trees.data.ok ? "Ledger unavailable" : "Reading the ledger…") : "Verify"}
          </button>
          {trees.data && !trees.data.ok && <div className="notice warn" role="alert"><strong className="mono">{trees.data.error.code}</strong> {trees.data.error.message}</div>}
        </section>
      )}
      {result && w.ok && fragment && <Verdict v={result} w={w.value} fragment={fragment} template={template} />}
      <p className="fine">Checked in this browser with the ceremony&apos;s final verification key against {net.chain.name}. Proofs are never sent to Shaida&apos;s server.</p>
    </main>
  );
}
