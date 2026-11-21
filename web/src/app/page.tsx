"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo } from "react";
import { ARTIFACT_FILES, loadCircuit } from "@shaida/pay";
import { CheckIcon, CrossIcon, WarnIcon } from "@/components/Icons";
import { wiringFor } from "@/lib/flows";
import { useNetwork } from "@/lib/network";
import { DEMO_CHAIN_ID } from "@/lib/payer";

type Status = "ok" | "warn" | "bad" | "idle";
interface Check { title: string; status: Status; value: string; detail: string }

const ICON = { ok: <CheckIcon />, warn: <WarnIcon />, bad: <CrossIcon />, idle: <WarnIcon /> };
const fetchBytes = async (url: string) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); };

export default function HomePage() {
  const { net } = useNetwork();
  const w = useMemo(() => wiringFor(net), [net]);
  const relay = useQuery({
    queryKey: ["relay-info", net.chain.id],
    queryFn: async () => (await fetch(`/api/relay?chainId=${net.chain.id}`, { cache: "no-store" })).json() as Promise<{ enabled: boolean; relayer: string | null; reason: { code: string; message: string } | null }>,
  });
  const trees = useQuery({ queryKey: ["home-trees", net.chain.id], enabled: w.ok, queryFn: () => (w.ok ? w.value.trees() : Promise.reject(new Error("not configured"))) });
  const circuits = useQuery({
    queryKey: ["circuits"],
    queryFn: async () => Promise.all((["shield", "transfer"] as const).map((c) => loadCircuit("/gloam", c, fetchBytes))),
    staleTime: Infinity,
  });

  const checks: Check[] = [
    w.ok
      ? { title: "Contracts", status: "ok", value: `pool ${w.value.contracts.pool.slice(0, 10)}…`, detail: `Gloam pool, ShaidaLedger, ShaidaDepositor, PayerRegistry and the memo board on ${net.chain.name}.` }
      : { title: "Contracts", status: "bad", value: "not configured", detail: w.problem },
    !relay.data
      ? { title: "Gasless relayer", status: "idle", value: "—", detail: "Checking…" }
      : relay.data.enabled
        ? { title: "Gasless relayer", status: "ok", value: `${relay.data.relayer?.slice(0, 10)}…`, detail: "Pays gas for deposits, vouched pays, sweeps and memos. One route per contract function." }
        : { title: "Gasless relayer", status: "bad", value: relay.data.reason?.code ?? "off", detail: relay.data.reason?.message ?? "Not available." },
    !trees.data
      ? { title: "Pool and ledger trees", status: "idle", value: "—", detail: "Syncing from /api/index and checking both roots on chain…" }
      : trees.data.ok
        ? { title: "Pool and ledger trees", status: "ok", value: `block ${trees.data.value.block}`, detail: `${trees.data.value.pool.size} pool leaves, ${trees.data.value.ledger.size} ledger leaves; both roots recomputed here and known on chain.` }
        : { title: "Pool and ledger trees", status: "bad", value: trees.data.error.code, detail: trees.data.error.message },
    !circuits.data
      ? { title: "Gloam circuits (final keys)", status: "idle", value: "—", detail: "Checking the served files' sha256…" }
      : circuits.data.every((c) => c.ok)
        ? { title: "Gloam circuits (final keys)", status: "ok", value: "sha256 match", detail: `${ARTIFACT_FILES.shield.zkey.file} and ${ARTIFACT_FILES.transfer.zkey.file} from Gloam's ceremony; proofs are made in this browser.` }
        : { title: "Gloam circuits (final keys)", status: "bad", value: "NotConfigured", detail: circuits.data.map((c) => (c.ok ? "" : c.error.message)).join(" ") },
    !w.ok
      ? { title: "Income-proof key", status: "idle", value: "—", detail: "Needs the contracts first." }
      : w.value.incomeKey.ok
        ? { title: "Income-proof key", status: w.value.incomeKey.value === "final" ? "ok" : "warn", value: w.value.incomeKey.value, detail: w.value.incomeKey.value === "final" ? "The ceremony's final key." : "THROWAWAY key: forgeable by whoever made it. Allowed on local chains only; refused on Aevum 44005." }
        : { title: "Income-proof key", status: "bad", value: w.value.incomeKey.error.code, detail: w.value.incomeKey.error.message },
  ];

  return (
    <main className="shell stack page">
      <header className="page-head">
        <p className="eyebrow">Shaida · {net.chain.name} ({net.chain.id})</p>
        <h1>Private payments a registered payer vouches for</h1>
        <p className="lede">
          A registered payer deposits tUSD8 into Gloam&apos;s private pool without gas and pays a recipient&apos;s receive address. The chain
          records that a registered payer paid someone, not who or how much. The recipient sweeps each payment into a note only they know.
        </p>
      </header>
      {net.chain.id === DEMO_CHAIN_ID && (
        <div className="notice warn"><span><span className="demo-tag">Demo</span> Local fork. The personas Acme Studio (demo) and Ada (demo) are not real businesses or people.</span></div>
      )}
      <div className="grid-2">
        <Link className="card stack" href="/pay"><h2>Pay →</h2><p className="sub">Deposit with a signature, then pay a receive address privately.</p></Link>
        <Link className="card stack" href="/inbox"><h2>Inbox →</h2><p className="sub">Get a receive address, see payments sealed to it, sweep them.</p></Link>
      </div>
      <section className="card" aria-label="Status">
        {checks.map((c) => (
          <div key={c.title} className="check">
            <span className={`chip ${c.status}`} aria-hidden="true">{ICON[c.status]}</span>
            <div className="check-body">
              <div className="check-top"><span className="check-title">{c.title}</span><span className="check-value mono">{c.value}</span></div>
              <p className="check-detail">{c.detail}</p>
            </div>
          </div>
        ))}
      </section>
      <p className="fine">
        Built on Gloam (MIT) and the Aevum Starter Kit (MIT). See NOTICE.md.
      </p>
    </main>
  );
}
