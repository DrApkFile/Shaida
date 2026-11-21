// One honest sample witness (2 payments, fixed values) proved with a zkey and checked with its vkey, plus the same
// proof with its threshold raised by one, which must be refused. A last end-to-end check of the final key.
import {
  buildIncomeBundle,
  contextOf,
  LedgerTree,
  noteCommitment,
  nullifierOf,
  PUBLIC_SIGNAL_ORDER,
  sweepLeaf,
  TUSD8_FIELD,
  vouchLeaf,
} from "@shaida/proofs";
import { groth16 } from "./snarkjs.js";

export async function sampleProofCheck(wasm: string, zkey: string, vkey: unknown) {
  const payments = [3_000_000n, 2_500_000n].map((amount, i) => ({
    secretP: 1000n + BigInt(i),
    amount,
    payerId: 1n,
    secretS: 2000n + BigInt(i),
    amountS: amount,
  }));
  const leaves = payments.flatMap((p) => {
    const cp = noteCommitment(p.secretP, p.amount, TUSD8_FIELD);
    return [vouchLeaf(p.payerId, cp), sweepLeaf(nullifierOf(p.secretP, cp), noteCommitment(p.secretS, p.amountS, TUSD8_FIELD))];
  });
  const tree = new LedgerTree(leaves);
  const built = buildIncomeBundle({
    ledgerLeaves: leaves,
    ledgerRoot: tree.root,
    asset: TUSD8_FIELD,
    threshold: 5_000_000n,
    fromIndex: 0n,
    toIndex: BigInt(leaves.length - 1),
    context: contextOf(1n, 1_900_000_000n, 7n),
    payments,
  });
  if (!built.ok) throw new Error(`sample witness refused: ${built.error.code}: ${built.error.message}`);
  const t0 = performance.now();
  const { proof, publicSignals } = await groth16.fullProve(built.value.proofs[0]!.input, wasm, zkey);
  const proveMs = Math.round(performance.now() - t0);
  const verified = await groth16.verify(vkey, publicSignals, proof);
  const tampered = [...publicSignals];
  const at = PUBLIC_SIGNAL_ORDER.indexOf("threshold");
  tampered[at] = (BigInt(tampered[at]!) + 1n).toString();
  const tamperedAccepted = await groth16.verify(vkey, tampered, proof);
  return { verified, tamperedRefused: !tamperedAccepted, proveMs };
}
