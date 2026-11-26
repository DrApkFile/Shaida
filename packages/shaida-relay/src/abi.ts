import { parseAbi } from "viem";

/** The seven functions the relayer may call. Nothing else is ever encoded. */
export const depositorAbi = parseAbi([
  "struct Authorization { uint256 validAfter; uint256 validBefore; uint8 v; bytes32 r; bytes32 s; }",
  "function depositWithAuthorization(address payer, uint256 amount, bytes32 commitment, bytes shieldProof, Authorization auth)",
]);

export const ledgerAbi = parseAbi([
  "struct TransferArgs { bytes proof; bytes32 root; bytes32 nullifier; bytes32[2] newCommitments; }",
  "function vouchedPayFor(TransferArgs t, address payer, uint256 deadline, bytes signature) returns (uint256)",
  "function lateVouchFor(bytes32 paymentCommitment, address payer, uint256 deadline, bytes signature) returns (uint256)",
  "function sweep(TransferArgs t) returns (uint256)",
  "function vouched(bytes32 paymentCommitment) view returns (bool)",
]);

export const memoBoardAbi = parseAbi(["function postMemo(bytes32 paymentCommitment, bytes memo)"]);

export const poolAbi = parseAbi(["function unshield(bytes proof, bytes32 root, bytes32 nullifier, address asset, address to, uint256 amount)"]);

/** Revocations (D35). */
export const revocationsAbi = parseAbi(["function revoke(uint256 secret) returns (uint256)"]);

/** Reads the rails make, each at one pinned block. */
export const readsAbi = parseAbi([
  "function paused() view returns (bool)",
  "function isBlacklisted(address account) view returns (bool)",
  "function activeIdOf(address account) view returns (uint32)",
  "function isSpent(bytes32 nullifier) view returns (bool)",
  "function isKnownRoot(bytes32 root) view returns (bool)",
  "function commitmentSeen(bytes32 commitment) view returns (bool)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function revokedAt(uint256 salt) view returns (uint256)",
]);

/** Every custom error a relayed call can revert with, so a simulation revert decodes to a name. */
export const relayErrorsAbi = parseAbi([
  // Gloam ShieldPoolCore
  "error AlreadySpent()",
  "error UnknownRoot()",
  "error InvalidProof()",
  "error DuplicateCommitment()",
  "error ZeroCommitment()",
  "error OverDepositLimit()",
  "error InvalidAmount()",
  "error ZeroAddress()",
  "error InsufficientPoolBalance()",
  "error Reentrancy()",
  // GloamPayMemo
  "error BadMemo()",
  // ShaidaLedger
  "error SignatureExpired(uint256 deadline)",
  "error BadPayerSignature(address payer)",
  "error AlreadyVouched(bytes32 paymentCommitment)",
  "error UnknownCommitment(bytes32 paymentCommitment)",
  // PayerRegistry
  "error PayerNotRegistered(address account)",
  "error PayerRevoked(uint32 payerId)",
  // ShaidaDepositor
  "error TokenPaused()",
  "error PayerBlacklisted(address payer)",
  "error ZeroAmount()",
  "error PoolPullMismatch(uint256 balanceBefore, uint256 balanceAfter)",
  // Revocations (D35)
  "error BadSecret()",
  "error AlreadyRevoked(uint256 salt, uint256 blockNumber)",
]);
