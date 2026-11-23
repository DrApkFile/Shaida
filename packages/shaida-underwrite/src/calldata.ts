// IncomeVerifier.check / attest calldata for one proof (contracts/src/IncomeVerifier.sol). The recorder signs only
// `attest` to IncomeVerifier: there is no other call it can build.
import { encodeFunctionData, parseAbi, sha256, stringToBytes, type Hex } from "viem";
import { solidityArgsOf, type Groth16Proof } from "@shaida/proofs";

export const verifierAbi = parseAbi([
  "struct Proof { uint256[2] a; uint256[2][2] b; uint256[2] c; }",
  "function check(Proof proof, uint256[7] signals) view returns (bool)",
  "function attest(Proof proof, uint256[7] signals) returns (bool)",
  "error AssetMismatch(uint256 asset)",
  "error UnknownRoot(bytes32 root)",
  "error ProofInvalid()",
  "error InsufficientGas(uint256 available, uint256 required)",
]);

/** D14: callers set gas explicitly (snarkjs verifiers return false when short of gas). */
export const CHECK_GAS = 400_000n;
export const ATTEST_GAS = 420_000n;
/** cast sig "attest((uint256[2],uint256[2][2],uint256[2]),uint256[7])" */
export const ATTEST_SELECTOR = "0x7f383798" as const satisfies Hex;

type Signals7 = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint];

export function verifierCallData(fn: "check" | "attest", proof: Groth16Proof, publicSignals: readonly string[]): Hex {
  const a = solidityArgsOf(proof, publicSignals);
  return encodeFunctionData({
    abi: verifierAbi,
    functionName: fn,
    args: [{ a: [...a.proof.a], b: [[...a.proof.b[0]], [...a.proof.b[1]]], c: [...a.proof.c] }, a.signals as unknown as Signals7],
  });
}

/** One proof of a link, as the dedupe key: the same Groth16 proof and signals are the same record wherever they come from. */
export const proofKeyOf = (proof: Groth16Proof, publicSignals: readonly string[]): string =>
  sha256(stringToBytes(JSON.stringify([proof.pi_a, proof.pi_b, proof.pi_c, publicSignals]))).slice(2);
