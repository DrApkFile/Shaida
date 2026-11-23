"use client";
// The bot's answer (D30): APPROVE with the facts it relied on, DECLINE with every reason in the policy's order, or
// INCONCLUSIVE with what to do next. Never anything from the link beyond the proof's public facts.
import { formatUnits } from "viem";
import { dateOf } from "@/lib/income/words";
import type { DecisionFacts, DecisionView } from "@/lib/underwrite";

const days = (seconds: string) => (Number(seconds) / 86_400).toFixed(1);

function Facts({ f }: { f: DecisionFacts }) {
  return (
    <dl className="kv">
      <dt>At least</dt><dd className="num">{formatUnits(BigInt(f.threshold), 6)} tUSD8</dd>
      <dt>Payments</dt><dd className="num">{f.count}</dd>
      <dt>Period</dt><dd>{dateOf(BigInt(f.fromDate))} – {dateOf(BigInt(f.toDate))} ({f.periodDays} day{f.periodDays === "1" ? "" : "s"})</dd>
      <dt>Ledger state</dt><dd>{days(f.proofAgeSeconds)} days old</dd>
      <dt>Link expires</dt><dd>{dateOf(BigInt(f.expiry))} ({days(f.secondsLeft)} days left)</dd>
    </dl>
  );
}

export function DecisionCard({ d }: { d: DecisionView }) {
  const head = `${d.policy.title} · ${d.policy.id}@${d.policy.version}`;
  const ids = <p className="fine mono break">decision {d.decisionId.slice(0, 16)}… · proof {d.proofId.slice(0, 16)}… · {d.evaluatedAt}</p>;
  if (d.kind === "APPROVE") {
    return (
      <section className="card tone-sage stack verdict-card" aria-live="polite" data-decision="APPROVE">
        <p className="eyebrow">{head}</p>
        <p className="verdict valid">APPROVE</p>
        <p className="lede">The proof checks out and meets every rule of this policy.</p>
        <Facts f={d.facts} />
        {ids}
      </section>
    );
  }
  if (d.kind === "DECLINE") {
    return (
      <section className="card stack verdict-card" aria-live="polite" data-decision="DECLINE" data-codes={d.reasons.map((r) => r.code).join(",")}>
        <p className="eyebrow">{head}</p>
        <p className="verdict invalid">DECLINE</p>
        <ul className="reasons">
          {d.reasons.map((r) => (
            <li key={r.code}><span className="mono verdict-code">{r.code}</span> {r.message}</li>
          ))}
        </ul>
        {d.facts && <Facts f={d.facts} />}
        {ids}
      </section>
    );
  }
  return (
    <section className="card stack verdict-card" aria-live="polite" data-decision="INCONCLUSIVE" data-codes={d.error.code}>
      <p className="eyebrow">{head}</p>
      <p className="verdict inconclusive">INCONCLUSIVE</p>
      <p className="mono verdict-code">{d.error.code}</p>
      <p className="lede">{d.error.message}</p>
      <p className="fine">Next: {d.error.nextAction}. The bot never approves what it could not check.</p>
      {ids}
    </section>
  );
}
