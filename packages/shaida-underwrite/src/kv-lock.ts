// One recording at a time across every process that shares the store (D30): a lease key written with SET NX PX,
// released only by the holder (token-checked script). A crashed holder's lease runs out on its own.
import { defineScript, type KvClient } from "@shaida/kv";

const RELEASE = defineScript({
  name: "underwrite-lock-release",
  lua: `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`,
  emulate: (t, keys, args) => {
    if (t.strings.get(keys[0]!) !== args[0]) return 0;
    t.strings.delete(keys[0]!);
    return 1;
  },
});

export class LockBusy extends Error {
  constructor(key: string, waitedMs: number) {
    super(`${key} stayed held for ${waitedMs} ms`);
    this.name = "LockBusy";
  }
}

export interface LockOptions {
  readonly key: string;
  /** Longer than the task can run; the lease frees itself after this. */
  readonly leaseMs: number;
  /** How long to wait for another holder before giving up with LockBusy. */
  readonly waitMs: number;
  readonly newToken: () => string;
  readonly sleep: (ms: number) => Promise<void>;
}

export function kvLock(kv: KvClient, o: LockOptions) {
  return async <T>(task: () => Promise<T>): Promise<T> => {
    const token = o.newToken();
    for (let waited = 0; !(await kv.set(o.key, token, { nx: true, pxMs: o.leaseMs })); waited += 250) {
      if (waited >= o.waitMs) throw new LockBusy(o.key, waited);
      await o.sleep(250);
    }
    try {
      return await task();
    } finally {
      await kv.run(RELEASE, [o.key], [token]);
    }
  };
}
