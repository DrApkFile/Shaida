#!/usr/bin/env node
// Compiles circuits/income.circom to build/ (r1cs, wasm, sym) with circom 2.2.3 and prints the constraint counts.
// circom: $CIRCOM, else ~/.cargo/bin/circom, else `circom` on PATH. Exits 1 on any failure or version mismatch.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CIRCOM_VERSION = "2.2.3";
const cargoCircom = join(homedir(), ".cargo/bin/circom");
const circom = process.env.CIRCOM ?? (existsSync(cargoCircom) ? cargoCircom : "circom");

const version = execFileSync(circom, ["--version"], { encoding: "utf8" }).trim();
if (!version.endsWith(CIRCOM_VERSION)) {
  console.error(`✗ compile: need circom ${CIRCOM_VERSION}, found "${version}"`);
  process.exit(1);
}
mkdirSync(join(PKG, "build"), { recursive: true });
const run = spawnSync(
  circom,
  ["circuits/income.circom", "--r1cs", "--wasm", "--sym", "--O2", "-o", "build", "-l", "node_modules"],
  { cwd: PKG, encoding: "utf8" },
);
process.stdout.write(run.stdout);
process.stderr.write(run.stderr);
if (run.status !== 0) {
  console.error(`✗ compile: circom exited ${run.status}`);
  process.exit(1);
}
console.log(`✓ build/income.r1cs, build/income_js/income.wasm (${version})`);
