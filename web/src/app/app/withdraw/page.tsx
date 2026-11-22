"use client";
// Withdraw: unshield swept notes to an address the recipient chose. Public by nature (LIMITS.md), so never automatic.
import { useMemo } from "react";
import { VaultBar, VaultGate } from "@/components/VaultGate";
import { wiringFor } from "@/lib/flows";
import { useNetwork } from "@/lib/network";
import { Withdraw } from "./Withdraw";

export default function WithdrawPage() {
  return (
    <main className="shell stack page">
      <header className="page-head">
        <p className="eyebrow">Recipient</p>
        <h1>Withdraw</h1>
        <p className="lede">Take swept tUSD8 out of the pool to a wallet. Each swept note leaves in full, in one public transaction.</p>
      </header>
      <VaultGate purpose="Your swept notes are secrets: only this browser can withdraw them.">
        <VaultBar />
        <Desk />
      </VaultGate>
    </main>
  );
}

function Desk() {
  const { net } = useNetwork();
  const w = useMemo(() => wiringFor(net), [net]);
  if (!w.ok) return <div className="notice bad" role="alert"><strong>NotConfigured</strong> {w.problem}</div>;
  return <Withdraw w={w.value} />;
}
