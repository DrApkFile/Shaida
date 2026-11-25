// ShaidaLedger reads over plain JSON-RPC, all pinned to one block (the latest when the call starts):
//   isKnownRoot(root)     PRD §5 step 6
//   datesForRange         step 8: the block times of the first V leaf ≥ fromIndex and the last V leaf ≤ toIndex
//   rootTime(root)        the block time the root was formed (the policy rule ProofTooOld)
//   revokedAt(salt)       step 5a (0.2.0, D35): Revocations.revokedAt at the same block, and that revocation's time
// No indexer and no full log scan: the block of leaf i is found by binary search on nextIndex() at past blocks, and a
// leaf's kind (V or S) by one eth_getLogs over ≤ 1000 blocks there (Aevum's getLogs limit). All selectors and topics
// are checked against viem in test S11.
import { hexOf, word, type Rpc } from "./rpc";
import type { NetworkConfig } from "./types";

export const SELECTORS = { isKnownRoot: "0x6d9833e3", nextIndex: "0xfc7e9c6f", check: "0x1620e538", revokedAt: "0x871bd456" } as const;
export const TOPICS = {
  Vouched: "0x0f261e8c13be127d3405bce37a07673fe92d4b7002a3c90a2bc5af9274b48bd6",
  Swept: "0xb8b0aa967035d4c4e2afe48f28aab6fc93be6b675d3936a1884e0f0f0fdafc95",
} as const;
const LOG_SPAN = 999n;
/** Leaves walked from one end of a range before giving up (RangeUnresolvable): bounds the RPC calls of one verify. */
const MAX_WALK = 64;

interface Log { readonly topics: readonly string[]; readonly data: string; readonly blockNumber: string }
interface Leaf { readonly vouch: boolean; readonly block: bigint }

export interface LedgerReader {
  readonly block: bigint;
  isKnownRoot(root: bigint): Promise<boolean>;
  datesForRange(fromIndex: bigint, toIndex: bigint): Promise<{ fromDate: bigint; toDate: bigint } | null>;
  rootTime(root: bigint): Promise<bigint | null>;
  /** null: not revoked at `block`. Needs net.revocations (the caller checks it is set). */
  revokedAt(salt: bigint): Promise<{ block: bigint; time: bigint } | null>;
}

export async function ledgerAt(rpc: Rpc, net: NetworkConfig): Promise<LedgerReader> {
  const chain = BigInt(await rpc.call<string>("eth_chainId", []));
  if (chain !== BigInt(net.chainId)) throw new WrongChain(`the RPC ${rpc.url} serves chain ${chain}, not ${net.chainId} (${net.name})`);
  const block = BigInt(await rpc.call<string>("eth_blockNumber", []));
  const ethCall = (data: string, at: bigint) => rpc.call<string>("eth_call", [{ to: net.ledger, data }, hexOf(at)]);
  // "0x" is what a block before the ledger's deployment answers: no code there, so no root and no leaf.
  const uint = (h: string) => (h === "0x" ? 0n : BigInt(h));
  const known = async (root: bigint, at: bigint) => uint(await ethCall(`${SELECTORS.isKnownRoot}${word(root)}`, at)) === 1n;
  const nextIndex = async (at: bigint) => uint(await ethCall(SELECTORS.nextIndex, at));
  const times = new Map<bigint, Promise<bigint>>();
  const timeOf = (b: bigint) => {
    let t = times.get(b);
    if (!t) {
      t = rpc.call<{ timestamp: string } | null>("eth_getBlockByNumber", [hexOf(b), false]).then((r) => {
        if (!r) throw new Error(`block ${b} not found`);
        return BigInt(r.timestamp);
      });
      times.set(b, t);
    }
    return t;
  };
  /** Smallest block in [lo, hi] where pred holds (pred is monotone false→true), or null. */
  const firstBlock = async (pred: (b: bigint) => Promise<boolean>, lo: bigint, hi: bigint): Promise<bigint | null> => {
    if (!(await pred(hi))) return null;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if (await pred(mid)) hi = mid;
      else lo = mid + 1n;
    }
    return lo;
  };
  const leaves = new Map<bigint, Leaf>();
  const loadAround = async (i: bigint): Promise<void> => {
    const b = await firstBlock(async (at) => (await nextIndex(at)) > i, net.fromBlock, block);
    if (b === null) return;
    const lo = b > LOG_SPAN ? b - LOG_SPAN / 2n : 0n;
    const hi = lo + LOG_SPAN < block ? lo + LOG_SPAN : block;
    const logs = await rpc.call<Log[]>("eth_getLogs", [{ address: net.ledger, fromBlock: hexOf(lo < net.fromBlock ? net.fromBlock : lo), toBlock: hexOf(hi), topics: [[TOPICS.Vouched, TOPICS.Swept]] }]);
    for (const l of logs) leaves.set(BigInt(`0x${l.data.slice(2, 66)}`), { vouch: l.topics[0] === TOPICS.Vouched, block: BigInt(l.blockNumber) });
    if (!leaves.has(i)) throw new Error(`leaf ${i} was inserted in block ${b}, but no ledger log there names it`);
  };
  const leafAt = async (i: bigint): Promise<Leaf | null> => {
    if (!leaves.has(i)) await loadAround(i);
    return leaves.get(i) ?? null;
  };
  /** First V leaf from `start` stepping by `dir` while inside [from, to]. */
  const walk = async (start: bigint, dir: 1n | -1n, from: bigint, to: bigint): Promise<Leaf | null> => {
    for (let i = start, n = 0; i >= from && i <= to && n < MAX_WALK; i += dir, n++) {
      const leaf = await leafAt(i);
      if (leaf === null) return null;
      if (leaf.vouch) return leaf;
    }
    return null;
  };
  return {
    block,
    isKnownRoot: (root) => known(root, block),
    async datesForRange(fromIndex, toIndex) {
      const first = await walk(fromIndex, 1n, fromIndex, toIndex);
      const last = first && (await walk(toIndex, -1n, fromIndex, toIndex));
      return first && last ? { fromDate: await timeOf(first.block), toDate: await timeOf(last.block) } : null;
    },
    async rootTime(root) {
      const b = await firstBlock((at) => known(root, at), net.fromBlock, block);
      return b === null ? null : timeOf(b);
    },
    async revokedAt(salt) {
      if (net.revocations === null) throw new Error("this network has no Revocations registry");
      const raw = await rpc.call<string>("eth_call", [{ to: net.revocations, data: `${SELECTORS.revokedAt}${word(salt)}` }, hexOf(block)]);
      // "0x" here means no contract at that address and block: that is not "not revoked", it is an unreadable registry.
      if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error(`Revocations at ${net.revocations} answered ${raw.slice(0, 20)} at block ${block}, not a uint256 (no contract there?)`);
      const at = BigInt(raw);
      if (at === 0n) return null;
      if (at > block) throw new Error(`Revocations answered block ${at}, after the pinned block ${block}`);
      return { block: at, time: await timeOf(at) };
    },
  };
}

/** The RPC answered for another chain: nothing it says can be trusted for this network. */
export class WrongChain extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WrongChain";
  }
}
