// The state-document store: the whole RelayState is loaded, changed and saved in one step, serialized inside this
// process. Used over a JSON file for local dev (web/src/server/relayer.ts) and over memory in tests. Not shared
// between processes: production uses the Redis store (store-kv.ts).
import { gasCommitted, hit } from "./limits";
import { withChainLock } from "./lock";
import type { RelayState, RelayStore, RequestRecord } from "./types";

export const emptyState = (): RelayState => ({ records: {}, byKey: {}, rate: {} });

export function stateStore(load: () => Promise<RelayState>, save: (s: RelayState) => Promise<void>): RelayStore {
  let tail: Promise<unknown> = Promise.resolve();
  const queued = <T>(task: () => Promise<T>): Promise<T> => {
    const p = tail.then(task, task);
    tail = p.then(() => undefined, () => undefined);
    return p;
  };
  const read = <T>(f: (s: RelayState) => T) => queued(async () => f(await load()));
  const update = <T>(f: (s: RelayState) => T) =>
    queued(async () => {
      const s = await load();
      const out = f(s);
      await save(s);
      return out;
    });
  return {
    hit: (bucket, max, nowMs) => update((s) => hit(s, bucket, max, nowMs)),
    record: (id) => read((s) => s.records[id] ?? null),
    holder: (key) => read((s) => {
      const id = s.byKey[key];
      return id ? s.records[id] ?? null : null;
    }),
    claim: (r: RequestRecord, expected) =>
      update((s) => {
        if ((s.byKey[r.key] ?? null) !== expected) return false;
        s.records[r.requestId] = r;
        s.byKey[r.key] = r.requestId;
        return true;
      }),
    put: (r) => update((s) => void (s.records[r.requestId] = r)),
    gasCommitted: (day) => read((s) => gasCommitted(s, day)),
    withChainLock,
  };
}

/** For tests: keeps a JSON copy, so state goes through serialization like the file store's. */
export function memoryStore(): RelayStore & { readonly saves: () => number } {
  let text = JSON.stringify(emptyState());
  let saves = 0;
  const store = stateStore(
    async () => JSON.parse(text) as RelayState,
    async (s) => {
      text = JSON.stringify(s);
      saves++;
    },
  );
  return { ...store, saves: () => saves };
}
