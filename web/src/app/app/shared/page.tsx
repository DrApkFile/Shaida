"use client";
// Shared proofs (D26, D27): the links made in this browser, newest first, from the vault. Nothing here is on a server.
import { formatUnits } from "viem";
import { VaultBar, VaultGate } from "@/components/VaultGate";
import { dateOf, expiryOf } from "@/lib/income/words";
import { TEMPLATES, verifyPath } from "@/lib/templates";
import { useVault } from "@/lib/vault";

export default function SharedPage() {
  return (
    <main className="shell stack page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Recipient</p>
          <h1>Shared proofs</h1>
          <p className="lede">The proof links made in this browser. They are kept in your vault; Shaida&apos;s server never had them.</p>
        </div>
      </header>
      <VaultGate purpose="Your proof links are kept with your other secrets.">
        <VaultBar />
        <SharedList />
      </VaultGate>
    </main>
  );
}

function SharedList() {
  const vault = useVault();
  const links = [...(vault.data?.shared ?? [])].reverse();
  const now = Math.floor(Date.now() / 1000);
  if (links.length === 0) {
    return (
      <div className="card empty">
        <strong>No proof links yet</strong>
        <span>Make one in Prove. It shows here with its reader and expiry.</span>
        <a className="btn" href="/app/prove">Make a proof</a>
      </div>
    );
  }
  return (
    <section className="card" aria-labelledby="shared">
      <h2 id="shared" className="sr-only">Links</h2>
      <ul className="payments">
        {links.map((s) => {
          const expired = s.expiry <= now;
          const t = TEMPLATES[s.template ?? "income"];
          const url = `${window.location.origin}${verifyPath(t.id, s.fragment)}`;
          return (
            <li key={s.fragment.slice(-24)} className="payment shared-link">
              <div className="stack tight">
                <span className="payment-amount">≥ {formatUnits(BigInt(s.threshold), 6)} <small>tUSD8 · {s.count} {t.paymentWord}{s.count > 1 ? "s" : ""}</small></span>
                <span className="fine">{t.label} · for {s.reader} · {dateOf(BigInt(s.fromDate))} – {dateOf(BigInt(s.toDate))} · made {dateOf(BigInt(s.createdAt))}</span>
              </div>
              <div className="row">
                <span className={`status-pill ${expired ? "warn" : "good"}`}>{expired ? `expired ${expiryOf(BigInt(s.expiry))}` : `expires ${expiryOf(BigInt(s.expiry))}`}</span>
                <a className="btn secondary small" href={url} target="_blank" rel="noreferrer">Open</a>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
