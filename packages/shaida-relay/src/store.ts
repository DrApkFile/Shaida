import type { RelayState, RelayStore } from "./types";

export const emptyState = (): RelayState => ({ records: {}, byKey: {}, rate: {} });

/** A store over load/save of the whole state, serialized inside this process. The file store uses it. */
export function serializedStore(load: () => Promise<RelayState>, save: (s: RelayState) => Promise<void>): RelayStore {
  let tail: Promise<unknown> = Promise.resolve();
  const run = <T>(task: () => Promise<T>): Promise<T> => {
    const p = tail.then(task, task);
    tail = p.then(() => undefined, () => undefined);
    return p;
  };
  return {
    read: () => run(load),
    update: (change) =>
      run(async () => {
        const s = await load();
        const out = change(s);
        await save(s);
        return out;
      }),
  };
}

/** For tests: keeps a JSON copy, so state goes through serialization like the file store's. */
export function memoryStore(): RelayStore & { readonly saves: () => number } {
  let text = JSON.stringify(emptyState());
  let saves = 0;
  const store = serializedStore(
    async () => JSON.parse(text) as RelayState,
    async (s) => {
      text = JSON.stringify(s);
      saves++;
    },
  );
  return { ...store, saves: () => saves };
}
