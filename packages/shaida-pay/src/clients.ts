// Typed clients for /api/index and /api/relay. Every reply is parsed as unknown with a strict schema; a network
// failure is a named code. A POST that got no answer is TxOutcomeUnknown: the caller checks, never re-posts.
import { z } from "zod";
import { checkSnapshot, type CheckedTrees, type RootReader } from "@shaida/index";
import { ERROR_CODES, shaidaError, type ErrorCode, type Result, type ShaidaError } from "@shaida/proofs";
import type { RelayFn, RequestRecord } from "@shaida/relay";

const codes = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];
const errorSchema = z.object({ code: z.enum(codes), message: z.string(), retryable: z.enum(["yes", "no", "later", "check"]), nextAction: z.string() }).strict();
const errorReply = z.object({ error: errorSchema }).strict();

const ROUTE: Record<RelayFn, string> = { deposit: "deposit", vouchedPay: "vouched-pay", lateVouch: "late-vouch", sweep: "sweep", memo: "memo", unshield: "unshield", revoke: "revoke" };

const recordSchema = z
  .object({
    requestId: z.string(), chainId: z.number(), fn: z.enum(["deposit", "vouchedPay", "lateVouch", "sweep", "memo", "unshield", "revoke"]), key: z.string(), requestHash: z.string().regex(/^0x[0-9a-f]{64}$/), payer: z.string().nullable(),
    state: z.enum(["accepted", "pending", "mined", "dropped", "unknown"]), nonce: z.number(), hash: z.string().regex(/^0x[0-9a-f]{64}$/),
    gas: z.string(), gasPrice: z.string(), gasUsed: z.string().nullable(), block: z.string().nullable(), reverted: z.boolean().nullable(),
    error: errorSchema.nullable(), budgetDay: z.string(), history: z.array(z.object({ state: z.string(), at: z.string() }).strict()),
  })
  .strict();
const recordReply = z.object({ record: recordSchema, repeated: z.boolean() }).strict();

export type RelayRecord = z.output<typeof recordSchema>;
export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function readReply(res: { status: number; json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await res.json();
  } catch (e) {
    return { unreadable: `HTTP ${res.status}: ${describe(e)}` };
  }
}

function asError(raw: unknown, fallback: ShaidaError): ShaidaError {
  const e = errorReply.safeParse(raw);
  return e.success ? e.data.error : fallback;
}

export interface RelayClient {
  post(fn: RelayFn, body: Record<string, unknown>): Promise<Result<RelayRecord>>;
  status(requestId: string): Promise<Result<RelayRecord>>;
  /** Polls status until the record is mined, dropped or unknown (or `timeoutMs` passes: then the last record). */
  settle(requestId: string, opts: { sleep: (ms: number) => Promise<void>; intervalMs?: number; timeoutMs?: number }): Promise<Result<RelayRecord>>;
}

export function relayClient(base: string, fetchFn: Fetch): RelayClient {
  const status = async (requestId: string): Promise<Result<RelayRecord>> => {
    let res;
    try {
      res = await fetchFn(`${base}/api/relay/status?id=${encodeURIComponent(requestId)}`);
    } catch (e) {
      return { ok: false, error: shaidaError("RelayerUnavailable", `Could not reach the relayer to check (${describe(e)}). Nothing changed.`) };
    }
    const raw = await readReply(res);
    const r = recordReply.safeParse(raw);
    return r.success ? { ok: true, value: r.data.record } : { ok: false, error: asError(raw, shaidaError("RelayerUnavailable", "The relayer's status reply failed the schema.")) };
  };
  return {
    async post(fn, body) {
      let res;
      try {
        res = await fetchFn(`${base}/api/relay/${ROUTE[fn]}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      } catch (e) {
        return { ok: false, error: shaidaError("TxOutcomeUnknown", `No answer from the relayer (${describe(e)}). It may have sent the transaction: check, do not send again.`) };
      }
      const raw = await readReply(res);
      const r = recordReply.safeParse(raw);
      if (r.success) return { ok: true, value: r.data.record };
      return { ok: false, error: asError(raw, shaidaError("TxOutcomeUnknown", `The relayer's reply (HTTP ${res.status}) failed the schema. It may have sent the transaction: check, do not send again.`)) };
    },
    status,
    async settle(requestId, opts) {
      const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
      let last = await status(requestId);
      while (last.ok && (last.value.state === "accepted" || last.value.state === "pending") && Date.now() < deadline) {
        await opts.sleep(opts.intervalMs ?? 1_500);
        last = await status(requestId);
      }
      return last;
    },
  };
}

const indexReply = z.object({ snapshot: z.unknown(), head: z.string(), behind: z.string(), complete: z.boolean(), pageError: z.string().nullable() }).strict();

/** Fetches the index until it is caught up (it reads ≤ 10,000 blocks per request), then checks it on chain. */
export async function fetchCheckedTrees(
  base: string, chainId: number, fetchFn: Fetch, reader: RootReader, opts: { sleep: (ms: number) => Promise<void>; maxPolls?: number; onProgress?: (behind: bigint) => void },
): Promise<Result<CheckedTrees>> {
  for (let poll = 0; poll < (opts.maxPolls ?? 50); poll++) {
    let res;
    try {
      res = await fetchFn(`${base}/api/index?chainId=${chainId}`);
    } catch (e) {
      return { ok: false, error: shaidaError("UnknownRoot", `Could not reach the index (${describe(e)}). Nothing was built.`) };
    }
    const raw = await readReply(res);
    const r = indexReply.safeParse(raw);
    if (!r.success) return { ok: false, error: asError(raw, shaidaError("UnknownRoot", "The index reply failed the schema. Nothing was built.")) };
    if (r.data.pageError) return { ok: false, error: shaidaError("UnknownRoot", `The index could not read part of the chain (${r.data.pageError}). Nothing was built; try again.`) };
    const behind = BigInt(r.data.behind);
    opts.onProgress?.(behind);
    if (behind === 0n || r.data.complete) return checkSnapshot(r.data.snapshot, chainId, reader);
    await opts.sleep(500);
  }
  return { ok: false, error: shaidaError("UnknownRoot", "The index is still catching up with the chain. Nothing was built; try again shortly.") };
}

export type { RequestRecord };
