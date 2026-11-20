// Spike S8: assembles tools/s8-bench/www/, a static page that proves the income circuit in the browser, for the
// 8-slot circuit and a 4-slot variant. Keys are THROWAWAY (one local contribution, scripts/throwaway.ts): never
// committed or published; this script makes them on your machine from your Hermez 2^17 ptau.
// Usage: PTAU_PATH=/path/to/powersOfTau28_hez_final_17.ptau pnpm --filter @shaida/s8-bench build
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { ensureThrowawayKey, INCOME_8 } from "../../packages/shaida-proofs/scripts/throwaway.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const PROOFS = join(REPO, "packages/shaida-proofs");
const BUILD = join(HERE, "build");
const WWW = join(HERE, "www");

const fail = (msg: string): never => {
  console.error(`✗ s8-bench build: ${msg}`);
  process.exit(1);
};
const ptau = process.env.PTAU_PATH ?? fail("set PTAU_PATH to the Hermez powersOfTau28_hez_final_17.ptau");
const ptauPath = resolve(ptau);

function constraints(out: string): number {
  return Number(out.match(/^non-linear constraints: (\d+)$/m)?.[1] ?? fail("no constraint count in circom output"));
}

// 1. 8 slots: the package's own compile (circom 2.2.3, --O2)
const c8 = spawnSync(process.execPath, ["scripts/compile.mjs"], { cwd: PROOFS, encoding: "utf8" });
if (c8.status !== 0) fail(`8-slot compile:\n${c8.stdout}${c8.stderr}`);

// 2. 4 slots: same template, same compiler and flags
const cargoCircom = join(homedir(), ".cargo/bin/circom");
const circom = process.env.CIRCOM ?? (existsSync(cargoCircom) ? cargoCircom : "circom");
const version = execFileSync(circom, ["--version"], { encoding: "utf8" }).trim();
if (!version.endsWith("2.2.3")) fail(`need circom 2.2.3, found "${version}"`);
mkdirSync(join(BUILD, "c4"), { recursive: true });
const c4 = spawnSync(
  circom,
  ["circuits/income4.circom", "--r1cs", "--wasm", "--O2", "-o", "build/c4", "-l", join(PROOFS, "node_modules")],
  { cwd: HERE, encoding: "utf8" },
);
if (c4.status !== 0) fail(`4-slot compile:\n${c4.stdout}${c4.stderr}`);

// 3. THROWAWAY keys (reused when the r1cs is unchanged)
const key8 = await ensureThrowawayKey(ptauPath, INCOME_8);
const key4 = await ensureThrowawayKey(ptauPath, { r1cs: join(BUILD, "c4/income4.r1cs"), dir: join(BUILD, "keys4"), name: "income4" });

// 4. assemble www/
rmSync(WWW, { recursive: true, force: true });
mkdirSync(join(WWW, "circuits"), { recursive: true });
const sha256 = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const variants = {
  income8: {
    slots: 8,
    constraints: constraints(c8.stdout),
    wasm: join(PROOFS, "build/income_js/income.wasm"),
    r1cs: join(PROOFS, "build/income.r1cs"),
    key: key8,
  },
  income4: {
    slots: 4,
    constraints: constraints(c4.stdout),
    wasm: join(BUILD, "c4/income4_js/income4.wasm"),
    r1cs: join(BUILD, "c4/income4.r1cs"),
    key: key4,
  },
};
const manifest: Record<string, unknown> = {
  key: "THROWAWAY (one local contribution; never deploy, never publish)",
  compiler: `${version}, --O2`,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(),
  dirty: execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" }).trim() !== "",
  builtAt: new Date().toISOString(),
  variants: {},
};
for (const [name, v] of Object.entries(variants)) {
  copyFileSync(v.wasm, join(WWW, `circuits/${name}.wasm`));
  copyFileSync(v.key.zkey, join(WWW, `circuits/${name}.zkey`));
  copyFileSync(v.key.vkey, join(WWW, `circuits/${name}_vkey.json`));
  (manifest.variants as Record<string, unknown>)[name] = {
    slots: v.slots,
    constraints: v.constraints,
    r1csSha256: sha256(v.r1cs),
    wasmSha256: sha256(v.wasm),
    zkeySha256: sha256(v.key.zkey),
    zkeyBytes: statSync(v.key.zkey).size,
  };
}
writeFileSync(join(WWW, "manifest.json"), JSON.stringify(manifest, null, 2));
copyFileSync(join(PROOFS, "node_modules/snarkjs/build/snarkjs.min.js"), join(WWW, "snarkjs.min.js"));
copyFileSync(join(HERE, "static/index.html"), join(WWW, "index.html"));
await build({
  entryPoints: { page: join(HERE, "src/page.ts"), worker: join(HERE, "src/worker.ts") },
  outdir: WWW,
  bundle: true,
  format: "iife",
  target: "es2020",
  logLevel: "warning",
});

console.log(`✓ ${WWW}`);
for (const [name, v] of Object.entries(manifest.variants as Record<string, { constraints: number; zkeyBytes: number }>)) {
  console.log(`  ${name}: ${v.constraints} constraints, zkey ${(v.zkeyBytes / 2 ** 20).toFixed(1)} MiB (THROWAWAY)`);
}
console.log("Serve: python3 -m http.server 8088 --bind 0.0.0.0 --directory tools/s8-bench/www");
