"use client";
import { useState, type FormEvent } from "react";
import { prepareDeposit } from "@shaida/pay";
import { ProblemBox } from "@/components/ProblemBox";
import { StepList } from "@/components/StepList";
import type { Wiring } from "@/lib/flows";
import type { PayerSigner } from "@/lib/payer";
import { problemOf } from "@/lib/problem";
import { minedOrStop, must, Stop, useRun } from "@/lib/run";
import { useVault } from "@/lib/vault";
import { parseTusd8 } from "./amount";
import { CheckAgain } from "./CheckAgain";

const STEPS = [
  { title: "Make a private note and prove it", detail: "In this browser, with Gloam's final shield key" },
  { title: "Save the note to your vault", detail: "Before anything is signed: it is the only copy" },
  { title: "Sign the deposit (no gas)", detail: "EIP-3009 ReceiveWithAuthorization, bound to the note" },
  { title: "Relayer sends it", detail: "ShaidaDepositor.depositWithAuthorization → pool.shieldBound" },
  { title: "Confirmed", detail: "The note is in the pool once the index sees it" },
];

export function DepositCard({ w, payer, onDone }: { w: Wiring; payer: PayerSigner | null; onDone(): void }) {
  const vault = useVault();
  const run = useRun();
  const [amount, setAmount] = useState("10");
  const value = parseTusd8(amount);

  const go = (e: FormEvent) => {
    e.preventDefault();
    if (!payer || value === null) return;
    void run.start(STEPS, async (at) => {
      at(0);
      const prepared = await prepareDeposit(w.ctx, payer.address, value).catch((x: unknown) => { throw new Stop(problemOf(x, "proving the deposit")); });
      at(1);
      await vault.update((d) => ({ ...d, payerNotes: [...d.payerNotes, { note: prepared.note, spent: false, label: `deposit ${amount} tUSD8` }] }));
      at(2);
      const signature = await payer.sign(prepared.typedData).catch((x: unknown) => { throw new Stop(problemOf(x, "signing the deposit")); });
      at(3);
      const rec = must(await w.relay.post("deposit", prepared.body(signature)));
      at(4);
      minedOrStop(await w.relay.settle(rec.requestId, { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }), rec.requestId);
      onDone();
    });
  };

  return (
    <section className="card stack" aria-labelledby="deposit">
      <h2 id="deposit">1 · Deposit (gasless)</h2>
      <form className="stack" onSubmit={go}>
        <label className="field">
          <span>Amount (tUSD8)</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={value === null} />
        </label>
        <button className="btn" type="submit" disabled={!payer || value === null || run.busy}>{run.busy ? "Working…" : "Deposit privately"}</button>
        {!payer && <p className="fine">Choose who is paying above first.</p>}
      </form>
      {run.steps.length > 0 && <StepList steps={run.steps} />}
      <ProblemBox problem={run.problem} />
      <CheckAgain w={w} requestId={run.unknownRequest} onSettled={onDone} />
    </section>
  );
}
