// POST /api/underwrite (D30): rate limit before the body is read (as the relayer), a size cap, a strict body, then the
// decision and, if asked and approved, the record. Logs carry ids and codes, never the link.
import { z } from "zod";
import { shaidaError, type ErrorCode, type ShaidaError } from "@shaida/proofs";
import { underwrite, type Decision, type UnderwriteDeps } from "./decide";
import type { Policy } from "./policy";
import { recordDecision, type RecordOutcome, type RecorderDeps } from "./record";

/** A bundle of 8 proofs is about 5 KB of fragment; the whole body is capped well above that and far below abuse. */
export const MAX_BODY_BYTES = 16_384;
export const MAX_LINK_CHARS = 12_000;

export interface UnderwriteLimits {
  /** Requests per IP per minute, counted before the body is parsed (the relayer's sliding window). */
  readonly perIpPerMinute: number;
}
export const UNDERWRITE_LIMITS: UnderwriteLimits = { perIpPerMinute: 10 };

export const underwriteBodySchema = z
  .object({
    /** A full proof link (https://…/v#…), or only its fragment. */
    link: z.string().min(1).max(MAX_LINK_CHARS),
    /** A policy id from GET /api/underwrite (e.g. "rent-check"). */
    preset: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
    /** Also record an APPROVE on chain (IncomeVerifier.attest from the bot's key), if the bot has recording on. */
    record: z.boolean().default(false),
  })
  .strict();
export type UnderwriteBody = z.infer<typeof underwriteBodySchema>;

/** The fragment of a link: the part after the first "#", or the whole string when there is no "#". */
export function fragmentOf(link: string): string {
  const trimmed = link.trim();
  const at = trimmed.indexOf("#");
  return at < 0 ? trimmed : trimmed.slice(at + 1);
}

export interface HandleDeps {
  readonly policies: readonly Policy[];
  readonly limits: UnderwriteLimits;
  readonly hit: (bucket: string, max: number, nowMs: number) => Promise<boolean>;
  readonly nowMs: () => number;
  /** The engine's deps for one request (a fresh ledger view each time). */
  readonly engine: () => UnderwriteDeps;
  readonly recorder: RecorderDeps;
  readonly log: (line: Readonly<Record<string, string | number | boolean | null>>) => void;
}

export interface Incoming {
  readonly ip: string;
  /** The raw body text, read only after the IP rail. Throws RangeError past MAX_BODY_BYTES. */
  readonly readText: () => Promise<string>;
}

export type UnderwriteReply =
  | { readonly status: 200; readonly body: { readonly decision: Decision; readonly record: RecordOutcome | null } }
  | { readonly status: 400 | 413 | 429; readonly body: { readonly error: ShaidaError } };

const STATUS: Partial<Record<ErrorCode, 400 | 413 | 429>> = { RateLimited: 429 };
const refuse = (code: ErrorCode, message: string, status?: 400 | 413 | 429): UnderwriteReply => ({ status: status ?? STATUS[code] ?? 400, body: { error: shaidaError(code, message) } });

export async function handleUnderwrite(req: Incoming, deps: HandleDeps): Promise<UnderwriteReply> {
  if (await deps.hit(`underwrite-ip:${req.ip}`, deps.limits.perIpPerMinute, deps.nowMs())) {
    return refuse("RateLimited", "Too many decisions asked from this address. Wait a minute; nothing was decided or sent.");
  }
  let text: string;
  try {
    text = await req.readText();
  } catch (e) {
    if (e instanceof RangeError) return refuse("InputRejected", `The body is larger than ${MAX_BODY_BYTES} bytes. Nothing was decided.`, 413);
    throw e;
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return refuse("InputRejected", `The body is larger than ${MAX_BODY_BYTES} bytes. Nothing was decided.`, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return refuse("InputRejected", `The body is not JSON (${e instanceof Error ? e.name : "parse error"}). Nothing was decided.`);
  }
  const parsed = underwriteBodySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return refuse("InputRejected", `Malformed request (${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}). Nothing was decided.`);
  }
  const policy = deps.policies.find((p) => p.id === parsed.data.preset);
  if (!policy) return refuse("InputRejected", `No preset "${parsed.data.preset}". Presets: ${deps.policies.map((p) => p.id).join(", ")}. Nothing was decided.`);

  const fragment = fragmentOf(parsed.data.link);
  const decision = await underwrite(fragment, policy, deps.engine());
  const codes = decision.kind === "DECLINE" ? decision.reasons.map((r) => r.code).join(",") : decision.kind === "INCONCLUSIVE" ? decision.error.code : "";
  deps.log({ event: "underwrite-decision", decision: decision.decisionId.slice(0, 16), proof: decision.proofId.slice(0, 16), policy: `${policy.id}@${policy.version}`, kind: decision.kind, codes });
  const record = parsed.data.record ? await recordDecision(decision, fragment, deps.recorder) : null;
  if (record) deps.log({ event: "underwrite-record-reply", decision: decision.decisionId.slice(0, 16), ok: record.ok, code: record.ok ? null : record.error.code, records: record.records.length });
  return { status: 200, body: { decision, record } };
}
