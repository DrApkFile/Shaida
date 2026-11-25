// The bot's closed decision codes (D30). A DECLINE names every reason that applies, each a code from this file with a
// plain-language message; an INCONCLUSIVE names one retryable ShaidaError code (PRD §4) and never approves.
import type { ErrorCode } from "@shaida/proofs";

/** Policy rules, in the fixed order the engine evaluates them (rules.ts). */
export const RULE_CODES = [
  "BelowMinThreshold",
  "TooFewPayments",
  "PeriodTooShort",
  "PeriodTooLong",
  "ProofTooOld",
  "ExpiresTooSoon",
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

/** What each rule protects, in words a borrower or tenant reads. */
export const RULE_WORDS: Record<RuleCode, string> = {
  BelowMinThreshold: "The proof shows less income than this policy needs.",
  TooFewPayments: "The proof counts fewer payments than this policy needs.",
  PeriodTooShort: "The proof covers fewer days of the ledger than this policy needs.",
  PeriodTooLong: "The proof spreads its total over more days than this policy allows, so the income per period could be lower.",
  ProofTooOld: "The ledger state the proof was built on is older than this policy allows.",
  ExpiresTooSoon: "The link expires sooner than this policy needs.",
};

/** Verification refusals that are a final answer about the link (INVALID in PRD §5), so the bot declines. */
export const REFUSAL_CODES = [
  "ProofInvalid",
  "AssetMismatch",
  "MixedContexts",
  "MixedRoots",
  "RangesOverlap",
  "ContextMismatch",
  "WrongReader",
  "ProofExpired",
] as const satisfies readonly ErrorCode[];
export type RefusalCode = (typeof REFUSAL_CODES)[number];

export const REFUSAL_WORDS: Record<RefusalCode, string> = {
  ProofInvalid: "The link does not prove what it says: it is malformed, edited, or not a Shaida proof.",
  AssetMismatch: "The proof is not about tUSD8.",
  MixedContexts: "The link joins proofs made for different readers or expiry dates.",
  MixedRoots: "The link joins proofs built against different ledger states.",
  RangesOverlap: "Two proofs in the link cover the same ledger leaves, so a payment could count twice.",
  ContextMismatch: "The link's reader, expiry or salt do not match its proofs: it was altered.",
  WrongReader: "The link was made for another reader than this policy's.",
  ProofExpired: "The link has expired.",
};

export type DeclineCode = RuleCode | RefusalCode;
export const DECLINE_CODES: readonly DeclineCode[] = [...REFUSAL_CODES, ...RULE_CODES];

/** Codes an INCONCLUSIVE can carry: the chain or the ledger could not be read or dated yet. Never an approval. */
export const INCONCLUSIVE_CODES = ["ChainUnreachable", "UnknownRoot", "RangeUnresolvable"] as const satisfies readonly ErrorCode[];
export type InconclusiveCode = (typeof INCONCLUSIVE_CODES)[number];

export const isRefusalCode = (c: ErrorCode): c is RefusalCode => (REFUSAL_CODES as readonly string[]).includes(c);
export const isInconclusiveCode = (c: ErrorCode): c is InconclusiveCode => (INCONCLUSIVE_CODES as readonly string[]).includes(c);
