// The key-value surface Shaida's server state uses, and nothing more. Production: Upstash Redis over REST
// (upstash.ts). Tests: an in-memory fake (memory.ts) that runs each script's `emulate` in place of its Lua.

/** What a script's emulation may touch: the fake's own tables. */
export interface FakeTables {
  readonly strings: Map<string, string>;
  readonly sets: Map<string, Set<string>>;
  readonly zsets: Map<string, Map<string, number>>;
}

/**
 * A named Lua script. `lua` is what Redis runs; `emulate` is the same logic for the in-memory fake. Both live side by
 * side so a change to one is seen next to the other; the Lua itself is run against a real Redis by the kv tests
 * when SHAIDA_KV_TEST_URL is set (evidence/kv-redis.md).
 */
export interface KvScript {
  readonly name: string;
  readonly lua: string;
  readonly emulate: (t: FakeTables, keys: readonly string[], args: readonly string[]) => number;
}

export const defineScript = (s: KvScript): KvScript => s;

export interface SetOptions {
  /** Only write when the key does not exist. */
  readonly nx?: boolean;
  /** Expire after this many milliseconds. */
  readonly pxMs?: number;
}

export interface KvClient {
  get(key: string): Promise<string | null>;
  /** Values in key order; null where a key is missing. */
  mget(keys: readonly string[]): Promise<(string | null)[]>;
  /** True when written (false only when `nx` was set and the key existed). */
  set(key: string, value: string, opts?: SetOptions): Promise<boolean>;
  smembers(key: string): Promise<string[]>;
  /** Runs the script atomically; its reply is an integer. */
  run(script: KvScript, keys: readonly string[], args: readonly string[]): Promise<number>;
}

/** Thrown when the store answered with something the client cannot use. Never swallowed. */
export class KvReplyError extends Error {
  constructor(what: string, got: unknown) {
    super(`kv: ${what} replied ${JSON.stringify(got)?.slice(0, 120) ?? String(got)}`);
    this.name = "KvReplyError";
  }
}
