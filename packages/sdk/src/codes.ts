// Every code a caller can get, with its outcome and plain meaning: the README's table is checked against this
// (test S14). Texts come from the code's own sources: ERROR_CODES (PRD §4) and the bot's REFUSAL_WORDS / RULE_WORDS.
import { ERROR_CODES } from "@shaida/proofs";
import { REFUSAL_WORDS, RULE_WORDS } from "../../shaida-underwrite/src/codes";
import type { CodeInfo, InconclusiveCode, RuleCode } from "./types";

const INCONCLUSIVE_WORDS: Record<InconclusiveCode, string> = {
  UnknownRoot: "The proof's ledger root is not known on this chain at the pinned block (a stale RPC, the wrong network, or a forged root).",
  RangeUnresolvable: "The proof's leaf range could not be dated from the chain yet.",
  ChainUnreachable: "The RPC could not be read: it is down, timed out, or refused the call.",
  NotConfigured: "The SDK refused its own setup: the bundled key or network failed its pinned hash, the network is unknown or invalid, or the RPC serves another chain.",
  InputRejected: "The reader name is empty or longer than 96 bytes.",
};

const info = (outcome: CodeInfo["outcome"], meaning: string, code: keyof typeof ERROR_CODES | RuleCode): CodeInfo => ({
  outcome,
  meaning,
  nextAction: code in ERROR_CODES ? ERROR_CODES[code as keyof typeof ERROR_CODES].nextAction : "ask for a link that meets the policy, or decline",
});

export const CODES: Readonly<Record<string, CodeInfo>> = Object.freeze({
  ...Object.fromEntries(Object.entries(REFUSAL_WORDS).map(([c, m]) => [c, info("INVALID", m, c as keyof typeof ERROR_CODES)])),
  ...Object.fromEntries(Object.entries(INCONCLUSIVE_WORDS).map(([c, m]) => [c, info("INCONCLUSIVE", m, c as InconclusiveCode)])),
  ...Object.fromEntries(Object.entries(RULE_WORDS).map(([c, m]) => [c, info("DECLINE", m, c as RuleCode)])),
});
