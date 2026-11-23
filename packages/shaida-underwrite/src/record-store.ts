// Where the bot keeps its on-chain records (D30): one record per proof (never attested twice), and per UTC day the
// number of records and the gas reserved for them (the caps). Over the same KvClient as the relayer's state: Upstash
// Redis in production, the in-memory fake in tests, a JSON file in dev. Records are parsed strictly on every read.
import { z } from "zod";
import { defineScript, type KvClient } from "@shaida/kv";

export const recordStateSchema = z.enum(["claimed", "pending", "mined", "reverted", "dropped", "unknown"]);
export type RecordState = z.infer<typeof recordStateSchema>;

const hex = z.string().regex(/^0x[0-9a-f]+$/);
export const attestRecordSchema = z
  .object({
    /** First, so the claim script can recognise its own write when the HTTP client retries it. */
    claimId: z.string().min(8).max(80),
    proofKey: z.string().regex(/^[0-9a-f]{64}$/),
    decisionId: z.string().regex(/^[0-9a-f]{64}$/),
    policy: z.string().max(80),
    chainId: z.number().int().positive(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    state: recordStateSchema,
    hash: hex.length(66).nullable(),
    nonce: z.number().int().nonnegative().nullable(),
    gasLimit: z.string().regex(/^[0-9]+$/),
    gasUsed: z.string().regex(/^[0-9]+$/).nullable(),
    block: z.string().regex(/^[0-9]+$/).nullable(),
    error: z.string().max(400).nullable(),
    at: z.string(),
  })
  .strict();
export type AttestRecord = z.infer<typeof attestRecordSchema>;

/**
 * Claims every proof key of one request at once, or none: refuses (-1) if any is already recorded, (-2) if the day's
 * record count would pass its cap, (-3) if the day's reserved gas would. On success writes the records, adds to both
 * counters and returns how many it claimed. A retry of the same claim (same claimId on the first key) returns that.
 */
export const CLAIM = defineScript({
  name: "underwrite-claim",
  lua: `local n = #KEYS - 2
local first = redis.call('GET', KEYS[3])
if first and string.sub(first, 1, string.len(ARGV[4])) == ARGV[4] then return n end
for i = 3, #KEYS do if redis.call('EXISTS', KEYS[i]) == 1 then return -1 end end
local c = tonumber(redis.call('GET', KEYS[1]) or '0')
local g = tonumber(redis.call('GET', KEYS[2]) or '0')
if c + n > tonumber(ARGV[1]) then return -2 end
if g + n * tonumber(ARGV[3]) > tonumber(ARGV[2]) then return -3 end
for i = 3, #KEYS do redis.call('SET', KEYS[i], ARGV[i + 2]) end
redis.call('SET', KEYS[1], tostring(c + n))
redis.call('SET', KEYS[2], tostring(g + n * tonumber(ARGV[3])))
return n`,
  emulate: (t, keys, args) => {
    const [countKey = "", gasKey = "", ...recKeys] = keys;
    const [maxCount = "0", maxGas = "0", gasEach = "0", prefix = "", ...jsons] = args;
    const n = recKeys.length;
    if (t.strings.get(recKeys[0] ?? "")?.startsWith(prefix)) return n;
    if (recKeys.some((k) => t.strings.has(k))) return -1;
    const c = Number(t.strings.get(countKey) ?? "0");
    const g = Number(t.strings.get(gasKey) ?? "0");
    if (c + n > Number(maxCount)) return -2;
    if (g + n * Number(gasEach) > Number(maxGas)) return -3;
    recKeys.forEach((k, i) => t.strings.set(k, jsons[i] ?? ""));
    t.strings.set(countKey, String(c + n));
    t.strings.set(gasKey, String(g + n * Number(gasEach)));
    return n;
  },
});

/** Replaces a record that exists (a state change); 0 when it does not. Never creates one. */
export const PUT = defineScript({
  name: "underwrite-put",
  lua: `if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
return 1`,
  emulate: (t, [key = ""], [json = ""]) => {
    if (!t.strings.has(key)) return 0;
    t.strings.set(key, json);
    return 1;
  },
});

export type ClaimResult = { readonly ok: true } | { readonly ok: false; readonly why: "taken" | "count-cap" | "gas-cap" };

export interface RecordStore {
  get(proofKey: string): Promise<AttestRecord | null>;
  claim(day: string, records: readonly AttestRecord[], caps: { readonly count: number; readonly gas: bigint; readonly gasEach: bigint }): Promise<ClaimResult>;
  put(record: AttestRecord): Promise<void>;
  /** Records and gas reserved on a UTC day. */
  usage(day: string): Promise<{ readonly count: number; readonly gas: bigint }>;
}

export function kvRecordStore(kv: KvClient, prefix = "shaida:v1:underwrite"): RecordStore {
  const k = {
    rec: (proofKey: string) => `${prefix}:rec:${proofKey}`,
    count: (day: string) => `${prefix}:day:${day}:count`,
    gas: (day: string) => `${prefix}:day:${day}:gas`,
  };
  const parse = (text: string | null) => (text === null ? null : attestRecordSchema.parse(JSON.parse(text)));
  const json = (r: AttestRecord) => JSON.stringify(attestRecordSchema.parse(r));
  return {
    get: async (proofKey) => parse(await kv.get(k.rec(proofKey))),
    claim: async (day, records, caps) => {
      const first = records[0];
      if (!first) throw new RangeError("claim: no records");
      const reply = await kv.run(
        CLAIM,
        [k.count(day), k.gas(day), ...records.map((r) => k.rec(r.proofKey))],
        [String(caps.count), caps.gas.toString(), caps.gasEach.toString(), `{"claimId":${JSON.stringify(first.claimId)},`, ...records.map(json)],
      );
      if (reply === records.length) return { ok: true };
      if (reply === -1) return { ok: false, why: "taken" };
      if (reply === -2) return { ok: false, why: "count-cap" };
      if (reply === -3) return { ok: false, why: "gas-cap" };
      throw new Error(`underwrite claim replied ${reply}`);
    },
    put: async (r) => {
      if ((await kv.run(PUT, [k.rec(r.proofKey)], [json(r)])) !== 1) throw new Error(`underwrite store: no record for proof ${r.proofKey.slice(0, 12)}… to update`);
    },
    usage: async (day) => {
      const [count, gas] = await kv.mget([k.count(day), k.gas(day)]);
      return { count: Number(count ?? "0"), gas: BigInt(gas ?? "0") };
    },
  };
}
