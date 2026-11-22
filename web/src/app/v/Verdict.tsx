"use client";
// The reader's answer (D27): VALID with threshold, payment count, period as dates and expiry, or the named refusal in
// plain words. Nothing else from the link is shown.
import { formatUnits } from "viem";
import type { IncomeVerification } from "@shaida/proofs";
import type { Wiring } from "@/lib/flows";
import { dateOf, refusalWords } from "@/lib/income/words";
import { OnChain } from "./OnChain";

export function Verdict({ v, w, fragment }: { v: IncomeVerification; w: Wiring; fragment: string }) {
  if (v.status !== "VALID") {
    return (
      <section className="card stack verdict-card" aria-live="polite" data-verdict={v.status} data-code={v.error.code}>
        <p className={`verdict ${v.status === "INVALID" ? "invalid" : "inconclusive"}`}>{v.status === "INVALID" ? "NOT VALID" : "NOT CHECKED YET"}</p>
        <p className="mono verdict-code">{v.error.code}</p>
        <p className="lede">{refusalWords(v.error.code)}</p>
        <p className="fine">Next: {v.error.nextAction}. Nothing was recorded.</p>
      </section>
    );
  }
  return (
    <section className="card tone-sage stack verdict-card" aria-live="polite" data-verdict="VALID">
      <p className="verdict valid">VALID</p>
      <p className="lede">
        Paid at least <strong className="num">{formatUnits(v.threshold, 6)} tUSD8</strong> in <strong className="num">{v.count.toString()}</strong> payment{v.count === 1n ? "" : "s"} from registered payers,
        between {dateOf(v.fromDate)} and {dateOf(v.toDate)}.
      </p>
      <dl className="kv">
        <dt>At least</dt><dd className="num">{formatUnits(v.threshold, 6)} tUSD8</dd>
        <dt>Payments</dt><dd className="num">{v.count.toString()}</dd>
        <dt>Period</dt><dd>{dateOf(v.fromDate)} – {dateOf(v.toDate)}</dd>
        <dt>Link expires</dt><dd>{dateOf(v.expiry)}</dd>
      </dl>
      <OnChain w={w} fragment={fragment} />
    </section>
  );
}
