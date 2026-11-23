import "server-only";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { chooseStore, upstashKv, type KvClient, type StoreChoice } from "@shaida/kv";
import { kvSnapshotStore, type SnapshotStore } from "@shaida/index";
import { emptyState, kvRelayStore, parseRelayState, stateStore, type RelayStore } from "@shaida/relay";
import { dataDir, readJson, writeJsonAtomic } from "./json-file";

/**
 * Where the relayer's records and the index cursor live: Redis (Upstash) in production, a JSON file under
 * web/.data for local dev. Chosen once from the environment (chooseStore; instrumentation.ts refuses to start without
 * it in production). Never holds user secrets: request records hold hashes, nonces and gas, never bodies.
 */
let choice: StoreChoice | undefined;
let kv: KvClient | undefined;
let relay: RelayStore | undefined;
const snapshots = new Map<number, SnapshotStore>();

/** The Redis copy of the index is written at most this often; a restart re-reads at most this much of the chain. */
const INDEX_PERSIST_EVERY_MS = 60_000;

export const storeChoice = (): StoreChoice => (choice ??= chooseStore(process.env));

function redis(c: Extract<StoreChoice, { kind: "redis" }>): KvClient {
  return (kv ??= upstashKv(c.env));
}

/** The shared Redis client in production; null when the store is the dev file (callers choose their own fallback). */
export function sharedKv(): KvClient | null {
  const c = storeChoice();
  return c.kind === "redis" ? redis(c) : null;
}

export function relayStore(): RelayStore {
  if (relay) return relay;
  const c = storeChoice();
  if (c.kind === "redis") {
    relay = kvRelayStore(redis(c), { newToken: randomUUID, log: (line) => console.warn(`[relay] ${JSON.stringify(line)}`) });
  } else {
    const path = join(dataDir(), "relay-state.json");
    relay = stateStore(
      async () => {
        const raw = await readJson(path);
        return raw === null ? emptyState() : parseRelayState(raw);
      },
      (s) => writeJsonAtomic(path, s),
    );
  }
  return relay;
}

export function indexStore(chainId: number): SnapshotStore {
  const known = snapshots.get(chainId);
  if (known) return known;
  const c = storeChoice();
  let store: SnapshotStore;
  if (c.kind === "redis") {
    store = kvSnapshotStore(redis(c), { key: `shaida:v1:index:${chainId}`, persistEveryMs: INDEX_PERSIST_EVERY_MS, nowMs: () => Date.now() });
  } else {
    const path = join(dataDir(), `index-${chainId}.json`);
    store = { load: () => readJson(path), save: (s) => writeJsonAtomic(path, s) };
  }
  snapshots.set(chainId, store);
  return store;
}
