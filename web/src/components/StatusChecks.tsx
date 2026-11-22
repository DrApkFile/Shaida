"use client";
// What this app is wired to on the selected network, each line checked here (moved from the old home page, D26).
import { useQuery } from "@tanstack/react-query";
import { ARTIFACT_FILES, INCOME_ARTIFACTS, loadCircuit } from "@shaida/pay";
import { CheckIcon, CrossIcon, WarnIcon } from "@/components/Icons";
import type { Wiring } from "@/lib/flows";
import { incomeArtifacts } from "@/lib/income/prover";
import type { Network } from "@/lib/env";

type Status = "ok" | "warn" | "bad" | "idle";
interface Check { title: string; status: Status; value: string; detail: string }

const ICON = { ok: <CheckIcon />, warn: <WarnIcon />, bad: <CrossIcon />, idle: <WarnIcon /> };
const fetchBytes = async (url: string) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); };

export function StatusChecks({ net, w }: { net: Network; w: { ok: true; value: Wiring } | { ok: false; problem: string } }) {
  const relay = useQuery({
    queryKey: ["relay-info", net.chain.id],
    queryFn: async () => (await fetch(`/api/relay?chainId=${net.chain.id}`, { cache: "no-store" })).json() as Promise<{ enabled: boolean; relayer: string | null; reason: { code: string; message: string } | null }>,
  });
  const trees = useQuery({ queryKey: ["home-trees", net.chain.id], enabled: w.ok, queryFn: () => (w.ok ? w.value.trees() : Promise.reject(new Error("not configured"))) });
  const circuits = useQuery({
    queryKey: ["circuits"],
    queryFn: async () => Promise.all((["shield", "transfer", "unshield"] as const).map((c) => loadCircuit("/gloam", c, fetchBytes))),
    staleTime: Infinity,
  });
  const income = useQuery({ queryKey: ["income-artifacts"], queryFn: incomeArtifacts, staleTime: Infinity });

  const checks: Check[] = [
    w.ok
      ? { title: "Contracts", status: "ok", value: `pool ${w.value.contracts.pool.slice(0, 10)}…`, detail: `Gloam pool, ShaidaLedger, ShaidaDepositor, PayerRegistry, the memo board and IncomeVerifier on ${net.chain.name}.` }
      : { title: "Contracts", status: "bad", value: "not configured", detail: w.problem },
    !relay.data
      ? { title: "Gasless relayer", status: "idle", value: "—", detail: "Checking…" }
      : relay.data.enabled
        ? { title: "Gasless relayer", status: "ok", value: `${relay.data.relayer?.slice(0, 10)}…`, detail: "Pays gas for deposits, vouched pays, sweeps, memos and withdrawals. One route per contract function." }
        : { title: "Gasless relayer", status: "bad", value: relay.data.reason?.code ?? "off", detail: relay.data.reason?.message ?? "Not available." },
    !trees.data
      ? { title: "Pool and ledger trees", status: "idle", value: "—", detail: "Syncing from /api/index and checking both roots on chain…" }
      : trees.data.ok
        ? { title: "Pool and ledger trees", status: "ok", value: `block ${trees.data.value.block}`, detail: `${trees.data.value.pool.size} pool leaves, ${trees.data.value.ledger.size} ledger leaves; both roots recomputed here and known on chain.` }
        : { title: "Pool and ledger trees", status: "bad", value: trees.data.error.code, detail: trees.data.error.message },
    !circuits.data
      ? { title: "Gloam circuits (final keys)", status: "idle", value: "—", detail: "Checking the served files' sha256…" }
      : circuits.data.every((c) => c.ok)
        ? { title: "Gloam circuits (final keys)", status: "ok", value: "sha256 match", detail: `${ARTIFACT_FILES.shield.zkey.file}, ${ARTIFACT_FILES.transfer.zkey.file} and ${ARTIFACT_FILES.unshield.zkey.file} from Gloam's ceremony; proofs are made in this browser.` }
        : { title: "Gloam circuits (final keys)", status: "bad", value: "NotConfigured", detail: circuits.data.map((c) => (c.ok ? "" : c.error.message)).join(" ") },
    !income.data
      ? { title: "Income-proof key (final)", status: "idle", value: "—", detail: "Checking the served wasm and zkey against the pins…" }
      : income.data.ok && w.ok && w.value.incomeKey.ok && w.value.incomeKey.value === "final"
        ? { title: "Income-proof key (final)", status: "ok", value: `zkey ${INCOME_ARTIFACTS.zkey.sha256.slice(0, 12)}…`, detail: "Shaida's ceremony key (release ceremony-v1), served from this site and checked by sha256 here." }
        : { title: "Income-proof key (final)", status: "bad", value: "NotConfigured", detail: !income.data.ok ? income.data.error.message : w.ok && w.value.incomeKey.ok ? "A THROWAWAY key is configured: the prove and verify screens refuse it (D27)." : w.ok && !w.value.incomeKey.ok ? w.value.incomeKey.error.message : "Needs the contracts first." },
  ];

  return (
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
  );
}
