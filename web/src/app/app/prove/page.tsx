"use client";
import { useMemo } from "react";
import { VaultBar, VaultGate } from "@/components/VaultGate";
import { wiringFor } from "@/lib/flows";
import { useNetwork } from "@/lib/network";
import { DEMO_CHAIN_ID } from "@/lib/payer";
import { useVault } from "@/lib/vault";
import { ProveDesk } from "./ProveDesk";

export default function ProvePage() {
  const { net } = useNetwork();
  return (
    <main className="shell stack page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Recipient{net.chain.id === DEMO_CHAIN_ID ? " · Ada (demo)" : ""}</p>
          <h1>Prove</h1>
          <p className="lede">
            Show one reader that you were paid at least an amount over a period, by registered payers, without showing who paid, the
            amounts, or your address. The proof is made in this browser; your note secrets never leave it.
          </p>
        </div>
      </header>
      <VaultGate purpose="Your receive key and the notes you swept into are what the proof is made from.">
        <VaultBar />
        <ProveGate />
      </VaultGate>
    </main>
  );
}

function ProveGate() {
  const { net } = useNetwork();
  const w = useMemo(() => wiringFor(net), [net]);
  const vault = useVault();
  if (!w.ok) return <div className="notice bad" role="alert"><strong className="mono">NotConfigured</strong> {w.problem}</div>;
  if (!w.value.incomeKey.ok || w.value.incomeKey.value !== "final") {
    return <div className="notice bad" role="alert"><strong className="mono">NotConfigured</strong> This screen proves with the ceremony&apos;s final key only (D27), and this build is set to another key. Nothing was built.</div>;
  }
  const key = vault.data?.receiveKey ?? null;
  if (!key) return <div className="card empty"><strong>No receive address yet</strong><span>Create one in Inbox, get paid, and sweep: swept payments are what a proof counts.</span><a className="btn" href="/app/inbox">Open Inbox</a></div>;
  return <ProveDesk w={w.value} receiveKey={key} />;
}
