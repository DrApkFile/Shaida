// Writes test/fixtures/final-key-link.json: one honest income proof made with the ceremony's FINAL key, as a proof link
// made out to the bot's reader name (config/underwrite-policies.json), checked with the final vkey before it is
// written. Test U20 runs the bot's real Node Groth16 path on it. Its ledger root is a test scenario's, not Aevum's.
//   pnpm --filter @shaida/underwrite fixture   (needs the final zkey: tools/fetch-income-key.mjs, and make build)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as snarkjs from "snarkjs";
import { contextOf, encodeIncomeLink, PUBLIC_SIGNAL_ORDER, SHARE_STEP } from "@shaida/proofs";
import { buildSingleProof, honestRequest, makeScenario, Rng } from "../../shaida-proofs/test/helpers/scenario";
import { REPO, RENT } from "../test/helpers";

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** Far in the future, so the fixture never expires under the tests' fixed clock. */
const EXPIRY = 4_102_444_800n; // 2100-01-01T00:00:00Z
const SALT = 314159n;

async function run(): Promise<void> {
  const record = JSON.parse(readFileSync(join(REPO, "ceremony/record.json"), "utf8")) as { final: { zkey: { sha256: string }; vkey: { path: string; sha256: string } } };
  const cache = process.env.SHAIDA_RELEASE_DIR ?? join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? "", ".cache"), "shaida-release");
  const zkey = [join(cache, "income_final.zkey"), join(REPO, "ceremony/work/income_final.zkey")].find((p) => existsSync(p) && sha(p) === record.final.zkey.sha256);
  if (!zkey) throw new Error(`no income_final.zkey hashing to ${record.final.zkey.sha256} (run node tools/fetch-income-key.mjs)`);
  const vkeyPath = join(REPO, record.final.vkey.path);
  if (sha(vkeyPath) !== record.final.vkey.sha256) throw new Error("the final vkey does not hash as recorded");
  const vkey = JSON.parse(readFileSync(vkeyPath, "utf8")) as Record<string, unknown>;
  const wasm = join(REPO, "packages/shaida-proofs/build/income_js/income.wasm");

  const rng = new Rng(30_30);
  const s = makeScenario(rng, { payments: 3, amounts: [2_000_000n, 1_500_000n, 500_000n], noise: 2 });
  const context = contextOf(RENT.readerIdHash, EXPIRY, SALT);
  const r = buildSingleProof(honestRequest(s, rng, { threshold: 4n * SHARE_STEP, context }));
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(r.value.input, wasm, zkey);
  if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) throw new Error("the final vkey refused a final-key proof");
  const fragment = encodeIncomeLink({
    v: 1,
    proofs: [{ proof: proof as never, publicSignals }],
    readerIdHash: RENT.readerIdHash.toString(),
    expiry: EXPIRY.toString(),
    salt: SALT.toString(),
  });
  const named = Object.fromEntries(PUBLIC_SIGNAL_ORDER.map((k, i) => [k, publicSignals[i]]));
  const out = join(REPO, "packages/shaida-underwrite/test/fixtures");
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "final-key-link.json"),
    `${JSON.stringify({ note: "Income proof made with the ceremony's FINAL key, made out to the bot's reader name. Its ledger root is a test scenario's, not Aevum's.", zkeySha256: record.final.zkey.sha256, readerName: RENT.readerName, signals: named, fragment }, null, 2)}\n`,
  );
  console.log(`✓ packages/shaida-underwrite/test/fixtures/final-key-link.json (≥ ${named.threshold} base units, ${named.count} payments, final zkey ${record.final.zkey.sha256.slice(0, 16)}…)`);
}

run().then(() => process.exit(0), (e: unknown) => {
  console.error(`✗ link fixture: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
