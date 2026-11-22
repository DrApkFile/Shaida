// What the reader is told for each outcome of verifyIncomeLink (PRD §5, D27): the named code and plain words, nothing
// else from the link. A code without an entry gets a general sentence; the code itself is always shown.
import type { ErrorCode } from "@shaida/proofs";

export const REFUSAL_WORDS: Partial<Record<ErrorCode, string>> = {
  ProofInvalid: "This link does not prove what it says. It may have been edited, or it is not a Shaida proof link.",
  WrongReader: "This link was made for someone else. Check the spelling of your name, or ask for a link made for you.",
  ProofExpired: "This link has expired. Ask for a new one.",
  MixedContexts: "The proofs in this link were made for different readers or expiry dates, so they cannot be added up.",
  RangesOverlap: "Two proofs in this link cover the same stretch of the ledger, so a payment could be counted twice.",
  MixedRoots: "The proofs in this link were built against different ledger states, so they cannot be added up.",
  UnknownRoot: "The ledger state this link was built on is not known on chain here (yet). Try again in a minute; if it stays, the link is for another network.",
  ContextMismatch: "The link's reader, expiry or salt do not match its proofs. It was altered.",
  AssetMismatch: "This link is not about tUSD8.",
  RangeUnresolvable: "The dates of the counted payments could not be read from the ledger yet. Try again in a minute.",
  NotConfigured: "This page is not set up for this network.",
  InputRejected: "Type your name as the sender wrote it.",
};

export const refusalWords = (code: ErrorCode): string => REFUSAL_WORDS[code] ?? "This link could not be verified.";

export const dateOf = (unix: bigint): string =>
  new Date(Number(unix) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
