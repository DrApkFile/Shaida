// The snapshot (and so the cursor) in Redis, for a server whose disk does not survive a restart (Render free).
// Every load and save goes through this process's copy; Redis is written at most once per `persistEveryMs`, so a
// page-by-page sync costs one write a minute, not one per page. A restart loses at most that much progress and
// resumes from the last persisted cursor (re-reading those blocks); it never starts over from the deploy block.
// The snapshot is public chain data: losing it is never a safety issue, and loadOrStart checks it on every load.
import type { KvClient } from "@shaida/kv";
import type { Snapshot } from "./snapshot";
import type { SnapshotStore } from "./sync";

export interface KvSnapshotOptions {
  readonly key: string;
  readonly persistEveryMs: number;
  readonly nowMs: () => number;
}

export function kvSnapshotStore(kv: KvClient, o: KvSnapshotOptions): SnapshotStore & { readonly persisted: () => string | null } {
  let local: string | null = null;
  let persistedText: string | null = null;
  let persistedAt = -Infinity;
  return {
    persisted: () => persistedText,
    load: async () => {
      if (local === null) {
        local = await kv.get(o.key);
        persistedText = local;
        persistedAt = local === null ? -Infinity : o.nowMs(); // nothing stored yet: the first save writes at once
      }
      return local === null ? null : (JSON.parse(local) as unknown);
    },
    save: async (s: Snapshot) => {
      local = JSON.stringify(s);
      if (o.nowMs() - persistedAt < o.persistEveryMs) return;
      await kv.set(o.key, local);
      persistedText = local;
      persistedAt = o.nowMs();
    },
  };
}
