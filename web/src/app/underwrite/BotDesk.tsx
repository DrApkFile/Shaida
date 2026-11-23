"use client";
// The underwriting bot's page (D30): pick a policy, paste a proof link made out to the bot, see its decision with
// reasons, and (if the bot's recording is on) ask it to record an approval on chain. Asking sends the link to Shaida's
// server for this one decision: said plainly before the button, unlike /v, which checks in the browser.
import { useEffect, useState } from "react";
import { networkByChainId } from "@/lib/env";
import { askBot, botInfo, type BotInfo, type UnderwriteReplyView } from "@/lib/underwrite";
import { DecisionCard } from "./DecisionCard";
import { PolicyPicker } from "./PolicyPicker";
import { RecordPanel } from "./RecordPanel";

type Load = { state: "loading" } | { state: "ready"; info: BotInfo } | { state: "failed"; message: string };

export function BotDesk() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [presetId, setPresetId] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<"decide" | "record" | null>(null);
  const [reply, setReply] = useState<UnderwriteReplyView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    // A link opened as /underwrite?preset=…#<proof> fills the form; nothing is sent until "Ask the bot".
    const q = new URLSearchParams(window.location.search).get("preset");
    if (q) setPresetId(q);
    if (window.location.hash.length > 1) setLink(window.location.href.replace(/^[^#]*/, `${window.location.origin}/v`));
    fetch("/api/underwrite")
      .then(async (r) => {
        const parsed = botInfo.safeParse(await r.json());
        setLoad(parsed.success ? { state: "ready", info: parsed.data } : { state: "failed", message: `the bot's settings failed their schema (HTTP ${r.status})` });
      })
      .catch((e: unknown) => setLoad({ state: "failed", message: e instanceof Error ? e.message : String(e) }));
  }, []);

  const info = load.state === "ready" ? load.info : null;
  const chosen = info ? (info.presets.find((p) => p.id === presetId) ?? info.presets[0]!) : null;
  const decision = reply && "decision" in reply ? reply.decision : null;

  const ask = async (record: boolean) => {
    if (!chosen) return;
    setBusy(record ? "record" : "decide");
    setFailure(null);
    try {
      setReply(await askBot({ link: link.trim(), preset: chosen.id, record }));
    } catch (e) {
      setFailure(`${e instanceof Error ? e.message : String(e)}. Nothing was decided or sent.`);
    } finally {
      setBusy(null);
    }
  };
  const choose = (id: string) => { setPresetId(id); setReply(null); };
  const net = info ? networkByChainId(info.chainId) : undefined;

  return (
    <main className="shell stack page bot-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Underwriting bot{net ? ` · ${net.chain.name} (${net.chain.id})` : ""}</p>
          <h1>Ask the bot</h1>
          <p className="lede">
            A landlord or lender can let a bot read income proofs. It checks the proof like <a href="/v">Verify</a> does, then applies a published
            policy in a fixed order. Same link, same policy version: same answer. No LLM, no judgement calls.
          </p>
        </div>
      </header>
      {load.state === "loading" && <div className="card empty"><strong>Loading the bot&apos;s policies…</strong></div>}
      {load.state === "failed" && <div className="notice bad" role="alert"><strong className="mono">NotConfigured</strong> The bot is not available: {load.message}. Nothing was sent.</div>}
      {info && chosen && (
        <>
          <PolicyPicker presets={info.presets} chosen={chosen} onChoose={choose} />
          <section className="card stack" aria-labelledby="link">
            <h2 id="link">2. Paste the proof link</h2>
            <label className="field">
              <span>The link, made out to “{chosen.readerName}”</span>
              <textarea name="link" rows={4} className="mono" spellCheck={false} placeholder="https://…/v#eyJ2Ijox…" value={link} onChange={(e) => { setLink(e.target.value); setReply(null); }} />
              <span className="hint">On <a href="/app/prove">Prove</a>, type “{chosen.readerName}” as the reader. A link made out to anyone else is declined (WrongReader).</span>
            </label>
            <div className="notice info">
              <strong>What the bot sees</strong>
              <span>Asking sends this link to Shaida&apos;s server for this one decision. The bot reads only the proof&apos;s public facts (the amount floor, the payment count, the ledger period, the expiry). It does not log or keep the link; if it records an approval it keeps a hash of the proof.</span>
            </div>
            <button type="button" className="btn big" disabled={!link.trim() || busy !== null} onClick={() => void ask(false)}>
              {busy === "decide" ? "Checking…" : "Ask the bot"}
            </button>
            {failure && <div className="notice bad" role="alert">{failure}</div>}
            {reply && "error" in reply && <div className="notice bad" role="alert"><strong className="mono">{reply.error.code}</strong> {reply.error.message} Next: {reply.error.nextAction}.</div>}
          </section>
          {decision && <DecisionCard d={decision} />}
          {decision?.kind === "APPROVE" && reply && "decision" in reply && (
            <RecordPanel recording={info.recording} outcome={reply.record} busy={busy === "record"} explorer={net?.hasExplorer ? net.chain.blockExplorers?.default.url ?? null : null} onRecord={() => void ask(true)} />
          )}
          <p className="fine">
            For agents: <a href="/llms.txt">/llms.txt</a> and <a href="/.well-known/agent.json">/.well-known/agent.json</a> describe POST /api/underwrite, its schemas and codes.
            Limit {info.limits.perIpPerMinute} decisions a minute per address.
          </p>
        </>
      )}
    </main>
  );
}
