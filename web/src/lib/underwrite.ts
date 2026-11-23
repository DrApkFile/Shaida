// The bot page's view of /api/underwrite (D30): every reply is parsed strictly before it is shown.
import { z } from "zod";
import { DECLINE_CODES, INCONCLUSIVE_CODES } from "@shaida/underwrite";
import { ERROR_CODES, type ErrorCode } from "@shaida/proofs";

const dec = z.string().regex(/^-?(0|[1-9][0-9]*)$/);
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const errorCode = z.string().refine((c): c is ErrorCode => c in ERROR_CODES, "unknown error code");
const shaidaErr = z.object({ code: errorCode, message: z.string(), retryable: z.string(), nextAction: z.string() }).strict();

export const presetView = z.object({
  id: z.string(), version: z.number().int(), hash: z.string(), title: z.string(), audience: z.enum(["landlord", "lender", "donor"]),
  readerName: z.string(), minThreshold: dec, minPayments: z.number().int(), minPeriodDays: z.number().int(), maxPeriodDays: z.number().int(),
  maxProofAgeDays: z.number().int(), minDaysLeft: z.number().int(),
}).strict();
export type PresetView = z.infer<typeof presetView>;

export const botInfo = z.object({
  chainId: z.number().int(),
  presets: z.array(presetView).min(1),
  limits: z.object({ perIpPerMinute: z.number().int() }).strict(),
  recording: z.object({ enabled: z.boolean(), dailyCount: z.number().int(), dailyGas: dec, botAddress: hex.length(42).nullable() }).strict(),
}).strict();
export type BotInfo = z.infer<typeof botInfo>;

const facts = z.object({
  threshold: dec, count: dec, fromDate: dec, toDate: dec, expiry: dec, rootTime: dec, periodDays: dec, proofAgeSeconds: dec, secondsLeft: dec,
  proofs: z.number().int(),
}).strict();
export type DecisionFacts = z.infer<typeof facts>;
const policy = z.object({ id: z.string(), version: z.number().int(), hash: z.string(), title: z.string() }).strict();
const base = { decisionId: z.string(), proofId: z.string(), policy, evaluatedAt: z.string() };
const declineCode = z.string().refine((c) => (DECLINE_CODES as readonly string[]).includes(c), "unknown decline code");

export const decisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("APPROVE"), facts, ...base }).strict(),
  z.object({ kind: z.literal("DECLINE"), reasons: z.array(z.object({ code: declineCode, message: z.string() }).strict()).min(1), facts: facts.nullable(), ...base }).strict(),
  z.object({ kind: z.literal("INCONCLUSIVE"), error: shaidaErr.refine((e) => (INCONCLUSIVE_CODES as readonly string[]).includes(e.code)), ...base }).strict(),
]);
export type DecisionView = z.infer<typeof decisionSchema>;

const record = z.object({
  claimId: z.string(), proofKey: z.string(), decisionId: z.string(), policy: z.string(), chainId: z.number().int(), day: z.string(),
  state: z.enum(["claimed", "pending", "mined", "reverted", "dropped", "unknown"]),
  hash: hex.nullable(), nonce: z.number().int().nullable(), gasLimit: dec, gasUsed: dec.nullable(), block: dec.nullable(), error: z.string().nullable(), at: z.string(),
}).strict();
export type RecordView = z.infer<typeof record>;
const recordOutcome = z.union([
  z.object({ ok: z.literal(true), repeated: z.boolean(), records: z.array(record) }).strict(),
  z.object({ ok: z.literal(false), error: shaidaErr, records: z.array(record) }).strict(),
]);
export type RecordOutcomeView = z.infer<typeof recordOutcome>;

export const underwriteReply = z.union([
  z.object({ decision: decisionSchema, record: recordOutcome.nullable() }).strict(),
  z.object({ error: shaidaErr }).strict(),
]);
export type UnderwriteReplyView = z.infer<typeof underwriteReply>;

/** Fetches and parses; a reply that fails its schema is shown as InputRejected from the page, never as a decision. */
export async function askBot(body: { link: string; preset: string; record: boolean }): Promise<UnderwriteReplyView> {
  const res = await fetch("/api/underwrite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const parsed = underwriteReply.safeParse(await res.json());
  if (!parsed.success) throw new Error(`the bot's reply (HTTP ${res.status}) failed its schema: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}
