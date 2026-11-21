// Writes contracts/test/fixtures/income/: two THROWAWAY Groth16 keys for income.circom (one setup, two independent
// random contributions, so two different verifiers for the same circuit), their snarkjs Solidity verifiers, and one
// honest proof made with key A. IncomeVerifier.t.sol checks that A's verifier accepts it and B's refuses it.
// Throwaway keys could be forged by whoever made them: test fixtures only, never deployed. Needs PTAU_PATH.
//   PTAU_PATH=… pnpm --filter @shaida/proofs fixtures:verifier
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as snarkjs from "snarkjs";
import { PUBLIC_SIGNAL_ORDER, SHARE_STEP } from "../src/index";
import { BUILD, PKG } from "../test/helpers/circuit";
import { buildSingleProof, honestRequest, makeScenario, Rng } from "../test/helpers/scenario";
import { ensureThrowawayKey, INCOME_MAIN } from "./throwaway";

const OUT = resolve(PKG, "../../contracts/test/fixtures/income");

async function run(): Promise<void> {
  const ptau = process.env.PTAU_PATH;
  if (!ptau) throw new Error("set PTAU_PATH=/path/to/powersOfTau28_hez_final_17.ptau");
  const keyA = await ensureThrowawayKey(ptau, INCOME_MAIN);
  const keyB = await ensureThrowawayKey(ptau, { ...INCOME_MAIN, dir: join(BUILD, "throwaway-b") });
  mkdirSync(OUT, { recursive: true });
  for (const [key, name] of [[keyA, "ThrowawayIncomeVerifierA"], [keyB, "ThrowawayIncomeVerifierB"]] as const) {
    const src = readFileSync(key.verifierSol, "utf8");
    if (!src.includes("contract Groth16Verifier")) throw new Error("unexpected snarkjs verifier template");
    const note =
      "// THROWAWAY test fixture: snarkjs verifier for a local single-party income.circom key, written by\n" +
      "// packages/shaida-proofs/scripts/gen-verifier-fixtures.ts. Forgeable by whoever made the key. Never deploy.\n";
    writeFileSync(join(OUT, `${name}.sol`), src.replace("contract Groth16Verifier", `contract ${name}`).replace(/(pragma solidity[^\n]*\n)/, `$1\n${note}`));
  }

  const rng = new Rng(4242);
  const s = makeScenario(rng, { payments: 3, amounts: [4_000_000n, 2_500_000n, 1_000_000n], noise: 2 });
  const r = buildSingleProof(honestRequest(s, rng, { threshold: 7n * SHARE_STEP, context: 77n }));
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(r.value.input, join(BUILD, "income_js/income.wasm"), keyA.zkey);
  const vkeyA = JSON.parse(readFileSync(keyA.vkey, "utf8")) as snarkjs.VerificationKey;
  const vkeyB = JSON.parse(readFileSync(keyB.vkey, "utf8")) as snarkjs.VerificationKey;
  if (!(await snarkjs.groth16.verify(vkeyA, publicSignals, proof))) throw new Error("key A refused its own proof");
  if (await snarkjs.groth16.verify(vkeyB, publicSignals, proof)) throw new Error("key B accepted key A's proof");

  // exportSolidityCallData gives the calldata order (pi_b coordinates swapped) as a JSON-ish array literal
  const [a, b, c, signals] = JSON.parse(`[${await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)}]`) as [string[], string[][], string[], string[]];
  const fixture = {
    note: "THROWAWAY key A proof for IncomeVerifier.t.sol. Never a real proof.",
    signalOrder: PUBLIC_SIGNAL_ORDER,
    a, b, c, signals,
  };
  writeFileSync(join(OUT, "throwaway-proof.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`✓ ${OUT}: ThrowawayIncomeVerifierA.sol, ThrowawayIncomeVerifierB.sol, throwaway-proof.json`);
}

run().then(() => process.exit(0), (e: unknown) => {
  console.error(`✗ fixtures: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
