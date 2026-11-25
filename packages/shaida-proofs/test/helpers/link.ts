// Links for verification tests. CI has no ptau, so these tests replace Groth16 with a stand-in that accepts a
// "proof" only for public signals whose circuit input the real income.wasm accepted (a proof exists only for a
// satisfied witness). Real Groth16 bundles are in income.groth16.test.ts (local, PTAU_PATH).
import {
  contextOf,
  encodeIncomeLink,
  type Groth16Proof,
  type IncomeLink,
  type IncomeProofWitness,
  PUBLIC_SIGNAL_ORDER,
  type RevocationState,
  type VerifyDeps,
} from "../../src/index";
import { runCircuit } from "./circuit";

export interface Opening {
  readonly readerIdHash: bigint;
  readonly expiry: bigint;
  readonly salt: bigint;
}
export const contextFor = (o: Opening): bigint => contextOf(o.readerIdHash, o.expiry, o.salt);

export type LinkProof = IncomeLink["proofs"][number];

export class WitnessBackedProver {
  private readonly accepted = new Map<string, string>();
  private next = 1;

  /** Runs the circuit on the proof's input; returns a stand-in proof only if the circuit accepted it. */
  async prove(w: IncomeProofWitness): Promise<LinkProof> {
    if (!(await runCircuit(w.input)).accepted) throw new Error("the circuit refused this witness: no proof");
    const publicSignals = PUBLIC_SIGNAL_ORDER.map((k) => w.publicSignals[k].toString());
    const id = String(this.next++);
    this.accepted.set(id, JSON.stringify(publicSignals));
    const proof: Groth16Proof = {
      pi_a: [id, "1", "1"],
      pi_b: [["1", "0"], ["0", "1"], ["1", "0"]],
      pi_c: ["1", "2", "1"],
      protocol: "groth16",
      curve: "bn128",
    };
    return { proof, publicSignals };
  }

  /** True only for the exact public signals a stand-in proof was made for. */
  readonly verify: VerifyDeps["verifyGroth16"] = async (signals, proof) =>
    this.accepted.get(proof.pi_a[0]) === JSON.stringify(signals);
}

export function fragment(proofs: readonly LinkProof[], o: Opening): string {
  return encodeIncomeLink({
    v: 1,
    proofs: [...proofs],
    readerIdHash: o.readerIdHash.toString(),
    expiry: o.expiry.toString(),
    salt: o.salt.toString(),
  });
}

/** A v2 link (D35, D36): same proofs and opening, plus its reader mode. */
export function fragmentV2(proofs: readonly LinkProof[], o: Opening, reader: "name" | "code"): string {
  return encodeIncomeLink({
    v: 2,
    proofs: [...proofs],
    readerIdHash: o.readerIdHash.toString(),
    expiry: o.expiry.toString(),
    salt: o.salt.toString(),
    reader,
  });
}

/** A revocation registry for tests: revoked salts with their block, or a registry that cannot be read. */
export type Registry = ReadonlyMap<bigint, bigint> | "unreadable";
export const registryRead = (r: Registry) => async (salt: bigint): Promise<RevocationState> => {
  if (r === "unreadable") return { state: "unreadable", code: "ChainUnreachable", message: "RPC timeout (test)" };
  const block = r.get(salt);
  return block === undefined ? { state: "none" } : { state: "revoked", block, time: 1_750_000_000n + block };
};

/** Deps for a reader `readerIdHash` at time `now`, with these known roots; leaf i is dated 1_700_000_000 + 10·i. */
export function depsFor(
  verify: VerifyDeps["verifyGroth16"],
  readerIdHash: bigint,
  knownRoots: readonly bigint[],
  now = 1_800_000_000n,
  extra: { readonly readerCode?: bigint | null; readonly registry?: Registry } = {},
): VerifyDeps {
  return {
    readerIdHash,
    readerCode: extra.readerCode ?? null,
    revocation: registryRead(extra.registry ?? new Map()),
    now: () => now,
    isKnownRoot: async (root) => knownRoots.includes(root),
    verifyGroth16: verify,
    resolveRange: async (from, to) => ({ fromDate: 1_700_000_000n + 10n * from, toDate: 1_700_000_000n + 10n * to }),
  };
}
