"use client";
import { useState, type FormEvent } from "react";
import { preparePay, type Note } from "@shaida/pay";
import { shaidaError } from "@shaida/proofs";
import { ProblemBox } from "@/components/ProblemBox";
import { StepList } from "@/components/StepList";
import type { Wiring } from "@/lib/flows";
import type { PayerSigner } from "@/lib/payer";
import { problemOf } from "@/lib/problem";
import { minedOrStop, must, Stop, useRun } from "@/lib/run";
import { useVault } from "@/lib/vault";
import { parseTusd8 } from "./amount";
import { CheckAgain } from "./CheckAgain";
import type { Funds } from "./funds";

const STEPS = [
  { title: "Sync and check the pool tree", detail: "Roots recomputed here and checked on chain" },
  { title: "Prove the private payment", detail: "In this browser, with Gloam's final transfer key" },
  { title: "Save your change note", detail: "Before anything is signed" },
  { title: "Sign the vouch (no gas)", detail: "EIP-712 Vouch: binds the proof to you as a registered payer" },
  { title: "Relayer sends the vouched pay", detail: "ShaidaLedger.vouchedPayFor → pool.transfer" },
  { title: "Post the sealed memo", detail: "Only the recipient's key opens it (amount, note)" },
];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_NOTE = 200;

/** The smallest spendable note that covers the amount (one input per pay: the circuit spends one note). */
const pick = (funds: readonly Note[], amount: bigint) =>
  [...funds].filter((n) => BigInt(n.amountWei) >= amount).sort((a, b) => (BigInt(a.amountWei) < BigInt(b.amountWei) ? -1 : 1))[0];

export function PayCard({ w, payer, funds, onDone }: { w: Wiring; payer: PayerSigner | null; funds: Funds; onDone(): void }) {
  const vault = useVault();
  const run = useRun();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("3");
  const [memo, setMemo] = useState("");
  const value = parseTusd8(amount);

  const go = (e: FormEvent) => {
    e.preventDefault();
    if (!payer || value === null) return;
    void run.start(STEPS, async (at) => {
      at(0);
      const trees = must(await w.trees());
      const source = pick(funds.spendable, value);
      if (!source) throw new Stop(shaidaError("InputRejected", "No single private note covers this amount. Deposit more, or pay less. Nothing was sent."));
      at(1);
      const pay = must(await preparePay(w.ctx, trees, { payer: payer.address, source, amount: value, recipientTag: to.trim(), privateNote: memo.trim() || undefined }).catch((x: unknown) => { throw new Stop(problemOf(x, "proving the payment")); }));
      at(2);
      const at0 = new Date().toISOString();
      await vault.update((d) => ({
        ...d,
        payerNotes: [...d.payerNotes, { note: pay.change, spent: false, label: `change of a ${amount} tUSD8 pay` }],
        sent: [...d.sent, { note: pay.payment, to: to.trim(), at: at0, requestId: null }],
      }));
      at(3);
      const signature = await payer.sign(pay.typedData).catch((x: unknown) => { throw new Stop(problemOf(x, "signing the vouch")); });
      at(4);
      const rec = must(await w.relay.post("vouchedPay", pay.body(signature)));
      minedOrStop(await w.relay.settle(rec.requestId, { sleep }), rec.requestId);
      await vault.update((d) => ({
        ...d,
        payerNotes: d.payerNotes.map((n) => (n.note.commitment === source.commitment ? { ...n, spent: true } : n)),
        sent: d.sent.map((s) => (s.note.commitment === pay.payment.commitment ? { ...s, requestId: rec.requestId } : s)),
      }));
      at(5);
      const m = must(await w.relay.post("memo", pay.memoBody()));
      minedOrStop(await w.relay.settle(m.requestId, { sleep }), m.requestId);
      onDone();
    });
  };

  return (
    <section className="card stack" aria-labelledby="pay">
      <h2 id="pay">2 · Pay a recipient</h2>
      <form className="stack" onSubmit={go}>
        <label className="field">
          <span>Recipient&apos;s receive address (gloamr1.…, from their inbox)</span>
          <textarea value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} placeholder="gloamr1." />
        </label>
        <label className="field">
          <span>Amount (tUSD8)</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={value === null} />
        </label>
        <label className="field">
          <span>Private note for the recipient (optional, sealed: only they can read it)</span>
          <input value={memo} maxLength={MAX_NOTE} onChange={(e) => setMemo(e.target.value)} placeholder="Invoice 7" />
        </label>
        <button className="btn" type="submit" disabled={!payer || value === null || !to.trim().startsWith("gloamr1.") || run.busy}>{run.busy ? "Working…" : "Pay privately"}</button>
      </form>
      {run.steps.length > 0 && <StepList steps={run.steps} />}
      <ProblemBox problem={run.problem} />
      <CheckAgain w={w} requestId={run.unknownRequest} onSettled={onDone} />
    </section>
  );
}
