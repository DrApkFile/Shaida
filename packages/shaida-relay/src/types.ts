import type { Address, Hex } from "viem";
import type { ErrorCode, ShaidaError } from "@shaida/proofs";

/** The relayed functions. Each has exactly one route and one contract function (AEVUM_INTEGRATION §4). */
export const RELAY_FNS = ["deposit", "vouchedPay", "lateVouch", "sweep", "memo"] as const;
export type RelayFn = (typeof RELAY_FNS)[number];

/**
 * PRD §6: accepted → pending → mined | dropped | unknown. `accepted` = passed every rail, simulated, signed and
 * persisted with its hash, not yet handed to the node. `unknown` has no resend edge: it is resolved only by
 * checking the hash (or the nonce being used by another transaction).
 */
export type RecordState = "accepted" | "pending" | "mined" | "dropped" | "unknown";

export interface RequestRecord {
  readonly requestId: string;
  readonly chainId: number;
  readonly fn: RelayFn;
  /** Idempotency key: the nullifier or commitment the call consumes. One live record per key. */
  readonly key: string;
  readonly payer: Address | null;
  readonly state: RecordState;
  readonly nonce: number;
  readonly hash: Hex;
  /** Gas limit sent (min(estimate × 1.3, the function's cap)). Reserved against the budget until mined. */
  readonly gas: string;
  readonly gasPrice: string;
  readonly gasUsed: string | null;
  readonly block: string | null;
  readonly reverted: boolean | null;
  /** Why it is dropped, unknown or reverted. */
  readonly error: ShaidaError | null;
  /** UTC day (YYYY-MM-DD) whose budget it counts against. */
  readonly budgetDay: string;
  readonly history: readonly { readonly state: RecordState; readonly at: string }[];
}

export interface RelayContracts {
  readonly token: Address;
  readonly pool: Address;
  readonly ledger: Address;
  readonly depositor: Address;
  readonly registry: Address;
  readonly memo: Address;
}

export interface Call {
  readonly to: Address;
  readonly data: Hex;
}

/** What the chain said when a call was simulated. */
export type Simulation = { readonly ok: true } | { readonly ok: false; readonly errorName: string | null; readonly reason: string };

/** sendRawTransaction failed. `rejected`: the node answered with an error (not taken). `transport`: no answer. */
export class SendError extends Error {
  constructor(
    readonly kind: "rejected" | "transport",
    message: string,
  ) {
    super(message);
    this.name = "SendError";
  }
}

/** Chain access the relayer needs. Reads with a block are pinned to it. */
export interface RelayChain {
  chainId(): Promise<number>;
  blockNumber(): Promise<bigint>;
  read(to: Address, fn: string, args: readonly unknown[], block: bigint): Promise<unknown>;
  simulate(from: Address, call: Call): Promise<Simulation>;
  estimateGas(from: Address, call: Call): Promise<bigint>;
  gasPrice(): Promise<bigint>;
  balance(address: Address): Promise<bigint>;
  /** eth_getTransactionCount(address, "pending") and (address, "latest"). */
  nonce(address: Address, tag: "pending" | "latest"): Promise<number>;
  sendRaw(raw: Hex): Promise<Hex>;
  receipt(hash: Hex): Promise<{ status: "success" | "reverted"; gasUsed: bigint; blockNumber: bigint } | null>;
}

export interface LegacyTx {
  readonly type: "legacy";
  readonly chainId: number;
  readonly nonce: number;
  readonly to: Address;
  readonly data: Hex;
  readonly gas: bigint;
  readonly gasPrice: bigint;
  readonly value: 0n;
}

export interface RelaySigner {
  readonly address: Address;
  signTransaction(tx: LegacyTx): Promise<Hex>;
}

/** The relayer's persisted state: records, rate windows, budget. Replaced whole on every change. */
export interface RelayState {
  records: Record<string, RequestRecord>;
  /** key → requestId of its latest record. */
  byKey: Record<string, string>;
  /** bucket → timestamps (ms) in the last minute. */
  rate: Record<string, number[]>;
}

export interface RelayStore {
  /** Runs `change` on the current state and persists the result before resolving. */
  update<T>(change: (s: RelayState) => T): Promise<T>;
  read(): Promise<RelayState>;
}

export type RelayReply =
  | { readonly ok: true; readonly status: 200 | 202; readonly record: RequestRecord; readonly repeated: boolean }
  | { readonly ok: false; readonly status: number; readonly error: ShaidaError };

export type Refusal = { readonly code: ErrorCode; readonly message: string };
