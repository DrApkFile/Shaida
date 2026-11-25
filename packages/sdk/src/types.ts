// The SDK's public types. Declared here, in full, so the published .d.ts files stand alone (no workspace imports).

/** A network the SDK can verify against. "aevum-testnet" is bundled and pinned; a custom one is for local forks. */
export interface NetworkConfig {
  readonly name: string;
  readonly chainId: number;
  /** The default RPC for this network, or null (a custom network needs `rpcUrl`). */
  readonly rpcUrl: string | null;
  /** tUSD8 (6 decimals). */
  readonly asset: string;
  readonly ledger: string;
  readonly incomeVerifier: string;
  /** ShaidaLedger's deploy block: no leaf exists before it. */
  readonly fromBlock: bigint;
}

/** A local fork or test chain with its own deployment. Chain 44005 is refused here: use "aevum-testnet". */
export interface CustomNetwork {
  readonly name: string;
  readonly chainId: number;
  readonly ledger: string;
  readonly incomeVerifier: string;
  readonly fromBlock: bigint;
}

export interface ReadOptions {
  readonly network: "aevum-testnet" | CustomNetwork;
  /** The JSON-RPC endpoint you trust for this network. Default for "aevum-testnet": https://rpc-test.qday.info */
  readonly rpcUrl?: string;
  /** Per RPC call. Default 15 000 ms. */
  readonly timeoutMs?: number;
}

export interface VerifyOptions extends ReadOptions {
  /** Your name as the reader, exactly as the recipient typed it (case and spacing are normalised). */
  readonly readerName: string;
  /** Unix seconds. Default: the system clock. */
  readonly now?: () => bigint;
}

/** Codes that are a final answer about the link. */
export type InvalidCode =
  | "ProofInvalid" | "AssetMismatch" | "MixedContexts" | "MixedRoots" | "RangesOverlap" | "ContextMismatch" | "WrongReader" | "ProofExpired";
/** Codes that mean "no answer yet": never a pass. */
export type InconclusiveCode = "UnknownRoot" | "RangeUnresolvable" | "ChainUnreachable" | "NotConfigured" | "InputRejected";
export type VerifyCode = InvalidCode | InconclusiveCode;

export interface Valid {
  readonly status: "VALID";
  /** At least this much tUSD8 was received, in base units (6 decimals): Σ of the bundle's thresholds. */
  readonly threshold: bigint;
  /** From at least this many vouched payments. */
  readonly count: number;
  /** Block time of the first vouched payment counted, and of the last. */
  readonly from: Date;
  readonly to: Date;
  /** The link stops verifying after this time. */
  readonly expiry: Date;
  readonly proofs: number;
  readonly leafRange: { readonly from: number; readonly to: number };
  /** The ledger root the proofs were built on (0x-hex), known on chain at `block`. */
  readonly ledgerRoot: string;
  readonly network: string;
  /** The block every chain read was pinned to. */
  readonly block: bigint;
}

export interface Refused<S extends "INVALID" | "INCONCLUSIVE", C extends VerifyCode> {
  readonly status: S;
  readonly code: C;
  /** Plain words: what happened, and that nothing was recorded. */
  readonly message: string;
  readonly nextAction: string;
}

export type Verification = Valid | Refused<"INVALID", InvalidCode> | Refused<"INCONCLUSIVE", InconclusiveCode>;

/** A link's payload, decoded and schema-checked but NOT verified: never trust these numbers without verifyIncomeLink. */
export interface DecodedLink {
  readonly version: 1;
  readonly proofs: readonly {
    readonly ledgerRoot: string;
    readonly asset: string;
    readonly threshold: bigint;
    readonly count: number;
    readonly fromIndex: number;
    readonly toIndex: number;
    readonly context: string;
  }[];
  readonly readerIdHash: string;
  readonly expiry: Date;
}

export type Decoded = { readonly ok: true; readonly link: DecodedLink } | { readonly ok: false; readonly code: "ProofInvalid"; readonly message: string };

export type OnChainCheck =
  | { readonly status: "ACCEPTED"; readonly proofs: number; readonly block: bigint }
  /** `proof` is the 1-based proof the contract refused, or null when the link itself is malformed. */
  | { readonly status: "REJECTED"; readonly proof: number | null; readonly code: "ProofInvalid" | "AssetMismatch" | "UnknownRoot"; readonly message: string; readonly block: bigint | null }
  | Refused<"INCONCLUSIVE", "ChainUnreachable" | "NotConfigured">;

/** An underwriting policy: who the reader is and six limits. Build one with definePolicy, or use a preset. */
export interface Policy {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly audience: "landlord" | "lender" | "donor";
  readonly readerName: string;
  readonly minThreshold: bigint;
  readonly minPayments: number;
  readonly minPeriodDays: number;
  readonly maxPeriodDays: number;
  readonly maxProofAgeDays: number;
  readonly minDaysLeft: number;
  readonly readerIdHash: bigint;
  /** sha256 of the policy's canonical JSON: decisions name it, so a silent edit shows. */
  readonly hash: string;
}

export interface PolicyInput {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly audience: "landlord" | "lender" | "donor";
  readonly readerName: string;
  /** tUSD8 base units as a canonical decimal string, e.g. "3000000" for 3 tUSD8. */
  readonly minThreshold: string;
  readonly minPayments: number;
  readonly minPeriodDays: number;
  readonly maxPeriodDays: number;
  readonly maxProofAgeDays: number;
  readonly minDaysLeft: number;
}

export type RuleCode = "BelowMinThreshold" | "TooFewPayments" | "PeriodTooShort" | "PeriodTooLong" | "ProofTooOld" | "ExpiresTooSoon";
export type DeclineCode = InvalidCode | RuleCode;

export interface DecisionFacts {
  readonly threshold: string;
  readonly count: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly expiry: string;
  readonly rootTime: string;
  readonly periodDays: string;
  readonly proofAgeSeconds: string;
  readonly secondsLeft: string;
  readonly proofs: number;
}

interface DecisionCommon {
  /** Stable for the same link and the same policy (id, version, hash) while no time limit is crossed. */
  readonly decisionId: string;
  readonly proofId: string;
  readonly policy: { readonly id: string; readonly version: number; readonly hash: string; readonly title: string };
  readonly evaluatedAt: string;
}

export interface ShaidaErrorInfo {
  readonly code: string;
  readonly message: string;
  readonly retryable: "yes" | "no" | "later" | "check";
  readonly nextAction: string;
}

export type Decision =
  | (DecisionCommon & { readonly kind: "APPROVE"; readonly facts: DecisionFacts })
  | (DecisionCommon & { readonly kind: "DECLINE"; readonly reasons: readonly { readonly code: DeclineCode; readonly message: string }[]; readonly facts: DecisionFacts | null })
  | (DecisionCommon & { readonly kind: "INCONCLUSIVE"; readonly error: ShaidaErrorInfo });

export interface CodeInfo {
  readonly outcome: "INVALID" | "INCONCLUSIVE" | "DECLINE";
  readonly meaning: string;
  readonly nextAction: string;
}
