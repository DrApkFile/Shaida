"use client";
// Batch withdrawal of swept notes (pool.unshield via the relayer). A sent withdrawal is never resent: its outcome is
// read from the chain by the note's nullifier.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatUnits, isAddress, type Address } from "viem";
import { prepareWithdraw, sweptNotes, type Note, type Withdrawal } from "@shaida/pay";
import { ProblemBox } from "@/components/ProblemBox";
import type { Wiring } from "@/lib/flows";
import { problemOf, type Problem } from "@/lib/problem";
import { useTrees } from "@/lib/useTrees";
import { useVault } from "@/lib/vault";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const tusd = (wei: string | bigint) => `${formatUnits(BigInt(wei), 6)} tUSD8`;

export function Withdraw({ w }: { w: Wiring }) {
  const vault = useVault();
  const trees = useTrees(w);
  const t = trees.data?.ok ? trees.data.value : null;
  const notes = sweptNotes(vault.data?.inbox ?? []);
  const sent = vault.data?.withdrawals ?? [];
  const spent = useQuery({
    queryKey: ["withdraw-spent", w.net.chain.id, t?.block.toString(), notes.length],
    enabled: Boolean(t),
    queryFn: async () => new Set((await Promise.all(notes.map(async (n) => ((t && (await w.isSpent(n.nullifier, t.block))) ? n.nullifier : null)))).filter((x): x is Note["nullifier"] => x !== null)),
  });
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const recordOf = (n: Note): Withdrawal | undefined => sent.find((s) => s.nullifier === n.nullifier);
  const open = notes.filter((n) => !spent.data?.has(n.nullifier) && !recordOf(n));
  const chosen = open.filter((n) => picked.has(n.nullifier));
  const total = chosen.reduce((a, n) => a + BigInt(n.amountWei), 0n);
  const toOk = isAddress(to);

  const withdrawAll = async () => {
    if (!toOk || !vault.data) return;
    setProblem(null);
    for (const n of chosen) {
      setBusy(n.nullifier);
      try {
        const fresh = await w.trees();
        if (!fresh.ok) { setProblem(fresh.error); return; }
        const prepared = await prepareWithdraw(w.withdraw, fresh.value, n, to as Address);
        if (!prepared.ok) { setProblem(prepared.error); return; }
        const reply = await w.relay.post("unshield", prepared.value.body());
        if (!reply.ok) { setProblem(reply.error); return; } // refused: nothing was sent, nothing recorded
        const rec: Withdrawal = { nullifier: n.nullifier, to: prepared.value.to, amountWei: n.amountWei, requestId: reply.value.requestId, hash: reply.value.hash, at: new Date().toISOString() };
        await vault.update((d) => ({ ...d, withdrawals: [...d.withdrawals, rec] }));
        const settled = await w.relay.settle(reply.value.requestId, { sleep });
        if (!settled.ok) { setProblem(settled.error); return; }
        if (settled.value.state !== "mined" || settled.value.reverted) { setProblem(settled.value.error ?? { code: "TxOutcomeUnknown", message: `The withdrawal is ${settled.value.state}. It is checked by its hash and never sent again.` }); return; }
      } catch (e) {
        setProblem(problemOf(e, "proving the withdrawal"));
        return;
      } finally {
        setBusy(null);
      }
    }
    setPicked(new Set());
    void trees.refetch();
  };

  return (
    <section className="card stack" aria-labelledby="withdraw">
      <h2 id="withdraw">Swept notes</h2>
      <div className="notice warn" role="note">
        <strong>Withdrawals are public and reveal their amounts.</strong> Anyone can see how much left the pool and to which
        address. Withdraw rarely, at a quiet time, to a fresh address you control that has no link to whoever paid you or
        funded them, and never send it on to them. If you split a sweep, withdraw its two notes at different times.
      </div>
      <ProblemBox problem={trees.data && !trees.data.ok ? trees.data.error : null} />
      {notes.length === 0 ? (
        <p className="sub">No swept notes in this vault yet. Sweep payments in Inbox first.</p>
      ) : (
        <ul className="payments">
          {notes.map((n) => {
            const rec = recordOf(n);
            const gone = spent.data?.has(n.nullifier) ?? false;
            const state = gone ? (rec ? `withdrawn to ${rec.to.slice(0, 8)}…` : "spent") : rec ? "sent: checking, never resent" : busy === n.nullifier ? "withdrawing…" : "in the pool";
            return (
              <li key={n.nullifier} className="payment withdraw-note">
                <label className="row">
                  <input type="checkbox" disabled={gone || Boolean(rec) || Boolean(busy)} checked={picked.has(n.nullifier)}
                    onChange={(e) => setPicked((p) => { const q = new Set(p); if (e.target.checked) q.add(n.nullifier); else q.delete(n.nullifier); return q; })} />
                  <span className="payment-amount num">{tusd(n.amountWei)}</span>
                </label>
                <span className={`state ${gone ? "swept" : rec ? "unknown" : "seen"}`}>{state}</span>
              </li>
            );
          })}
        </ul>
      )}
      {open.length > 0 && (
        <>
          <label className="field">
            <span>To address</span>
            <input name="to" autoComplete="off" spellCheck={false} placeholder="0x… a fresh address you control" value={to} aria-invalid={to !== "" && !toOk} onChange={(e) => setTo(e.target.value.trim())} />
          </label>
          <button className="btn" type="button" disabled={!toOk || chosen.length === 0 || Boolean(busy)} onClick={() => void withdrawAll()}>
            {busy ? "Withdrawing…" : chosen.length ? `Withdraw ${chosen.length} note${chosen.length > 1 ? "s" : ""} (${tusd(total)})` : "Pick notes to withdraw"}
          </button>
        </>
      )}
      <ProblemBox problem={problem} />
    </section>
  );
}
