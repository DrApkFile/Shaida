"use client";
// Dashboard overview (D26): one card per section with counts from this browser's vault (— until it is open), then
// the status of everything the app is wired to on this network.
import Link from "next/link";
import { useMemo } from "react";
import type { VaultData } from "@shaida/pay";
import { ArrowUpRightIcon } from "@/components/Icons";
import { StatusChecks } from "@/components/StatusChecks";
import { wiringFor } from "@/lib/flows";
import { useNetwork } from "@/lib/network";
import { DEMO_CHAIN_ID } from "@/lib/payer";
import { useVault } from "@/lib/vault";

interface Section { href: string; tone: string; title: string; text: string; count: (d: VaultData, now: number) => number; unit: string }

const SECTIONS: readonly Section[] = [
  { href: "/app/pay", tone: "tone-lemon", title: "Pay", text: "As a payer: deposit with a signature, then pay a receive address privately.", count: (d) => d.sent.length, unit: "payments sent" },
  { href: "/app/inbox", tone: "tone-sage", title: "Inbox", text: "Payments sealed to your receive address. Sweep each into a note only you know.", count: (d) => d.inbox.filter((e) => e.state === "swept").length, unit: "payments swept" },
  { href: "/app/prove", tone: "tone-peach", title: "Prove", text: "Prove you earned at least an amount over a period, for one named reader.", count: (d) => d.inbox.filter((e) => e.state === "swept").length, unit: "swept: the prove screen shows which count" },
  { href: "/app/shared", tone: "tone-rose", title: "Shared proofs", text: "Links made in this browser, with their reader and expiry.", count: (d, now) => d.shared.filter((s) => s.expiry > now).length, unit: "links not expired" },
];

export default function DashboardPage() {
  const { net } = useNetwork();
  const w = useMemo(() => wiringFor(net), [net]);
  const vault = useVault();
  const d = vault.status === "open" ? vault.data : null;
  const now = Math.floor(Date.now() / 1000);
  return (
    <main className="shell stack page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Dashboard · {net.chain.name} ({net.chain.id})</p>
          <h1>Your private payments</h1>
          <p className="lede">Everything here is read from the chain or from the vault in this browser. Secrets never leave it.</p>
        </div>
      </header>
      {net.chain.id === DEMO_CHAIN_ID && (
        <div className="notice warn"><span><span className="demo-tag">Demo</span> Local fork. The personas Acme Studio (demo), Ada (demo) and Landlord Bola (demo) are not real businesses or people.</span></div>
      )}
      {!d && <p className="fine">{vault.status === "none" ? "No vault in this browser yet: open Pay or Inbox to create one." : "Vault locked: counts show — until you unlock it in any section."}</p>}
      <div className="grid-4">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className={`card stack ${s.tone}`}>
            <div className="row-between"><h2>{s.title}</h2><span className="corner-link" aria-hidden="true"><ArrowUpRightIcon /></span></div>
            <div><div className="big-num">{d ? s.count(d, now) : "—"}</div><div className="stat-label">{s.unit}</div></div>
            <p className="sub">{s.text}</p>
          </Link>
        ))}
      </div>
      <StatusChecks net={net} w={w} />
    </main>
  );
}
