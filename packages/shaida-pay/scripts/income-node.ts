// Node-side income proving for scripts (D27): only the FINAL key, the release copy of income_final.zkey and the
// pinned wasm, each checked by sha256 against income-artifacts.json before use.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as snarkjs from "snarkjs";
import { INCOME_FINAL_VKEY, type CircuitInput, type Groth16Proof } from "@shaida/proofs";
import { INCOME_ARTIFACTS } from "../src/index";
import { REPO } from "./node-env";

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

function pinnedPaths(): { wasm: string; zkey: string } {
  const wasm = join(REPO, INCOME_ARTIFACTS.wasm.source);
  const zkey = join(process.env.SHAIDA_RELEASE_DIR?.trim() || join(homedir(), ".cache/shaida-release"), INCOME_ARTIFACTS.zkey.file);
  if (!existsSync(zkey)) throw new Error(`${zkey} missing: run node tools/fetch-income-key.mjs`);
  for (const [p, want] of [[wasm, INCOME_ARTIFACTS.wasm.sha256], [zkey, INCOME_ARTIFACTS.zkey.sha256]] as const) {
    const got = sha(p);
    if (got !== want) throw new Error(`${p}: sha256 ${got}, pinned ${want} (not the final key's file)`);
  }
  return { wasm, zkey };
}

export async function proveIncome(input: CircuitInput): Promise<{ proof: Groth16Proof; publicSignals: string[]; proveMs: number }> {
  const { wasm, zkey } = pinnedPaths();
  const t0 = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  return { proof: { pi_a: proof.pi_a, pi_b: proof.pi_b, pi_c: proof.pi_c, protocol: proof.protocol, curve: proof.curve }, publicSignals, proveMs: Math.round(performance.now() - t0) };
}

export const verifyIncomeGroth16 = (signals: readonly string[], proof: Groth16Proof): Promise<boolean> =>
  snarkjs.groth16.verify(INCOME_FINAL_VKEY, [...signals], proof);
