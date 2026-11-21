// The four hashes the income circuit recomputes. They must equal what Gloam's pool and ShaidaLedger compute:
// both use circomlibjs Poseidon (Gloam fixtures Poseidon2.json / Poseidon3.json). poseidon-lite (MIT) implements
// the same circomlib parameters; test/ledger-vectors.test.ts checks that against the contract's own output.
import { poseidon2, poseidon3 } from "poseidon-lite";
import { SWEEP_TAG, VOUCH_TAG } from "./field";

/** Gloam note commitment: Poseidon(secret, amount, asset). */
export const noteCommitment = (secret: bigint, amount: bigint, asset: bigint): bigint =>
  poseidon3([secret, amount, asset]);

/** Gloam nullifier of a note: Poseidon(secret, commitment). */
export const nullifierOf = (secret: bigint, commitment: bigint): bigint => poseidon2([secret, commitment]);

/** ShaidaLedger vouch leaf: Poseidon(1, payerId, paymentCommitment). */
export const vouchLeaf = (payerId: bigint, paymentCommitment: bigint): bigint =>
  poseidon3([VOUCH_TAG, payerId, paymentCommitment]);

/** ShaidaLedger sweep leaf: Poseidon(2, nullifier, sweepCommitment). */
export const sweepLeaf = (nullifier: bigint, sweepCommitment: bigint): bigint =>
  poseidon3([SWEEP_TAG, nullifier, sweepCommitment]);

/** Merkle node: Poseidon(left, right). */
export const hashPair = (left: bigint, right: bigint): bigint => poseidon2([left, right]);

/** Proof context (PRD §3): Poseidon(readerIdHash, expiryUnix, salt), checked by the verifier, not the circuit. */
export const contextOf = (readerIdHash: bigint, expiry: bigint, salt: bigint): bigint =>
  poseidon3([readerIdHash, expiry, salt]);
