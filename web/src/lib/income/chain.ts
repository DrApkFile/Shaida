"use client";
// Chain reads and writes around an income link (D27): leaf block times, the verifier's dependencies, the optional
// IncomeVerifier.check (view, explicit gas: snarkjs verifiers return false when short of gas) and attest.
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, encodeFunctionData, parseAbi, type Hex, type PublicClient } from "viem";
import type { CheckedTrees } from "@shaida/index";
import { timedLeaves } from "@shaida/pay";
import { datesForRange, INCOME_FINAL_VKEY, solidityArgsOf, type Groth16Proof, type ShaidaError, shaidaError, type TimedLeaf, type VerifyDeps } from "@shaida/proofs";
import type { Wiring } from "../flows";

export const CHECK_GAS = 400_000n; // D14: Groth16 ~258k + root lookup; MIN_VERIFY_GAS is 320k
export const ATTEST_GAS = 420_000n;

const verifierAbi = parseAbi([
  "struct Proof { uint256[2] a; uint256[2][2] b; uint256[2] c; }",
  "function check(Proof proof, uint256[7] signals) view returns (bool)",
  "function attest(Proof proof, uint256[7] signals) returns (bool)",
  "error AssetMismatch(uint256 asset)",
  "error UnknownRoot(bytes32 root)",
  "error ProofInvalid()",
  "error InsufficientGas(uint256 available, uint256 required)",
]);
const ledgerAbi = parseAbi(["function isKnownRoot(bytes32 root) view returns (bool)"]);
const hex32 = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;

export const blockTimeOf = (client: PublicClient) => async (block: bigint) => (await client.getBlock({ blockNumber: block })).timestamp;

/** Every ledger leaf of the checked snapshot with its block time. */
export const leafTimes = (w: Wiring, t: CheckedTrees): Promise<TimedLeaf[]> => timedLeaves(t, blockTimeOf(w.client));

interface Snarkjs { groth16: { verify(vkey: Readonly<Record<string, unknown>>, s: readonly string[], p: Groth16Proof): Promise<boolean> } }

/** verifyIncomeLink's dependencies for this reader: roots read at the snapshot's block, dates from its leaves. */
export function verifyDepsFor(w: Wiring, t: CheckedTrees, leaves: readonly TimedLeaf[], readerIdHash: bigint, now: () => bigint): VerifyDeps {
  return {
    readerIdHash,
    now,
    isKnownRoot: (root) => w.client.readContract({ address: w.contracts.ledger, abi: ledgerAbi, functionName: "isKnownRoot", args: [hex32(root)], blockNumber: t.block }),
    verifyGroth16: async (signals, proof) => ((await import("snarkjs")) as unknown as Snarkjs).groth16.verify(INCOME_FINAL_VKEY, signals, proof),
    resolveRange: async (from, to) => datesForRange(leaves, from, to),
  };
}

const callData = (fn: "check" | "attest", proof: Groth16Proof, publicSignals: readonly string[]) => {
  const a = solidityArgsOf(proof, publicSignals);
  return encodeFunctionData({ abi: verifierAbi, functionName: fn, args: [{ a: [...a.proof.a], b: [[...a.proof.b[0]], [...a.proof.b[1]]], c: [...a.proof.c] }, a.signals as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint]] });
};

function revertOf(e: unknown): ShaidaError {
  const data = e instanceof BaseError ? (e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null)?.raw : undefined;
  const raw = data ?? (/(0x[0-9a-f]{8,})/i.exec(e instanceof Error ? e.message : "")?.[1] as Hex | undefined);
  if (raw) {
    try {
      const name = decodeErrorResult({ abi: verifierAbi, data: raw }).errorName;
      if (name === "UnknownRoot") return shaidaError("UnknownRoot", "IncomeVerifier does not know this ledger root. Nothing was recorded.");
      if (name === "AssetMismatch") return shaidaError("AssetMismatch", "IncomeVerifier refused: the proof is not about tUSD8. Nothing was recorded.");
      if (name === "ProofInvalid") return shaidaError("ProofInvalid", "IncomeVerifier refused the proof. Nothing was recorded.");
      return shaidaError("TxRejected", `IncomeVerifier refused with ${name}. Nothing was recorded.`);
    } catch (decodeFailure) {
      return shaidaError("TxRejected", `IncomeVerifier reverted with data it does not declare (${raw.slice(0, 10)}…; ${decodeFailure instanceof Error ? decodeFailure.message.split("\n")[0] : "undecodable"}). Nothing was recorded.`);
    }
  }
  return shaidaError("TxRejected", `The call failed: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}. Nothing was recorded.`);
}

/** IncomeVerifier.check for one proof, as a call with explicit gas. */
export async function checkOnChain(w: Wiring, proof: Groth16Proof, publicSignals: readonly string[]): Promise<{ ok: true; block: bigint } | { ok: false; error: ShaidaError }> {
  try {
    const block = await w.client.getBlockNumber();
    const r = await w.client.call({ to: w.contracts.incomeVerifier, data: callData("check", proof, publicSignals), gas: CHECK_GAS, blockNumber: block });
    if (r.data !== hex32(1n)) return { ok: false, error: shaidaError("ProofInvalid", `IncomeVerifier.check returned ${r.data ?? "nothing"}, not true. Nothing was recorded.`) };
    return { ok: true, block };
  } catch (e) {
    return { ok: false, error: revertOf(e) };
  }
}

export type AttestOutcome =
  | { readonly state: "mined"; readonly hash: Hex; readonly block: bigint }
  | { readonly state: "unknown"; readonly hash: Hex; readonly error: ShaidaError }
  | { readonly state: "failed"; readonly hash: Hex | null; readonly error: ShaidaError };

/**
 * attest for one proof. `send` submits a legacy tx {to, data, gas} and returns its hash. Refused before sending if
 * check fails. A tx with no receipt in 90 s is TxOutcomeUnknown: checked by its hash, never sent again.
 */
export async function attestOnChain(w: Wiring, proof: Groth16Proof, publicSignals: readonly string[], send: (tx: { to: Hex; data: Hex; gas: bigint }) => Promise<Hex>): Promise<AttestOutcome> {
  const pre = await checkOnChain(w, proof, publicSignals);
  if (!pre.ok) return { state: "failed", hash: null, error: pre.error };
  let hash: Hex;
  try {
    hash = await send({ to: w.contracts.incomeVerifier, data: callData("attest", proof, publicSignals), gas: ATTEST_GAS });
  } catch (e) {
    const m = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
    const code = /user rejected|denied|cancel/i.test(m) ? "SignatureInvalid" : "TxRejected";
    return { state: "failed", hash: null, error: shaidaError(code, `The record was not sent: ${m}. Nothing was recorded.`) };
  }
  return settleAttest(w, hash);
}

/** Reads the outcome of a sent attest by its hash (also the "check again" of an unknown one). */
export async function settleAttest(w: Wiring, hash: Hex): Promise<AttestOutcome> {
  try {
    const r = await w.client.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 1_500 });
    if (r.status !== "success") return { state: "failed", hash, error: shaidaError("TxRejected", `The record ${hash.slice(0, 10)}… reverted in block ${r.blockNumber}. Nothing was recorded.`) };
    return { state: "mined", hash, block: r.blockNumber };
  } catch (e) {
    return { state: "unknown", hash, error: shaidaError("TxOutcomeUnknown", `Sent as ${hash.slice(0, 10)}…, no receipt yet (${(e instanceof Error ? e.message : String(e)).split("\n")[0]}). It is checked by its hash and never sent again.`) };
  }
}
