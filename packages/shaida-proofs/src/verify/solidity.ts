// Arguments of IncomeVerifier.check / attest (contracts/src/IncomeVerifier.sol) from a snarkjs proof: the G2 point's
// coordinates are swapped (snarkjs exportSolidityCallData order), signals as uint256 in PUBLIC_SIGNAL_ORDER.
import { PUBLIC_SIGNAL_ORDER } from "../circuit-input";
import type { Groth16Proof } from "./link";

export interface SolidityProof {
  readonly a: readonly [bigint, bigint];
  readonly b: readonly [readonly [bigint, bigint], readonly [bigint, bigint]];
  readonly c: readonly [bigint, bigint];
}

export function solidityArgsOf(proof: Groth16Proof, publicSignals: readonly string[]): { proof: SolidityProof; signals: bigint[] } {
  if (publicSignals.length !== PUBLIC_SIGNAL_ORDER.length) throw new RangeError(`expected ${PUBLIC_SIGNAL_ORDER.length} public signals`);
  const n = BigInt;
  return {
    proof: {
      a: [n(proof.pi_a[0]), n(proof.pi_a[1])],
      b: [[n(proof.pi_b[0][1]), n(proof.pi_b[0][0])], [n(proof.pi_b[1][1]), n(proof.pi_b[1][0])]],
      c: [n(proof.pi_c[0]), n(proof.pi_c[1])],
    },
    signals: publicSignals.map(n),
  };
}
