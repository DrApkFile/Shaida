// The EIP-712 messages a payer signs. The relayer recovers the signer itself before any chain call, so a bad
// signature costs one ecrecover, not a simulation.
import { keccak256, encodeAbiParameters, type Address, type Hex } from "viem";

export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const vouchTypes = {
  Vouch: [
    { name: "root", type: "bytes32" },
    { name: "nullifier", type: "bytes32" },
    { name: "paymentCommitment", type: "bytes32" },
    { name: "changeCommitment", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const lateVouchTypes = {
  LateVouch: [
    { name: "paymentCommitment", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** tUSD8's EIP-712 domain (FiatTokenV2_2, name "tUSD8", version "2"; S6). */
export const tokenDomain = (chainId: number, token: Address) => ({ name: "tUSD8", version: "2", chainId, verifyingContract: token }) as const;

/** ShaidaLedger's EIP-712 domain (EIP712("ShaidaLedger", "1")). */
export const ledgerDomain = (chainId: number, ledger: Address) =>
  ({ name: "ShaidaLedger", version: "1", chainId, verifyingContract: ledger }) as const;

/** ShaidaDepositor.authorizationNonce(commitment) = keccak256(abi.encode(depositor, commitment)). */
export const depositNonce = (depositor: Address, commitment: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [depositor, commitment]));

export interface DepositAuthorization {
  readonly payer: Address;
  readonly depositor: Address;
  readonly amount: bigint;
  readonly validAfter: bigint;
  readonly validBefore: bigint;
  readonly commitment: Hex;
}

export const depositTypedData = (chainId: number, token: Address, a: DepositAuthorization) => ({
  domain: tokenDomain(chainId, token),
  types: receiveWithAuthorizationTypes,
  primaryType: "ReceiveWithAuthorization" as const,
  message: { from: a.payer, to: a.depositor, value: a.amount, validAfter: a.validAfter, validBefore: a.validBefore, nonce: depositNonce(a.depositor, a.commitment) },
});

export interface TransferFields {
  readonly proof: Hex;
  readonly root: Hex;
  readonly nullifier: Hex;
  readonly newCommitments: readonly [Hex, Hex];
}

export const vouchTypedData = (chainId: number, ledger: Address, t: TransferFields, deadline: bigint) => ({
  domain: ledgerDomain(chainId, ledger),
  types: vouchTypes,
  primaryType: "Vouch" as const,
  message: { root: t.root, nullifier: t.nullifier, paymentCommitment: t.newCommitments[0], changeCommitment: t.newCommitments[1], deadline },
});

export const lateVouchTypedData = (chainId: number, ledger: Address, paymentCommitment: Hex, deadline: bigint) => ({
  domain: ledgerDomain(chainId, ledger),
  types: lateVouchTypes,
  primaryType: "LateVouch" as const,
  message: { paymentCommitment, deadline },
});
