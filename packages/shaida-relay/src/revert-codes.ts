// Simulation reverts → closed codes (PRD §4, D17). Custom errors first, then the token's revert strings.
import type { ErrorCode } from "@shaida/proofs";
import type { Refusal, Simulation } from "./types";

const BY_ERROR_NAME: Record<string, ErrorCode> = {
  AlreadySpent: "AlreadySpent",
  UnknownRoot: "UnknownRoot",
  InvalidProof: "ProofInvalid",
  AlreadyVouched: "AlreadyVouched",
  PayerNotRegistered: "PayerNotRegistered",
  PayerRevoked: "PayerRevoked",
  TokenPaused: "TokenPaused",
  PayerBlacklisted: "PayerBlacklisted",
  SignatureExpired: "SignatureInvalid",
  BadPayerSignature: "SignatureInvalid",
  DuplicateCommitment: "InputRejected",
  UnknownCommitment: "InputRejected",
  ZeroCommitment: "InputRejected",
  ZeroAmount: "InputRejected",
  InvalidAmount: "InputRejected",
  OverDepositLimit: "InputRejected",
  BadMemo: "InputRejected",
};

/** FiatTokenV2_2 revert strings (S9). */
const BY_REASON: readonly [RegExp, ErrorCode][] = [
  [/Pausable: paused/i, "TokenPaused"],
  [/Blacklistable: account is blacklisted/i, "PayerBlacklisted"],
  [/invalid signature|authorization is (used|expired|not yet valid)|caller must be the payee/i, "SignatureInvalid"],
  [/transfer amount exceeds balance|exceeds balance/i, "InputRejected"],
];

export function refusalOf(sim: Extract<Simulation, { ok: false }>): Refusal {
  const byName = sim.errorName ? BY_ERROR_NAME[sim.errorName] : undefined;
  if (byName) return { code: byName, message: `The chain refused this call (${sim.errorName}). Nothing was sent.` };
  const byReason = BY_REASON.find(([re]) => re.test(sim.reason));
  if (byReason) return { code: byReason[1], message: `The chain refused this call: ${sim.reason}. Nothing was sent.` };
  return { code: "TxRejected", message: `The chain refused this call${sim.errorName ? ` (${sim.errorName})` : ""}: ${sim.reason}. Nothing was sent.` };
}
