// One sync step: read from the persisted cursor to a pinned head in ≤1,000-block pages, save after every page,
// then check the leaf counts against the contracts' nextIndex read AT the cursor block. Never rescans from the
// deploy block unless the stored snapshot is for another deployment or recorded a gap.
import { applyLogs, type RawLog } from "./apply";
import { PageFailed, readPages, type Page, type RetryPolicy } from "./logs";
import { emptySnapshot, isComplete, sameTarget, snapshotSchema, type IndexTarget, type Snapshot } from "./snapshot";

/** Chain reads the sync needs. Every read names its block. */
export interface IndexChain {
  chainId(): Promise<number>;
  blockNumber(): Promise<bigint>;
  /** eth_getLogs for these addresses over one page (toBlock − fromBlock ≤ 999). */
  getLogs(addresses: readonly string[], page: Page): Promise<readonly RawLog[]>;
  /** nextIndex() of the pool or the ledger, read at `block`. */
  nextIndex(contract: string, block: bigint): Promise<bigint>;
}

/** Where the snapshot (and so the cursor) lives between requests. */
export interface SnapshotStore {
  load(): Promise<unknown>;
  save(s: Snapshot): Promise<void>;
}

export interface SyncArgs {
  readonly target: IndexTarget;
  readonly chain: IndexChain;
  readonly store: SnapshotStore;
  readonly sleep: (ms: number) => Promise<void>;
  readonly retry?: RetryPolicy;
  /** At most this many blocks per call, so one request stays short; the next call resumes. Default: no cap. */
  readonly maxBlocks?: bigint;
  /** Stay this many blocks behind the head. Default 0. */
  readonly confirmations?: bigint;
}

export type SyncOutcome =
  | { readonly kind: "synced"; readonly snapshot: Snapshot; readonly head: bigint; readonly complete: boolean }
  | { readonly kind: "page-failed"; readonly snapshot: Snapshot; readonly head: bigint; readonly error: PageFailed };

/** Loads the stored snapshot, or starts over when it is unreadable, for another deployment, or has a gap. */
export async function loadOrStart(store: SnapshotStore, target: IndexTarget): Promise<{ snapshot: Snapshot; restarted: string | null }> {
  const raw = await store.load();
  if (raw === null || raw === undefined) return { snapshot: emptySnapshot(target), restarted: null };
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) return { snapshot: emptySnapshot(target), restarted: "stored snapshot failed the schema" };
  if (!sameTarget(parsed.data, target)) return { snapshot: emptySnapshot(target), restarted: "stored snapshot is for another deployment" };
  if (parsed.data.problems.length > 0) return { snapshot: emptySnapshot(target), restarted: `stored snapshot had a gap: ${parsed.data.problems[0]}` };
  return { snapshot: parsed.data, restarted: null };
}

export async function syncIndex(args: SyncArgs): Promise<SyncOutcome> {
  const { target, chain, store } = args;
  const actualChain = await chain.chainId();
  if (actualChain !== target.chainId) throw new Error(`RPC is chain ${actualChain}, the index is for chain ${target.chainId}`);

  let { snapshot } = await loadOrStart(store, target);
  const head = await chain.blockNumber();
  const tip = head - (args.confirmations ?? 0n);
  const from = BigInt(snapshot.syncedTo) + 1n;
  const capped = args.maxBlocks === undefined ? tip : min(tip, from + args.maxBlocks - 1n);
  const addresses = [snapshot.contracts.pool, snapshot.contracts.ledger, snapshot.contracts.memo];

  try {
    await readPages<RawLog>({
      fromBlock: from,
      toBlock: capped,
      getLogs: (page) => chain.getLogs(addresses, page),
      onPage: async (page, logs) => {
        snapshot = { ...applyLogs(snapshot, logs), syncedTo: page.toBlock.toString() };
        await store.save(snapshot);
      },
      sleep: args.sleep,
      ...(args.retry ? { retry: args.retry } : {}),
    });
  } catch (e) {
    if (e instanceof PageFailed) return { kind: "page-failed", snapshot, head, error: e };
    throw e;
  }

  if (snapshot.checkedAt !== snapshot.syncedTo && BigInt(snapshot.syncedTo) >= BigInt(snapshot.startBlock)) {
    snapshot = await checkCounts(snapshot, chain);
    await store.save(snapshot);
  }
  return { kind: "synced", snapshot, head, complete: isComplete(snapshot) };
}

/** Compares the leaf counts with nextIndex() of both contracts, both read at the cursor block. */
async function checkCounts(s: Snapshot, chain: IndexChain): Promise<Snapshot> {
  const at = BigInt(s.syncedTo);
  const [poolNext, ledgerNext] = [await chain.nextIndex(s.contracts.pool, at), await chain.nextIndex(s.contracts.ledger, at)];
  const problems = [...s.problems];
  if (poolNext !== BigInt(s.poolLeaves.length)) {
    problems.push(`pool has ${poolNext} leaves at block ${at}, the index has ${s.poolLeaves.length}`);
  }
  if (ledgerNext !== BigInt(s.ledgerLeaves.length)) {
    problems.push(`ledger has ${ledgerNext} leaves at block ${at}, the index has ${s.ledgerLeaves.length}`);
  }
  return { ...s, problems, checkedAt: s.syncedTo };
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
