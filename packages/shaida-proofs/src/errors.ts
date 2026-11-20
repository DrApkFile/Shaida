// Closed error codes (PRD §4). Shared by UI, API and bot; add a code only with a DECISIONS entry.

/** "check" = retry by checking the outcome (hash, nullifier), never by resending. */
export type Retryable = "yes" | "no" | "later" | "check";

interface CodeSpec {
  readonly retryable: Retryable;
  readonly nextAction: string;
}

export const ERROR_CODES = {
  PayerNotRegistered: { retryable: "no", nextAction: "register the payer first" },
  PayerRevoked: { retryable: "no", nextAction: "—" },
  UnknownRoot: { retryable: "yes", nextAction: "resync" },
  ProofInvalid: { retryable: "no", nextAction: "rebuild proof" },
  ProofExpired: { retryable: "no", nextAction: "ask for a new link" },
  WrongReader: { retryable: "no", nextAction: "ask for a link made for you" },
  ContextMismatch: { retryable: "no", nextAction: "link was altered" },
  AssetMismatch: { retryable: "no", nextAction: "—" },
  RangeUnresolvable: { retryable: "yes", nextAction: "resync" },
  TxOutcomeUnknown: { retryable: "check", nextAction: "wait; check by hash/nullifier" },
  RelayerBudgetExceeded: { retryable: "later", nextAction: "use standard mode" },
  NotEnoughSlots: { retryable: "no", nextAction: "split the period into shorter ones (more than 32 payments)" },
  TokenPaused: { retryable: "later", nextAction: "wait for the issuer to unpause; nothing was sent" },
  PayerBlacklisted: { retryable: "no", nextAction: "pay from another address" },
  RecipientBlacklisted: { retryable: "no", nextAction: "withdraw to another address" },
  // D10 (proof building)
  NoSweptPayments: { retryable: "no", nextAction: "sweep your payments, or pick a period that has some" },
  BelowThreshold: { retryable: "no", nextAction: "lower the threshold or widen the period" },
  InputRejected: { retryable: "no", nextAction: "fix the input; nothing was built" },
  // D12 (bundles of proofs)
  RangesOverlap: { retryable: "no", nextAction: "ask for a new link; a bundle must not count a leaf range twice" },
  MixedContexts: { retryable: "no", nextAction: "ask for a new link; its proofs were made for different readers or expiries" },
} as const satisfies Record<string, CodeSpec>;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ShaidaError {
  readonly code: ErrorCode;
  /** Says what happened and whether anything changed. */
  readonly message: string;
  readonly retryable: Retryable;
  readonly nextAction: string;
}

export const shaidaError = (code: ErrorCode, message: string): ShaidaError => ({
  code,
  message,
  retryable: ERROR_CODES[code].retryable,
  nextAction: ERROR_CODES[code].nextAction,
});

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ShaidaError };
