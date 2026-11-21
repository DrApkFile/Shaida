// The relayer's persisted state, checked whenever it is read back from disk.
import { z } from "zod";
import { ERROR_CODES, type ErrorCode } from "@shaida/proofs";
import { RELAY_FNS, type RelayState } from "./types";

const codes = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];
const errorSchema = z.object({ code: z.enum(codes), message: z.string(), retryable: z.enum(["yes", "no", "later", "check"]), nextAction: z.string() }).strict();
const state = z.enum(["accepted", "pending", "mined", "dropped", "unknown"]);
const hex = (n: number) => z.string().regex(new RegExp(`^0x[0-9a-f]{${n}}$`)).transform((s) => s as `0x${string}`);
const dec = z.string().regex(/^(0|[1-9][0-9]*)$/);

const recordSchema = z
  .object({
    requestId: z.string(), chainId: z.number().int(), fn: z.enum(RELAY_FNS), key: z.string(), payer: hex(40).nullable(), state,
    nonce: z.number().int().nonnegative(), hash: hex(64), gas: dec, gasPrice: dec, gasUsed: dec.nullable(), block: dec.nullable(),
    reverted: z.boolean().nullable(), error: errorSchema.nullable(), budgetDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    history: z.array(z.object({ state, at: z.string() }).strict()),
  })
  .strict();

export const relayStateSchema = z
  .object({ records: z.record(recordSchema), byKey: z.record(z.string()), rate: z.record(z.array(z.number())) })
  .strict();

export const parseRelayState = (raw: unknown): RelayState => relayStateSchema.parse(raw);
