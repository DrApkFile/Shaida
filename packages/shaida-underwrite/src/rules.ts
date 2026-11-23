// The policy rules (D30), evaluated in this fixed order over the facts of a VALID proof. Pure; every number is a
// bigint in tUSD8 base units or unix seconds. A rule returns null when it holds, or its reason.
import type { RuleCode } from "./codes";
import type { Policy } from "./policy";

export const DAY = 86_400n;

/** What a VALID verification and the ledger say about a link, at `now` (all unix seconds). */
export interface ProofFacts {
  /** Σ of the proofs' thresholds: the bundle proves at least this much. */
  readonly threshold: bigint;
  readonly count: bigint;
  /** Block times of the first and last vouch leaf inside the bundle's leaf range (PRD §5 step 8). */
  readonly fromDate: bigint;
  readonly toDate: bigint;
  readonly expiry: bigint;
  /** Block time of the ledger leaf that formed the proof's root: the proof was built at or after it. */
  readonly rootTime: bigint;
  readonly now: bigint;
  readonly proofs: number;
}

/** Calendar days the period touches, counted in UTC (so the answer does not depend on where the bot runs). */
export const periodDays = (f: Pick<ProofFacts, "fromDate" | "toDate">): bigint => f.toDate / DAY - f.fromDate / DAY + 1n;
/** Never negative: a root time ahead of the bot's clock reads as age 0. */
export const proofAgeSeconds = (f: Pick<ProofFacts, "rootTime" | "now">): bigint => (f.now > f.rootTime ? f.now - f.rootTime : 0n);
export const secondsLeft = (f: Pick<ProofFacts, "expiry" | "now">): bigint => f.expiry - f.now;

const tusd8 = (base: bigint): string => {
  const whole = base / 1_000_000n;
  const frac = (base % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
};
const daysOf = (seconds: bigint): string => {
  const d = Number(seconds) / 86_400;
  return d >= 10 || Number.isInteger(d) ? `${Math.floor(d)}` : d.toFixed(1);
};

export interface Rule {
  readonly code: RuleCode;
  /** null when the rule holds; otherwise the specific reason, in plain words. */
  readonly check: (f: ProofFacts, p: Policy) => string | null;
}

export const RULES: readonly Rule[] = [
  {
    code: "BelowMinThreshold",
    check: (f, p) => (f.threshold >= p.minThreshold ? null : `The proof shows at least ${tusd8(f.threshold)} tUSD8; this policy needs at least ${tusd8(p.minThreshold)} tUSD8.`),
  },
  {
    code: "TooFewPayments",
    check: (f, p) => (f.count >= BigInt(p.minPayments) ? null : `The proof counts ${f.count} payment(s); this policy needs at least ${p.minPayments}.`),
  },
  {
    code: "PeriodTooShort",
    check: (f, p) => (periodDays(f) >= BigInt(p.minPeriodDays) ? null : `The proof covers ${periodDays(f)} day(s) of the ledger; this policy needs at least ${p.minPeriodDays}.`),
  },
  {
    code: "PeriodTooLong",
    check: (f, p) => (periodDays(f) <= BigInt(p.maxPeriodDays) ? null : `The proof spreads its total over ${periodDays(f)} days; this policy allows at most ${p.maxPeriodDays}.`),
  },
  {
    code: "ProofTooOld",
    check: (f, p) =>
      proofAgeSeconds(f) <= BigInt(p.maxProofAgeDays) * DAY ? null : `The proof's ledger state is ${daysOf(proofAgeSeconds(f))} days old; this policy allows at most ${p.maxProofAgeDays}.`,
  },
  {
    code: "ExpiresTooSoon",
    check: (f, p) =>
      secondsLeft(f) >= BigInt(p.minDaysLeft) * DAY ? null : `The link expires in ${daysOf(secondsLeft(f) > 0n ? secondsLeft(f) : 0n)} day(s); this policy needs at least ${p.minDaysLeft}.`,
  },
];

export interface Reason {
  readonly code: RuleCode;
  readonly message: string;
}

/** Every rule that fails, in RULES order. Empty means every rule holds. */
export function failingRules(f: ProofFacts, p: Policy, rules: readonly Rule[] = RULES): Reason[] {
  const out: Reason[] = [];
  for (const r of rules) {
    const why = r.check(f, p);
    if (why !== null) out.push({ code: r.code, message: why });
  }
  return out;
}
