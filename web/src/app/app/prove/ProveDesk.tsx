"use client";
// What a proof can count (D27): my opened payments against the checked ledger tree, each with its V leaf's date.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { incomeCandidates, openInbox, type NotCountable, type VaultData } from "@shaida/pay";
import { ProblemBox } from "@/components/ProblemBox";
import type { Wiring } from "@/lib/flows";
import { leafTimes } from "@/lib/income/chain";
import { dateOf } from "@/lib/income/words";
import { useTrees } from "@/lib/useTrees";
import { useVault } from "@/lib/vault";
import { ProveForm } from "./ProveForm";

const WHY: Record<NotCountable, string> = {
  "not-vouched": "not counted: no registered payer vouched for it",
  "not-swept": "not counted yet: sweep it in Inbox first",
  "swept-elsewhere": "not counted: someone else swept it (the payer took it back)",
};

export function ProveDesk({ w, receiveKey }: { w: Wiring; receiveKey: NonNullable<VaultData["receiveKey"]> }) {
  const vault = useVault();
  const trees = useTrees(w);
  const t = trees.data?.ok ? trees.data.value : null;
  const data = useQuery({
    // Keyed on the leaves and memos, not the block: the trees refetch every 15 s, and a new block with nothing new in it
    // must not unmount the form below (it held the typed fields and a built link). New leaves are only appended.
    queryKey: ["prove-inputs", w.net.chain.id, t?.snapshot.ledgerLeaves.length, t?.snapshot.memos.length, receiveKey.tag, vault.data?.inbox.length],
    enabled: Boolean(t && vault.data),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (!t || !vault.data) throw new Error("not ready");
      const [payments, leaves] = await Promise.all([openInbox(t.snapshot.memos, receiveKey, w.ctx), leafTimes(w, t)]);
      return { leaves, candidates: incomeCandidates(t, payments, vault.data.inbox) };
    },
  });
  const treeProblem = trees.data && !trees.data.ok ? trees.data.error : null;
  if (treeProblem) return <ProblemBox problem={treeProblem} />;
  if (!t || data.isPending) return <div className="card"><p className="sub" aria-busy="true">Syncing the ledger and opening your payments…</p></div>;
  if (data.isError) return <div className="notice bad" role="alert"><strong className="mono">RangeUnresolvable</strong> Could not read your payments or their block times: {data.error.message}. Nothing was built.</div>;
  const { candidates, leaves } = data.data;
  const timeOf = (index: number) => leaves.find((l) => l.index === index)?.time ?? null;

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="countable">
        <div className="row-between">
          <h2 id="countable">Payments a proof can count</h2>
          <span className="status-pill good">{candidates.countable.length} countable</span>
        </div>
        <p className="sub">Read at block {t.block.toString()}. Only you see this list; the reader sees a total, a count and dates.</p>
        {candidates.countable.length === 0 && candidates.notCountable.length === 0 && (
          <div className="empty"><strong>No payments yet</strong><span>Payments sealed to your receive address show here once they arrive.</span></div>
        )}
        <ul className="payments">
          {candidates.countable.map((c) => {
            const time = timeOf(c.vouchIndex);
            return (
              <li key={c.commitment} className="payment countable">
                <span className="payment-amount">{formatUnits(c.amount, 6)} <small>tUSD8</small></span>
                <span className="fine">paid {time === null ? "—" : dateOf(time)} · leaf {c.vouchIndex}</span>
                <span className="state swept">counts</span>
              </li>
            );
          })}
          {candidates.notCountable.map((c) => (
            <li key={c.commitment} className="payment not-countable">
              <span className="payment-amount">{formatUnits(c.amount, 6)} <small>tUSD8</small></span>
              <span className="state lost">{WHY[c.reason]}</span>
            </li>
          ))}
        </ul>
      </section>
      <ProveForm w={w} t={t} leaves={leaves} countable={candidates.countable} />
    </div>
  );
}
