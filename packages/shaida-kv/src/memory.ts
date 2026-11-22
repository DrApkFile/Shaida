// In-memory KvClient for tests. One instance stands for one Redis database: give the same instance to two stores to
// model two server processes (or one process before and after a restart) sharing it.
import type { FakeTables, KvClient, KvScript, SetOptions } from "./client";

export interface MemoryKv extends KvClient {
  readonly tables: FakeTables;
  /** Commands served so far (to compare with the Upstash command budget). */
  readonly commands: () => number;
  /** Makes every later command fail like a network error (a lost store). */
  failWith(error: Error | null): void;
}

export function memoryKv(opts: { readonly nowMs?: () => number } = {}): MemoryKv {
  const now = opts.nowMs ?? (() => Date.now());
  const tables: FakeTables = { strings: new Map(), sets: new Map(), zsets: new Map() };
  const expiry = new Map<string, number>();
  let count = 0;
  let failure: Error | null = null;

  const tick = () => {
    if (failure) throw failure;
    count++;
    const t = now();
    for (const [k, at] of expiry) {
      if (at <= t) {
        expiry.delete(k);
        tables.strings.delete(k);
      }
    }
  };

  return {
    tables,
    commands: () => count,
    failWith: (e) => void (failure = e),
    async get(key) {
      tick();
      return tables.strings.get(key) ?? null;
    },
    async mget(keys) {
      tick();
      return keys.map((k) => tables.strings.get(k) ?? null);
    },
    async set(key: string, value: string, o: SetOptions = {}) {
      tick();
      if (o.nx && tables.strings.has(key)) return false;
      tables.strings.set(key, value);
      if (o.pxMs !== undefined) expiry.set(key, now() + o.pxMs);
      else expiry.delete(key);
      return true;
    },
    async smembers(key) {
      tick();
      return [...(tables.sets.get(key) ?? [])];
    },
    async run(script: KvScript, keys, args) {
      tick();
      const out = script.emulate(tables, keys, args);
      for (const k of keys) if (!tables.strings.has(k)) expiry.delete(k);
      return out;
    },
  };
}
