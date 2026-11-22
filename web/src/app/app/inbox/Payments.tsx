"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatUnits } from "viem";
import { chainViewOf, openInbox, type ChainView, type IncomingPayment, type VaultData } from "@shaida/pay";
import { ProblemBox } from "@/components/ProblemBox";
import type { Wiring } from "@/lib/flows";
import type { Problem } from "@/lib/problem";
import { useTrees } from "@/lib/useTrees";
import { useVault } from "@/lib/vault";
import { entryOf, settleEntry, sweepOne } from "./sweep";

type Row = { p: IncomingPayment; view: ChainView };

function label(row: Row, d: VaultData | null): { cls: string; text: string } {
  const e = entryOf(d, row.p.note.commitment);
  if (e.state === "swept") return { cls: "swept", text: "swept: yours alone" };
  if (e.state === "sweeping") return { cls: "sweeping", text: "sweeping…" };
  if (e.state === "unknown") return { cls: "unknown", text: "unknown: checking, never resent" };
  if (row.view.kind === "unspent") return { cls: "seen", text: "seen: sweep it" };
  if (row.view.kind === "unvouched") return { cls: "lost", text: "not vouched by a registered payer" };
  if (row.view.kind === "not-in-pool") return { cls: "lost", text: "not in the pool yet" };
  return { cls: "lost", text: "spent by someone else (the payer took it back)" };
}

export function Payments({ w, receiveKey }: { w: Wiring; receiveKey: NonNullable<VaultData["receiveKey"]> }) {
  const vault = useVault();
  const trees = useTrees(w);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const t = trees.data?.ok ? trees.data.value : null;
  const rows = useQuery({
    queryKey: ["inbox", w.net.chain.id, t?.block.toString(), receiveKey.tag],
    enabled: Boolean(t),
    queryFn: async (): Promise<Row[]> => {
      if (!t) return [];
      const found = await openInbox(t.snapshot.memos, receiveKey, w.ctx);
      return Promise.all(found.map(async (p) => ({ p, view: await chainViewOf(t, p, w.isSpent) })));
    },
  });

  const act = async (row: Row, kind: "sweep" | "check") => {
    if (!vault.data) return;
    setBusy(row.p.note.commitment);
    setProblem(null);
    try {
      const e = entryOf(vault.data, row.p.note.commitment);
      const rec = kind === "check" && e.requestId ? await w.relay.status(e.requestId) : null;
      const out = kind === "sweep" ? await sweepOne(w, vault.update, vault.data, row.p) : await settleEntry(w, vault.update, row.p, rec?.ok ? rec.value : null);
      setProblem(out);
    } finally {
      setBusy(null);
      void trees.refetch();
    }
  };
  const sweepAll = async () => {
    for (const row of rows.data ?? []) {
      if (row.view.kind === "unspent" && entryOf(vault.data, row.p.note.commitment).state === "seen") await act(row, "sweep");
    }
  };

  const list = rows.data ?? [];
  const swept = list.filter((r) => entryOf(vault.data, r.p.note.commitment).state === "swept").reduce((a, r) => a + BigInt(r.p.note.amountWei), 0n);
  const open = list.filter((r) => r.view.kind === "unspent" && entryOf(vault.data, r.p.note.commitment).state === "seen");
  const treeProblem = trees.data && !trees.data.ok ? trees.data.error : null;
  return (
    <section className="card stack" aria-labelledby="payments">
      <div className="row-between">
        <h2 id="payments">Incoming payments</h2>
        <button className="btn ghost small" type="button" onClick={() => void trees.refetch()} disabled={trees.isFetching}>{trees.isFetching ? "Syncing…" : "Resync"}</button>
      </div>
      <p className="sub">{t ? `${list.length} payment(s) to you on the memo board, checked at block ${t.block}. Swept: ${formatUnits(swept, 6)} tUSD8.` : "Syncing the memo board…"}</p>
      <ProblemBox problem={treeProblem} />
      {list.length > 0 && (
        <ul className="payments">
          {list.map((row) => {
            const l = label(row, vault.data);
            const e = entryOf(vault.data, row.p.note.commitment);
            const mine = busy === row.p.note.commitment;
            return (
              <li key={row.p.note.commitment} className="payment">
                <div>
                  <div className="payment-amount num">{formatUnits(BigInt(row.p.note.amountWei), 6)} tUSD8</div>
                  <div className="sub">{row.p.privateNote ?? "No note"} · memo block {row.p.memoBlock.toString()}</div>
                </div>
                <div className="row">
                  <span className={`state ${l.cls}`}>{l.text}</span>
                  {e.state === "seen" && row.view.kind === "unspent" && <button className="btn small" type="button" disabled={Boolean(busy)} onClick={() => void act(row, "sweep")}>{mine ? "Sweeping…" : "Sweep"}</button>}
                  {(e.state === "sweeping" || e.state === "unknown") && <button className="btn secondary small" type="button" disabled={Boolean(busy)} onClick={() => void act(row, "check")}>Check again</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {open.length > 1 && <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void sweepAll()}>Sweep all {open.length}</button>}
      <ProblemBox problem={problem} />
    </section>
  );
}
