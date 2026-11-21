// Applies one page of raw logs to a snapshot, in chain order. Any leaf whose index is not its position is a gap:
// it is recorded in `problems` and the tree stays incomplete until a full resync.
import { decodeEventLog, getAbiItem, toEventSelector, type Hex } from "viem";
import { ledgerEventsAbi, memoAbi, poolAbi } from "./abi";
import type { LedgerLeaf, Snapshot } from "./snapshot";

export interface RawLog {
  readonly address: Hex;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly transactionHash: Hex;
}

const lc = (h: string): Hex => h.toLowerCase() as Hex;

/** Chain order: by block, then by position in the block. */
export function inChainOrder(logs: readonly RawLog[]): RawLog[] {
  return [...logs].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
}

/** Returns a new snapshot; the input is not changed. */
export function applyLogs(s: Snapshot, logs: readonly RawLog[]): Snapshot {
  const next: Snapshot = {
    ...s,
    poolLeaves: [...s.poolLeaves],
    ledgerLeaves: [...s.ledgerLeaves],
    memos: [...s.memos],
    problems: [...s.problems],
  };
  for (const log of inChainOrder(logs)) {
    const at = lc(log.address);
    if (at === s.contracts.pool) applyPool(next, log);
    else if (at === s.contracts.ledger) applyLedger(next, log);
    else if (at === s.contracts.memo) applyMemo(next, log);
  }
  return next;
}

const topics = (log: RawLog) => log.topics as [Hex, ...Hex[]];

const SHIELDED = toEventSelector(getAbiItem({ abi: poolAbi, name: "Shielded" }));
const TRANSFERRED = toEventSelector(getAbiItem({ abi: poolAbi, name: "Transferred" }));
const VOUCHED = toEventSelector(getAbiItem({ abi: ledgerEventsAbi, name: "Vouched" }));
const SWEPT = toEventSelector(getAbiItem({ abi: ledgerEventsAbi, name: "Swept" }));
const PAYMENT_MEMO = toEventSelector(getAbiItem({ abi: memoAbi, name: "PaymentMemo" }));

/** Leaf-bearing events by topic0. Other events of these contracts (setup, Unshielded) carry no leaf. */
export const LEAF_TOPICS = { SHIELDED, TRANSFERRED, VOUCHED, SWEPT, PAYMENT_MEMO } as const;

function applyPool(s: Snapshot, log: RawLog): void {
  const t0 = log.topics[0];
  if (t0 === SHIELDED) {
    const ev = decodeEventLog({ abi: poolAbi, eventName: "Shielded", data: log.data, topics: topics(log), strict: true });
    if (ev.args.leafIndex !== BigInt(s.poolLeaves.length)) {
      s.problems.push(`pool gap at block ${log.blockNumber}: Shielded leafIndex ${ev.args.leafIndex}, expected ${s.poolLeaves.length}`);
    }
    s.poolLeaves.push(lc(ev.args.commitment));
  } else if (t0 === TRANSFERRED) {
    const ev = decodeEventLog({ abi: poolAbi, eventName: "Transferred", data: log.data, topics: topics(log), strict: true });
    s.poolLeaves.push(lc(ev.args.newCommitments[0]), lc(ev.args.newCommitments[1]));
  }
}

function applyLedger(s: Snapshot, log: RawLog): void {
  const t0 = log.topics[0];
  const block = log.blockNumber.toString();
  let leaf: LedgerLeaf;
  if (t0 === VOUCHED) {
    const ev = decodeEventLog({ abi: ledgerEventsAbi, eventName: "Vouched", data: log.data, topics: topics(log), strict: true });
    leaf = { kind: "vouch", index: Number(ev.args.leafIndex), leaf: lc(ev.args.leaf), payerId: ev.args.payerId, commitment: lc(ev.args.paymentCommitment), block };
  } else if (t0 === SWEPT) {
    const ev = decodeEventLog({ abi: ledgerEventsAbi, eventName: "Swept", data: log.data, topics: topics(log), strict: true });
    leaf = { kind: "sweep", index: Number(ev.args.leafIndex), leaf: lc(ev.args.leaf), nullifier: lc(ev.args.nullifier), sweepCommitment: lc(ev.args.sweepCommitment), block };
  } else {
    return;
  }
  const expected = s.ledgerLeaves.length;
  if (leaf.index !== expected) {
    s.problems.push(`ledger gap at block ${block}: ${leaf.kind} leafIndex ${leaf.index}, expected ${expected}`);
  }
  s.ledgerLeaves.push(leaf);
}

function applyMemo(s: Snapshot, log: RawLog): void {
  if (log.topics[0] !== PAYMENT_MEMO) return;
  const ev = decodeEventLog({ abi: memoAbi, eventName: "PaymentMemo", data: log.data, topics: topics(log), strict: true });
  s.memos.push({ commitment: lc(ev.args.paymentCommitment), memo: lc(ev.args.memo), block: log.blockNumber.toString(), tx: lc(log.transactionHash) });
}
