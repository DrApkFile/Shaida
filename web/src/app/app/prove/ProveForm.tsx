"use client";
// The prove form (D27): period as dates, threshold on the share step (with the nearest valid amounts offered),
// reader name and expiry; then the build with a progress bar by stage, and the /v#… link.
import { useState } from "react";
import { formatUnits } from "viem";
import type { CheckedTrees } from "@shaida/index";
import type { CountablePayment } from "@shaida/pay";
import { nearestValidThresholds, readerIdHashOf, type TimedLeaf } from "@shaida/proofs";
import { ProblemBox } from "@/components/ProblemBox";
import type { Wiring } from "@/lib/flows";
import { endOfDay, isoDate, isoInDays, startOfDay } from "@/lib/income/dates";
import type { Problem } from "@/lib/problem";
import { useVault } from "@/lib/vault";
import { parseTusd8 } from "../pay/amount";
import { buildLink, type Built, type Stage } from "./build";
import { LinkResult } from "./LinkResult";

const STEPS = [1_000_000n, 5_000_000n, 10_000_000n] as const;
const MAX_EXPIRY_DAYS = 365;

export function ProveForm({ w, t, leaves, countable }: { w: Wiring; t: CheckedTrees; leaves: readonly TimedLeaf[]; countable: readonly CountablePayment[] }) {
  const vault = useVault();
  const timeOf = (i: number) => leaves.find((l) => l.index === i)?.time ?? null;
  const first = countable.map((c) => timeOf(c.vouchIndex)).find((x): x is bigint => x !== null);
  const [from, setFrom] = useState(first === undefined ? isoInDays(-30) : isoDate(first));
  const [to, setTo] = useState(isoInDays(0));
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<bigint>(STEPS[0]);
  const [reader, setReader] = useState("");
  const [expiry, setExpiry] = useState(isoInDays(30));
  const [stage, setStage] = useState<Stage | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);

  const start = startOfDay(from);
  const end = endOfDay(to);
  const inPeriod = start !== null && end !== null ? countable.filter((c) => { const x = timeOf(c.vouchIndex); return x !== null && x >= start && x <= end; }) : [];
  const total = inPeriod.reduce((a, c) => a + c.amount, 0n);
  const most = (total / step) * step;
  const threshold = parseTusd8(amount);
  const fit = threshold === null ? null : nearestValidThresholds(threshold, step);
  const expiryEnd = endOfDay(expiry);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const readerOk = readerIdHashOf(reader).ok;

  const why = [
    start === null || end === null ? "Pick both dates of the period." : start > end ? "The period ends before it starts." : null,
    !readerOk ? "Type the reader's name (1–96 bytes)." : null,
    threshold === null ? "Type an amount in tUSD8, like 9 or 9.5." : !fit?.valid ? "The amount must be a whole multiple of the step." : null,
    expiryEnd === null ? "Pick an expiry date." : expiryEnd <= nowSec ? "The expiry must be in the future." : expiryEnd > nowSec + BigInt(MAX_EXPIRY_DAYS * 86_400) ? `The expiry must be within ${MAX_EXPIRY_DAYS} days.` : null,
  ].filter((x): x is string => x !== null);

  const build = async () => {
    if (why.length || start === null || end === null || threshold === null || expiryEnd === null) return;
    setProblem(null); setBuilt(null);
    setStage({ done: 0, total: 3, label: "Starting" });
    try {
      const r = await buildLink(w, t, leaves, countable, { reader, start, end, threshold, step, expiry: expiryEnd }, setStage);
      if (!r.ok) { setProblem(r.error); return; }
      await vault.update((d) => ({ ...d, shared: [...d.shared, r.value.shared] }));
      setBuilt(r.value);
    } finally {
      setStage(null);
    }
  };

  return (
    <section className="card stack" aria-labelledby="prove">
      <h2 id="prove">Make a proof link</h2>
      <div className="fields-2">
        <label className="field"><span>From</span><input type="date" name="from" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span>To</span><input type="date" name="to" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <p className="fine period-summary">
        In this period: {inPeriod.length} countable payment(s), {formatUnits(total, 6)} tUSD8. You can show up to {formatUnits(most, 6)} tUSD8 in steps of {formatUnits(step, 6)}.
      </p>
      <div className="fields-2">
        <label className="field">
          <span>At least (tUSD8)</span>
          <input name="threshold" inputMode="decimal" placeholder={formatUnits(most, 6)} value={amount} aria-invalid={fit !== null && !fit.valid} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field">
          <span>Rounding step</span>
          <select name="step" value={step.toString()} onChange={(e) => setStep(BigInt(e.target.value))}>
            {STEPS.map((s) => <option key={s.toString()} value={s.toString()}>{formatUnits(s, 6)} tUSD8</option>)}
          </select>
        </label>
      </div>
      {fit && !fit.valid && (
        <div className="suggest" role="status">
          <span>{formatUnits(threshold ?? 0n, 6)} is not a multiple of {formatUnits(step, 6)}. Use:</span>
          {fit.below !== null && <button type="button" className="btn secondary small" onClick={() => setAmount(formatUnits(fit.below ?? 0n, 6))}>{formatUnits(fit.below, 6)} tUSD8</button>}
          <button type="button" className="btn secondary small" onClick={() => setAmount(formatUnits(fit.above, 6))}>{formatUnits(fit.above, 6)} tUSD8</button>
        </div>
      )}
      <div className="fields-2">
        <label className="field">
          <span>Reader&apos;s name</span>
          <input name="reader" autoComplete="off" placeholder="Landlord Bola" value={reader} onChange={(e) => setReader(e.target.value)} />
          <span className="hint">Only this name opens the link. Case and spacing don&apos;t matter.</span>
        </label>
        <label className="field"><span>Expires</span><input type="date" name="expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
      </div>
      {why.length > 0 && <ul className="fine form-why">{why.map((x) => <li key={x}>{x}</li>)}</ul>}
      <button className="btn big" type="button" onClick={() => void build()} disabled={why.length > 0 || stage !== null}>
        {stage ? "Building…" : "Build proof link"}
      </button>
      {stage && (
        <div className="stack tight" aria-live="polite">
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={stage.total} aria-valuenow={stage.done}><span style={{ width: `${(100 * stage.done) / stage.total}%` }} /></div>
          <p className="fine">Step {Math.min(stage.done + 1, stage.total)} of {stage.total}: {stage.label}. Your notes stay in this tab.</p>
        </div>
      )}
      <ProblemBox problem={problem} />
      {built && <LinkResult built={built} />}
    </section>
  );
}
