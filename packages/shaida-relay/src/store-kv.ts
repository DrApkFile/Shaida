// The relayer's store in Redis (Upstash in production), shared by every server process. One key per record, so
// writes are per request and atomic: a new record is claimed with a compare-and-set on its key's pointer (claim), so
// two processes can never both persist an `accepted` record for one nullifier or commitment, and a restart finds
// every record it wrote before. Records are parsed with the strict schema on every read.
import { defineScript, type KvClient } from "@shaida/kv";
import { committedGas } from "./limits";
import { chainQueue } from "./lock";
import { recordSchema } from "./state-schema";
import { ChainBusy, type RelayStore, type RequestRecord } from "./types";

const WINDOW_MS = 60_000;

/** Writes the record and moves the key's pointer to it while the pointer still names the expected holder. */
export const CLAIM = defineScript({
  name: "relay-claim",
  lua: `local cur = redis.call('GET', KEYS[1])
if cur == ARGV[2] then return 1 end
if (cur or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[3])
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SADD', KEYS[3], ARGV[2])
return 1`,
  emulate: (t, [ptr = "", rec = "", day = ""], [expected = "", id = "", json = ""]) => {
    const cur = t.strings.get(ptr);
    if (cur === id) return 1;
    if ((cur ?? "") !== expected) return 0;
    t.strings.set(rec, json);
    t.strings.set(ptr, id);
    t.sets.set(day, (t.sets.get(day) ?? new Set()).add(id));
    return 1;
  },
});

/** Replaces a record that exists; 0 (nothing written) when it does not. */
export const PUT = defineScript({
  name: "relay-put",
  lua: `if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
return 1`,
  emulate: (t, [rec = ""], [json = ""]) => {
    if (!t.strings.has(rec)) return 0;
    t.strings.set(rec, json);
    return 1;
  },
});

/** Sliding one-minute window: drop hits older than the window, add this one, return the count. */
export const HIT = defineScript({
  name: "relay-hit",
  lua: `local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[3]))
redis.call('ZADD', KEYS[1], now, ARGV[2])
redis.call('PEXPIRE', KEYS[1], 2 * tonumber(ARGV[3]))
return redis.call('ZCARD', KEYS[1])`,
  emulate: (t, [key = ""], [now = "0", member = "", win = "0"]) => {
    const z = t.zsets.get(key) ?? new Map<string, number>();
    for (const [m, at] of z) if (at <= Number(now) - Number(win)) z.delete(m);
    z.set(member, Number(now));
    t.zsets.set(key, z);
    return z.size;
  },
});

/** Releases the lock only if this process still holds it (its token). */
export const UNLOCK = defineScript({
  name: "relay-unlock",
  lua: `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`,
  emulate: (t, [key = ""], [token = ""]) => (t.strings.get(key) === token ? Number(t.strings.delete(key)) : 0),
});

export interface KvRelayOptions {
  readonly prefix?: string;
  /** How long a held lock lives if its process dies (Redis expires it). */
  readonly lockLeaseMs?: number;
  /** How long to wait for another process's lock before refusing (ChainBusy). */
  readonly lockWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly newToken: () => string;
  /** A lock that could not be released is logged and left to expire at its lease; the task's result stands. */
  readonly log: (line: Readonly<Record<string, string | number>>) => void;
}

export function kvRelayStore(kv: KvClient, o: KvRelayOptions): RelayStore {
  const p = o.prefix ?? "shaida:v1:relay";
  const k = {
    rec: (id: string) => `${p}:rec:${id}`,
    ptr: (key: string) => `${p}:key:${key}`,
    day: (day: string) => `${p}:day:${day}`,
    rate: (bucket: string) => `${p}:rate:${bucket}`,
    lock: (chainId: number) => `${p}:lock:${chainId}`,
  };
  const lease = o.lockLeaseMs ?? 120_000;
  const wait = o.lockWaitMs ?? 45_000;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const parse = (text: string | null): RequestRecord | null => (text === null ? null : recordSchema.parse(JSON.parse(text)));
  const record = async (id: string) => parse(await kv.get(k.rec(id)));
  // This process's own queue first (no Redis polling between local requests), then the lock shared through Redis.
  const inProcess = chainQueue();

  return {
    hit: async (bucket, max, nowMs) => (await kv.run(HIT, [k.rate(bucket)], [String(nowMs), `${nowMs}:${o.newToken()}`, String(WINDOW_MS)])) > max,
    record,
    holder: async (key) => {
      const id = await kv.get(k.ptr(key));
      return id === null ? null : record(id);
    },
    claim: async (r, expected) => (await kv.run(CLAIM, [k.ptr(r.key), k.rec(r.requestId), k.day(r.budgetDay)], [expected ?? "", r.requestId, JSON.stringify(r)])) === 1,
    put: async (r) => {
      if ((await kv.run(PUT, [k.rec(r.requestId)], [JSON.stringify(r)])) !== 1) throw new Error(`relay store: no record ${r.requestId} to update`);
    },
    gasCommitted: async (day) => {
      const ids = await kv.smembers(k.day(day));
      let total = 0n;
      for (const text of await kv.mget(ids.map(k.rec))) {
        const r = parse(text);
        if (r) total += committedGas(r);
      }
      return total;
    },
    withChainLock: (chainId, task) =>
      inProcess(chainId, async () => {
        const token = o.newToken();
        const started = Date.now();
        while (!(await kv.set(k.lock(chainId), token, { nx: true, pxMs: lease }))) {
          if (Date.now() - started > wait) throw new ChainBusy(chainId);
          await sleep(250);
        }
        try {
          return await task();
        } finally {
          await kv.run(UNLOCK, [k.lock(chainId)], [token]).catch((e: unknown) =>
            o.log({ event: "relay-unlock-failed", chainId, leaseMs: lease, error: e instanceof Error ? e.message : String(e) }),
          );
        }
      }),
  };
}
