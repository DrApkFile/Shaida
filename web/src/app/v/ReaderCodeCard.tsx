"use client";
// D36: the reader makes a random code here and gives it to the person proving to them. 80 bits from the browser's
// CSPRNG, shown once and never stored or sent: a link bound to it verifies only for that name and this code.
import { useState } from "react";
import { READER_CODE_BITS, readerCodeFromBytes } from "@shaida/proofs";
import { CopyIcon } from "@/components/Icons";

export function ReaderCodeCard() {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const make = () => { setCode(readerCodeFromBytes(crypto.getRandomValues(new Uint8Array(READER_CODE_BITS / 8)))); setCopied(null); };
  const copy = async () => {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); setCopied("yes"); } catch (e) { setCopied("failed"); console.warn("clipboard refused", e instanceof Error ? e.name : "error"); }
  };
  return (
    <section className="card stack reader-code-card" aria-labelledby="reader-code">
      <h2 id="reader-code">Want a link only you can open?</h2>
      {code === null ? (
        <>
          <p className="fine">Give the person proving to you a code with your name. Their link then needs both, so someone who only knows your name can&apos;t view it.</p>
          <button type="button" className="btn secondary" onClick={make}>Get a code to give the person proving to you</button>
        </>
      ) : (
        <>
          <p className="link-box mono reader-code" aria-label="Your reader code">{code}</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => void copy()}><CopyIcon /> {copied === "yes" ? "Copied" : "Copy code"}</button>
            <button type="button" className="btn secondary" onClick={() => { setCode(null); setCopied(null); }}>Done, hide it</button>
          </div>
          {copied === "failed" && <p className="fine">This browser refused the clipboard. Write the code down.</p>}
          <p className="fine">
            Shown once: Shaida does not keep it and cannot show it again. Send it to the person proving to you, with your
            name. You&apos;ll type both when you open their link. Keep it to yourself otherwise: anyone with the link, your
            name and this code can view it.
          </p>
        </>
      )}
    </section>
  );
}
