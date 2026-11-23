// The decision engine (D30). Pure: the chain reads, the Groth16 check and the clock are injected. It runs the whole
// PRD §5 verification (verifyIncomeLink, as the bot's own reader) and only then the policy rules, in RULES order.
//   APPROVE       every rule holds for a VALID proof
//   DECLINE       the link is INVALID (one reason: its code), or VALID with one or more failing rules (all listed)
//   INCONCLUSIVE  the chain could not be read, or the ledger could not be dated yet: never an approval
// The same link and the same policy (id, version, hash) give the same decisionId while no time limit is crossed.
import { sha256, stringToBytes } from "viem";
import {
  decodeFragment, incomeLinkSchema, PUBLIC_SIGNAL_ORDER, shaidaError, verifyIncomeLink,
  type IncomeVerified, type ShaidaError, type VerifyDeps,
} from "@shaida/proofs";
import { isInconclusiveCode, isRefusalCode, REFUSAL_WORDS, type DeclineCode, type InconclusiveCode } from "./codes";
import { policyLabel, type Policy } from "./policy";
import { failingRules, periodDays, proofAgeSeconds, RULES, secondsLeft, type ProofFacts, type Rule } from "./rules";

export interface UnderwriteDeps extends Omit<VerifyDeps, "readerIdHash"> {
  /** Block time of the ledger leaf that formed `root`, or null when the bot's ledger copy does not reach it yet. */
  readonly rootTime: (root: bigint) => Promise<bigint | null>;
}

/**
 * Thrown by injected reads that could not answer: the RPC is down or timed out (ChainUnreachable), or the bot's ledger
 * copy failed its root check (UnknownRoot). The engine turns it into INCONCLUSIVE with that code; it never approves.
 */
export class LedgerNotReadable extends Error {
  constructor(readonly error: ShaidaError & { readonly code: InconclusiveCode }) {
    super(error.message);
    this.name = "LedgerNotReadable";
  }
}

export const chainUnreachable = (what: string, cause: unknown): LedgerNotReadable =>
  new LedgerNotReadable(
    shaidaError("ChainUnreachable", `The bot could not read the chain (${what}: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}). Nothing was decided or sent.`) as ShaidaError & { code: "ChainUnreachable" },
  );

export interface PolicyRef {
  readonly id: string;
  readonly version: number;
  readonly hash: string;
  readonly title: string;
}

/** JSON-ready facts of a VALID proof: tUSD8 base units and unix seconds as decimal strings. */
export interface FactsOut {
  readonly threshold: string;
  readonly count: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly expiry: string;
  readonly rootTime: string;
  readonly periodDays: string;
  readonly proofAgeSeconds: string;
  readonly secondsLeft: string;
  readonly proofs: number;
}

interface Common {
  readonly decisionId: string;
  /** sha256 of the link payload (canonical JSON after the strict schema, or of the raw fragment if it fails it). */
  readonly proofId: string;
  readonly policy: PolicyRef;
  /** ISO time the rules were evaluated at (the injected clock). */
  readonly evaluatedAt: string;
}

export interface DeclineReason {
  readonly code: DeclineCode;
  readonly message: string;
}

export type Decision =
  | (Common & { readonly kind: "APPROVE"; readonly facts: FactsOut })
  | (Common & { readonly kind: "DECLINE"; readonly reasons: readonly DeclineReason[]; readonly facts: FactsOut | null })
  | (Common & { readonly kind: "INCONCLUSIVE"; readonly error: ShaidaError });

const hex = (s: string): string => sha256(stringToBytes(s)).slice(2);

/** The id of a link's payload: what dedupe, decisions and logs refer to instead of the payload itself. */
export function proofIdOf(fragment: string): string {
  const body = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const decoded = decodeFragment(body);
  const parsed = decoded.ok ? incomeLinkSchema.safeParse(decoded.json) : null;
  return parsed?.success ? hex(JSON.stringify(parsed.data)) : hex(`raw:${body}`);
}

const refOf = (p: Policy): PolicyRef => ({ id: p.id, version: p.version, hash: p.hash, title: p.title });

function decisionIdOf(proofId: string, p: Policy, kind: Decision["kind"], codes: readonly string[]): string {
  return hex(`shaida-underwrite/1|${proofId}|${policyLabel(p)}|${p.hash}|${kind}|${codes.join(",")}`);
}

const factsOut = (f: ProofFacts): FactsOut => ({
  threshold: f.threshold.toString(),
  count: f.count.toString(),
  fromDate: f.fromDate.toString(),
  toDate: f.toDate.toString(),
  expiry: f.expiry.toString(),
  rootTime: f.rootTime.toString(),
  periodDays: periodDays(f).toString(),
  proofAgeSeconds: proofAgeSeconds(f).toString(),
  secondsLeft: secondsLeft(f).toString(),
  proofs: f.proofs,
});

const rootOf = (fragment: string): bigint => {
  const d = decodeFragment(fragment);
  if (!d.ok) throw new Error("a VALID link no longer decodes");
  return BigInt(incomeLinkSchema.parse(d.json).proofs[0]!.publicSignals[PUBLIC_SIGNAL_ORDER.indexOf("ledgerRoot")]!);
};

/** Runs PRD §5 for this policy's reader, then the rules. `rules` is for the mutation test only (test U17). */
export async function underwrite(fragment: string, policy: Policy, deps: UnderwriteDeps, rules: readonly Rule[] = RULES): Promise<Decision> {
  const now = deps.now();
  const proofId = proofIdOf(fragment);
  const common = (kind: Decision["kind"], codes: readonly string[]): Common => ({
    decisionId: decisionIdOf(proofId, policy, kind, codes),
    proofId,
    policy: refOf(policy),
    evaluatedAt: new Date(Number(now) * 1000).toISOString(),
  });
  const inconclusive = (error: ShaidaError): Decision => ({ ...common("INCONCLUSIVE", [error.code]), kind: "INCONCLUSIVE", error });

  let verified: IncomeVerified;
  let rootTime: bigint | null;
  try {
    const v = await verifyIncomeLink(fragment, { ...deps, now: () => now, readerIdHash: policy.readerIdHash });
    if (v.status === "INCONCLUSIVE") {
      if (!isInconclusiveCode(v.error.code)) throw new Error(`verifyIncomeLink returned INCONCLUSIVE(${v.error.code}), which the bot does not map`);
      return inconclusive(v.error);
    }
    if (v.status === "INVALID") {
      const code = v.error.code;
      if (!isRefusalCode(code)) throw new Error(`verifyIncomeLink returned INVALID(${code}), which the bot does not map`);
      return { ...common("DECLINE", [code]), kind: "DECLINE", reasons: [{ code, message: `${REFUSAL_WORDS[code]} (${v.error.message})` }], facts: null };
    }
    verified = v;
    rootTime = await deps.rootTime(rootOf(fragment));
  } catch (e) {
    if (!(e instanceof LedgerNotReadable)) throw e;
    return inconclusive(e.error);
  }
  if (rootTime === null) {
    return inconclusive(shaidaError("RangeUnresolvable", "The bot's copy of the ledger does not reach this proof's ledger state yet, so its age is unknown. Nothing was decided."));
  }

  const facts: ProofFacts = {
    threshold: verified.threshold, count: verified.count, fromDate: verified.fromDate, toDate: verified.toDate,
    expiry: verified.expiry, rootTime, now, proofs: verified.proofs,
  };
  const failing = failingRules(facts, policy, rules);
  if (failing.length === 0) return { ...common("APPROVE", []), kind: "APPROVE", facts: factsOut(facts) };
  return { ...common("DECLINE", failing.map((r) => r.code)), kind: "DECLINE", reasons: failing, facts: factsOut(facts) };
}
