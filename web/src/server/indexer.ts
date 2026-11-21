import "server-only";
import { join } from "node:path";
import { isComplete, syncIndex, type Snapshot, type SnapshotStore } from "@shaida/index";
import type { Network } from "@/lib/env";
import type { ShaidaContracts } from "@/lib/shaida";
import { indexChainFor } from "./chain";
import { dataDir, readJson, serialized, writeJsonAtomic } from "./json-file";

/** Blocks read per request at most (10 pages); the client polls until `behind` is 0. */
const MAX_BLOCKS_PER_REQUEST = 10_000n;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fileStore(chainId: number): SnapshotStore {
  const path = join(dataDir(), `index-${chainId}.json`);
  return { load: () => readJson(path), save: (s) => writeJsonAtomic(path, s) };
}

export interface IndexReply {
  readonly snapshot: Snapshot;
  readonly head: string;
  /** Blocks between the cursor and the head. */
  readonly behind: string;
  readonly complete: boolean;
  /** Set when a page kept failing: the snapshot stops at the last good page. */
  readonly pageError: string | null;
}

/** One sync per chain at a time in this process; concurrent requests wait for it and see its result. */
export function syncFor(net: Network, contracts: ShaidaContracts): Promise<IndexReply> {
  return serialized(`index:${net.chain.id}`, async () => {
    const out = await syncIndex({
      target: { chainId: net.chain.id, contracts, startBlock: contracts.startBlock },
      chain: indexChainFor(net),
      store: fileStore(net.chain.id),
      sleep,
      maxBlocks: MAX_BLOCKS_PER_REQUEST,
    });
    const behind = out.head - BigInt(out.snapshot.syncedTo);
    return {
      snapshot: out.snapshot,
      head: out.head.toString(),
      behind: (behind > 0n ? behind : 0n).toString(),
      complete: isComplete(out.snapshot),
      pageError: out.kind === "page-failed" ? out.error.message : null,
    };
  });
}
