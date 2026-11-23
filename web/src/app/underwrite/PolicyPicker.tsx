"use client";
// The bot's presets as a choice (D30), each with its rules written out, so the holder sees what the bot will check.
import { formatUnits } from "viem";
import type { PresetView } from "@/lib/underwrite";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function PolicyPicker({ presets, chosen, onChoose }: { presets: readonly PresetView[]; chosen: PresetView; onChoose: (id: string) => void }) {
  return (
    <section className="card stack" aria-labelledby="policy">
      <h2 id="policy">1. Pick a policy</h2>
      <div className="net-switch policy-switch" role="radiogroup" aria-label="Policy">
        {presets.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={p.id === chosen.id} onClick={() => onChoose(p.id)}>
            {p.title}
          </button>
        ))}
      </div>
      <dl className="kv">
        <dt>At least</dt><dd className="num">{formatUnits(BigInt(chosen.minThreshold), 6)} tUSD8</dd>
        <dt>Payments</dt><dd>{plural(chosen.minPayments, "payment")} or more</dd>
        <dt>Period</dt><dd>{chosen.minPeriodDays === chosen.maxPeriodDays ? plural(chosen.minPeriodDays, "day") : `${chosen.minPeriodDays}–${chosen.maxPeriodDays} days`} of the ledger</dd>
        <dt>Proof age</dt><dd>built on ledger state at most {plural(chosen.maxProofAgeDays, "day")} old</dd>
        <dt>Link life</dt><dd>at least {plural(chosen.minDaysLeft, "day")} left before it expires</dd>
        <dt>Made out to</dt><dd><strong>{chosen.readerName}</strong></dd>
      </dl>
      <p className="fine mono">{chosen.id}@{chosen.version} · policy hash {chosen.hash.slice(0, 16)}…</p>
    </section>
  );
}
