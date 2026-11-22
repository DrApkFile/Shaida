#!/usr/bin/env node
// Gate step 3: the compiled circuit and the ceremony's outputs are the files the ceremony is bound to.
// - packages/shaida-proofs/build/income.r1cs must hash to ceremony/record.json circuit.r1csSha256
//   (a circuit change invalidates the ceremony: CLAUDE.md invariant).
// - once the ceremony is finalized: the exported vkey and Solidity verifier must hash as recorded, and every
//   deploy script must import that same file (contracts/src/generated/IncomeGroth16Verifier.sol).
// - the final zkey, when present locally (gitignored; a release asset), must hash as recorded.
// Gloam's circuits are checked by tools/copy-gloam-artifacts.mjs (also a gate step).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const record = JSON.parse(readFileSync(join(repo, "ceremony/record.json"), "utf8"));
let failures = 0;
const ok = (m) => console.log(`✓ ${m}`);
const bad = (m) => { console.error(`✗ ${m}`); failures++; };

function check(label, path, expected) {
  const abs = join(repo, path);
  if (!existsSync(abs)) return bad(`${label}: ${path} is missing`);
  const got = sha(abs);
  got === expected ? ok(`${label}: ${path} ${got.slice(0, 16)}…`) : bad(`${label}: ${path} sha256 ${got}, recorded ${expected}`);
}

check("circuit r1cs (ceremony-bound)", record.circuit.r1cs, record.circuit.r1csSha256);
// The browser proves with this wasm (D27): it must be the compile of that r1cs, as pinned.
const incomePins = JSON.parse(readFileSync(join(repo, "packages/shaida-pay/income-artifacts.json"), "utf8"));
check("income wasm (browser prover, D27)", incomePins.wasm.source, incomePins.wasm.sha256);

if (record.final === null) {
  console.log("· ceremony not finalized: no final vkey or verifier to check yet");
} else {
  check("final vkey", record.final.vkey.path, record.final.vkey.sha256);
  if (incomePins.zkey.sha256 !== record.final.zkey.sha256 || incomePins.vkey.sha256 !== record.final.vkey.sha256) bad("packages/shaida-pay/income-artifacts.json pins differ from ceremony/record.json final");
  else ok("browser pins (income-artifacts.json) = ceremony final zkey and vkey");
  check("final verifier (ceremony output)", record.final.verifier.path, record.final.verifier.sha256);
  // The deploy script must deploy exactly that file (finalize writes it to contracts/src/generated/).
  const deployScript = readFileSync(join(repo, "contracts/script/DeployStack.s.sol"), "utf8");
  const importPath = record.final.verifier.path.replace(/^contracts\//, "../");
  if (deployScript.includes(`"${importPath}"`)) ok(`deploy script imports the ceremony verifier (${importPath})`);
  else bad(`contracts/script/DeployStack.s.sol does not import ${importPath}: deploys must use the ceremony's verifier`);
  const zkey = join(repo, record.final.zkey.path);
  if (existsSync(zkey)) check("final zkey", record.final.zkey.path, record.final.zkey.sha256);
  else console.log(`· final zkey not present locally (${record.final.zkey.path}; release asset ceremony-v1): hash not checked here`);
}

if (failures) {
  console.error(`artifact check: ${failures} failure(s)`);
  process.exit(1);
}
