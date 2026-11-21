// A chain that answers like Aevum's RPC for the index: real ABI-encoded events, the node's page rule
// (toBlock − fromBlock ≤ 1000, else "block range too large"), nextIndex at any block, and injectable failures.
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { LedgerTree, sweepLeaf, vouchLeaf } from "@shaida/proofs";
import { ledgerEventsAbi, memoAbi, poolAbi, type IndexChain, type Page, type RawLog, type RootReader, type Snapshot, type SnapshotStore } from "../../src/index";

export const CONTRACTS = {
  pool: "0x00000000000000000000000000000000000000a1",
  ledger: "0x00000000000000000000000000000000000000b2",
  memo: "0x00000000000000000000000000000000000000c3",
} as const;
export const CHAIN_ID = 440050;
export const START = 1_000n;

const h32 = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;

interface Entry {
  log: RawLog;
  pool: bigint[];
  ledger: bigint[];
}

export class FakeChain implements IndexChain, RootReader {
  head = START;
  private readonly entries: Entry[] = [];
  private poolLeaves: bigint[] = [];
  private ledgerLeaves: bigint[] = [];
  private readonly poolRoots = new Map<bigint, bigint>();
  private readonly ledgerRoots = new Map<bigint, bigint>();
  /** Pages asked for, in order. */
  readonly calls: Page[] = [];
  /** Throw on the next n getLogs calls. */
  failNext = 0;
  /** Drop logs from this block from every reply (a node that loses logs). */
  loseBlock: bigint | null = null;

  async chainId() { return CHAIN_ID; }
  async blockNumber() { return this.head; }

  async getLogs(addresses: readonly string[], page: Page): Promise<readonly RawLog[]> {
    this.calls.push(page);
    if (page.toBlock - page.fromBlock > 1000n) throw new Error("block range too large, max range: 1000");
    if (this.failNext > 0) { this.failNext--; throw new Error("HTTP 502"); }
    return this.entries
      .map((e) => e.log)
      .filter((l) => l.blockNumber >= page.fromBlock && l.blockNumber <= page.toBlock && l.blockNumber !== this.loseBlock)
      .filter((l) => addresses.includes(l.address.toLowerCase()));
  }

  async nextIndex(contract: string, block: bigint): Promise<bigint> {
    const upTo = this.entries.filter((e) => e.log.blockNumber <= block).at(-1);
    const which = contract === CONTRACTS.pool ? "pool" : "ledger";
    return BigInt(upTo ? upTo[which].length : 0);
  }

  async isKnownRoot(contract: string, root: bigint, block: bigint): Promise<boolean> {
    const roots = contract === CONTRACTS.pool ? this.poolRoots : this.ledgerRoots;
    return [...roots].some(([r, at]) => r === root && at <= block) || root === new LedgerTree([]).root;
  }

  private emit(block: bigint, address: Hex, topics: Hex[], data: Hex) {
    if (block > this.head) this.head = block;
    const logIndex = this.entries.filter((e) => e.log.blockNumber === block).length;
    const log: RawLog = { address, topics, data, blockNumber: block, logIndex, transactionHash: h32(block * 1000n + BigInt(logIndex)) };
    this.entries.push({ log, pool: [...this.poolLeaves], ledger: [...this.ledgerLeaves] });
    this.poolRoots.set(new LedgerTree(this.poolLeaves).root, block);
    this.ledgerRoots.set(new LedgerTree(this.ledgerLeaves).root, block);
  }

  shield(block: bigint, commitment: bigint) {
    const leafIndex = BigInt(this.poolLeaves.length);
    this.poolLeaves.push(commitment);
    const topics = encodeEventTopics({ abi: poolAbi, eventName: "Shielded", args: { commitment: h32(commitment), asset: "0x456569838f1d43009A91ebA4263147Afd7233483", from: "0x0000000000000000000000000000000000000001" } });
    this.emit(block, CONTRACTS.pool, topics as Hex[], encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [5_000_000n, leafIndex]));
  }

  transfer(block: bigint, nullifier: bigint, c0: bigint, c1: bigint) {
    this.poolLeaves.push(c0, c1);
    const topics = encodeEventTopics({ abi: poolAbi, eventName: "Transferred", args: { nullifier: h32(nullifier) } });
    this.emit(block, CONTRACTS.pool, topics as Hex[], encodeAbiParameters([{ type: "bytes32[2]" }], [[h32(c0), h32(c1)]]));
  }

  vouch(block: bigint, payerId: number, commitment: bigint, opts: { lieLeaf?: bigint } = {}) {
    const leafIndex = BigInt(this.ledgerLeaves.length);
    const leaf = opts.lieLeaf ?? vouchLeaf(BigInt(payerId), commitment);
    this.ledgerLeaves.push(leaf);
    const topics = encodeEventTopics({ abi: ledgerEventsAbi, eventName: "Vouched", args: { payerId, paymentCommitment: h32(commitment) } });
    this.emit(block, CONTRACTS.ledger, topics as Hex[], encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [leafIndex, h32(leaf)]));
  }

  sweep(block: bigint, nullifier: bigint, sweepCommitment: bigint) {
    const leafIndex = BigInt(this.ledgerLeaves.length);
    const leaf = sweepLeaf(nullifier, sweepCommitment);
    this.ledgerLeaves.push(leaf);
    const topics = encodeEventTopics({ abi: ledgerEventsAbi, eventName: "Swept", args: { nullifier: h32(nullifier), sweepCommitment: h32(sweepCommitment) } });
    this.emit(block, CONTRACTS.ledger, topics as Hex[], encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [leafIndex, h32(leaf)]));
  }

  memo(block: bigint, commitment: bigint, memo: Hex) {
    const topics = encodeEventTopics({ abi: memoAbi, eventName: "PaymentMemo", args: { paymentCommitment: h32(commitment) } });
    this.emit(block, CONTRACTS.memo, topics as Hex[], encodeAbiParameters([{ type: "bytes" }], [memo]));
  }
}

/** A store that keeps the JSON text, as the file store does, so every load goes through the schema. */
export class MemoryStore implements SnapshotStore {
  text: string | null = null;
  saves = 0;
  async load(): Promise<unknown> { return this.text === null ? null : JSON.parse(this.text); }
  async save(s: Snapshot) { this.text = JSON.stringify(s); this.saves++; }
}

export const target = { chainId: CHAIN_ID, contracts: CONTRACTS, startBlock: START };
export const noSleep = async (_ms: number) => {};
