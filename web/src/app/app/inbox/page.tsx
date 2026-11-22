"use client";
import { useMemo } from "react";
import { VaultBar, VaultGate } from "@/components/VaultGate";
import { wiringFor } from "@/lib/flows";
import { useNetwork } from "@/lib/network";
import { DEMO_CHAIN_ID } from "@/lib/payer";
import { useVault } from "@/lib/vault";
import { Payments } from "./Payments";
import { ReceiveAddress } from "./ReceiveAddress";

export default function InboxPage() {
  const { net } = useNetwork();
  return (
    <main className="shell stack page">
      <header className="page-head">
        <p className="eyebrow">Recipient{net.chain.id === DEMO_CHAIN_ID ? " · Ada (demo)" : ""}</p>
        <h1>Inbox</h1>
        <p className="lede">
          Payments sealed to your receive address. Your key opens them here, in this browser. Sweep each one into a fresh note only you
          know: until you do, the payer still knows its secret.
        </p>
      </header>
      <VaultGate purpose="Your receive key and the notes you sweep into are secrets.">
        <VaultBar />
        <InboxDesk />
      </VaultGate>
    </main>
  );
}

function InboxDesk() {
  const { net } = useNetwork();
  const w = useMemo(() => wiringFor(net), [net]);
  const vault = useVault();
  if (!w.ok) return <div className="notice bad" role="alert"><strong>NotConfigured</strong> {w.problem}</div>;
  const key = vault.data?.receiveKey ?? null;
  return (
    <div className="stack">
      <ReceiveAddress />
      {key && <Payments w={w.value} receiveKey={key} />}
    </div>
  );
}
