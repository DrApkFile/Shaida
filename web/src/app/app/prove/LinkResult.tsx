"use client";
// The finished link: what the reader will see, the link itself, and how long proving took in this browser.
import { useState } from "react";
import { formatUnits } from "viem";
import { CopyIcon } from "@/components/Icons";
import { dateOf, expiryOf, readerModeLabel } from "@/lib/income/words";
import { verifyPath, type Template } from "@/lib/templates";
import type { Built } from "./build";

export function LinkResult({ built, template }: { built: Built; template: Template }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const url = `${typeof window === "undefined" ? "" : window.location.origin}${verifyPath(template.id, built.fragment)}`;
  const s = built.shared;
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied("yes"); } catch (e) { setCopied("failed"); console.warn("clipboard refused", e instanceof Error ? e.message : e); }
  };
  return (
    <div className="card tone-sage stack link-result" data-prove-ms={built.proveMs.join(",")}>
      <div className="row-between"><h2>Link ready</h2><span className="status-pill good">checked here: VALID</span></div>
      <dl className="kv">
        <dt>Template</dt><dd>{template.label}</dd>
        <dt>Reader</dt><dd>{s.reader}</dd>
        <dt>Protection</dt><dd>{readerModeLabel(s.readerMode)}</dd>
        <dt>Revocable</dt><dd>{s.revokeSecret ? "Yes, from Shared proofs" : "No"}</dd>
        <dt>At least</dt><dd className="num">{formatUnits(BigInt(s.threshold), 6)} tUSD8</dd>
        <dt>{template.paymentWord[0]!.toUpperCase()}{template.paymentWord.slice(1)}s</dt><dd className="num">{s.count}</dd>
        <dt>Period</dt><dd>{dateOf(BigInt(s.fromDate))} – {dateOf(BigInt(s.toDate))}</dd>
        <dt>Expires</dt><dd>{expiryOf(BigInt(s.expiry))}</dd>
        <dt>Proving</dt><dd className="num prove-time">{built.proveMs.map((ms) => `${(ms / 1000).toFixed(1)} s`).join(" + ")} in this browser ({s.proofs} proof{s.proofs > 1 ? "s" : ""})</dd>
      </dl>
      <div className="link-box" aria-label="Proof link">{url}</div>
      <div className="row">
        <button type="button" className="btn" onClick={() => void copy()}><CopyIcon /> {copied === "yes" ? "Copied" : "Copy link"}</button>
        <a className="btn secondary" href={url} target="_blank" rel="noreferrer">Open as reader</a>
      </div>
      {copied === "failed" && <p className="fine">This browser refused the clipboard. Select the link above and copy it.</p>}
      <p className="fine">The proof is in the part after #, which browsers do not send to servers. Saved in Shared proofs (in your vault).</p>
    </div>
  );
}
