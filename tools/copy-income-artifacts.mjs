#!/usr/bin/env node
// Copies the income circuit's FINAL artifacts into web/public/circuits/income/ for in-browser proving (D27):
// - income.wasm from packages/shaida-proofs/build (run `make build` first), refused unless its sha256 is pinned and the
//   r1cs next to it is the one the ceremony is bound to (ceremony/record.json);
// - income_final.zkey from the local copy of the ceremony-v1 release (tools/fetch-income-key.mjs downloads it if
//   missing), refused unless its sha256 equals ceremony/record.json final.zkey.
// Only final files are ever written there; the browser checks the same pins again before proving.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { releaseDir } from "./fetch-income-key.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const pins = JSON.parse(readFileSync(join(repo, "packages/shaida-pay/income-artifacts.json"), "utf8"));
const record = JSON.parse(readFileSync(join(repo, "ceremony/record.json"), "utf8"));
const out = join(repo, "web/public/circuits/income");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const fail = (m) => { console.error(`✗ copy-income-artifacts: ${m}`); process.exit(1); };

if (record.final === null) fail("the ceremony has no final key (ceremony/record.json)");
if (pins.zkey.sha256 !== record.final.zkey.sha256) fail("income-artifacts.json zkey pin differs from ceremony/record.json");
if (pins.vkey.sha256 !== record.final.vkey.sha256) fail("income-artifacts.json vkey pin differs from ceremony/record.json");

const r1cs = join(repo, record.circuit.r1cs);
const wasm = join(repo, pins.wasm.source);
if (!existsSync(r1cs) || !existsSync(wasm)) fail(`${pins.wasm.source} is missing: run make build (circuit compile) first`);
if (sha(r1cs) !== record.circuit.r1csSha256) fail(`${record.circuit.r1cs} is not the ceremony-bound r1cs`);
if (sha(wasm) !== pins.wasm.sha256) fail(`${pins.wasm.source}: sha256 ${sha(wasm)}, pinned ${pins.wasm.sha256}`);

const zkey = join(releaseDir(), "income_final.zkey");
if (!existsSync(zkey)) execFileSync(process.execPath, [join(repo, "tools/fetch-income-key.mjs")], { stdio: "inherit" });
if (sha(zkey) !== pins.zkey.sha256) fail(`${zkey}: sha256 ${sha(zkey)}, pinned ${pins.zkey.sha256} (not the ceremony's final key)`);

mkdirSync(out, { recursive: true });
copyFileSync(wasm, join(out, pins.wasm.file));
copyFileSync(zkey, join(out, pins.zkey.file));
console.log(`✓ web/public/circuits/income/${pins.wasm.file} (${pins.wasm.sha256.slice(0, 12)}…), ${pins.zkey.file} (${pins.zkey.sha256.slice(0, 12)}…, release ceremony-v1)`);
