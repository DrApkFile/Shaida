"use client";
import { useState } from "react";
import { generateReceiveKey } from "@gloamtrade/sdk";
import { storedReceiveKey } from "@shaida/pay";
import { useVault } from "@/lib/vault";

export function ReceiveAddress() {
  const vault = useVault();
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const key = vault.data?.receiveKey ?? null;
  const create = async () => {
    const k = storedReceiveKey(await generateReceiveKey());
    await vault.update((d) => (d.receiveKey ? d : { ...d, receiveKey: k }));
  };
  const copy = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key.tag);
      setCopied("yes");
    } catch {
      setCopied("failed"); // clipboard permission refused: the address is still selectable on screen
    }
  };
  return (
    <section className="card stack" aria-labelledby="receive">
      <h2 id="receive">Your receive address</h2>
      {!key ? (
        <>
          <p className="sub">Make one key for this vault. Share the address with payers; the private half never leaves this browser.</p>
          <button className="btn" type="button" onClick={() => void create()}>Create receive address</button>
        </>
      ) : (
        <>
          <p className="mono break receive-tag">{key.tag}</p>
          <div className="row">
            <button className="btn secondary small" type="button" onClick={() => void copy()}>Copy address</button>
            {copied === "yes" && <span className="sub">Copied.</span>}
            {copied === "failed" && <span className="sub">This browser blocked copying; select the address above.</span>}
          </div>
          <p className="fine">Export a backup (above) after making it: without the key, payments sealed to this address can&apos;t be opened.</p>
        </>
      )}
    </section>
  );
}
