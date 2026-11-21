// Writes contracts/script/fixtures/income-final-proof.json: one honest income proof made with the ceremony's FINAL
// key (ceremony/record.json `final`), checked here with the exported vkey before it is written. DeployStack uses it
// to refuse a deploy whose IncomeGroth16Verifier does not accept a final-key proof, and the throwaway-key fixture to
// refuse one that accepts a throwaway proof (the same check Gloam's verifiers get, D2).
//   pnpm --filter @shaida/proofs fixtures:final   (after `make ceremony-finalize` and `make build`)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as snarkjs from "snarkjs";
import { PUBLIC_SIGNAL_ORDER, SHARE_STEP } from "../src/index";
import { BUILD, PKG } from "../test/helpers/circuit";
import { buildSingleProof, honestRequest, makeScenario, Rng } from "../test/helpers/scenario";

const REPO = resolve(PKG, "../..");
const OUT = join(REPO, "contracts/script/fixtures");

type FileRef = { path: string; sha256: string };
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

function pinned(ref: FileRef, what: string): string {
  const p = join(REPO, ref.path);
  if (!existsSync(p)) throw new Error(`${what} ${ref.path} not found (the final zkey is a release asset: ceremony-v1)`);
  if (sha(p) !== ref.sha256) throw new Error(`${what} ${ref.path} does not hash to the recorded ${ref.sha256}`);
  return p;
}

async function run(): Promise<void> {
  const record = JSON.parse(readFileSync(join(REPO, "ceremony/record.json"), "utf8")) as { final: { zkey: FileRef; vkey: FileRef } | null };
  if (!record.final) throw new Error("the ceremony is not finalized: run make ceremony-finalize first");
  const zkey = pinned(record.final.zkey, "final zkey");
  const vkey = JSON.parse(readFileSync(pinned(record.final.vkey, "final vkey"), "utf8")) as snarkjs.VerificationKey;

  const rng = new Rng(4242);
  const s = makeScenario(rng, { payments: 3, amounts: [4_000_000n, 2_500_000n, 1_000_000n], noise: 2 });
  const r = buildSingleProof(honestRequest(s, rng, { threshold: 7n * SHARE_STEP, context: 77n }));
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(r.value.input, join(BUILD, "income_js/income.wasm"), zkey);
  if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) throw new Error("the final vkey refused a final-key proof");

  const [a, b, c, signals] = JSON.parse(`[${await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)}]`) as [string[], string[][], string[], string[]];
  mkdirSync(OUT, { recursive: true });
  const fixture = {
    note: "Honest income proof made with the ceremony's FINAL key, for DeployStack's deploy-time verifier check. Its ledger root is a test scenario's, not a real ledger's.",
    zkeySha256: record.final.zkey.sha256,
    signalOrder: PUBLIC_SIGNAL_ORDER,
    a, b, c, signals,
  };
  writeFileSync(join(OUT, "income-final-proof.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`✓ contracts/script/fixtures/income-final-proof.json (final zkey ${record.final.zkey.sha256.slice(0, 16)}…)`);
}

run().then(() => process.exit(0), (e: unknown) => {
  console.error(`✗ final fixture: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
