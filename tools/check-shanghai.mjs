#!/usr/bin/env node
// Fails if any deployable contract uses an opcode Aevum (Shanghai EVM) doesn't have.
// Checks our contracts (contracts/src) and everything we deploy from Gloam
// (contracts/lib/gloam/contracts/src, generated verifiers included).
// Source: adapted from qday-io/aevum-starter-kit tools/check-shanghai.mjs (MIT, (c) 2026 PQA Labs).
// Usage: node tools/check-shanghai.mjs [contracts/out]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CANCUN_ONLY = { 0x49: "BLOBHASH", 0x4a: "BLOBBASEFEE", 0x5c: "TLOAD", 0x5d: "TSTORE", 0x5e: "MCOPY" };
const outDir = process.argv[2] ?? "contracts/out";
// Not script/: scripts never go on-chain, and their embedded creation code reads as false opcodes.
const CHECKED_SOURCES = ["src/", "lib/gloam/contracts/src/"];

function* artifacts(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* artifacts(p);
    else if (name.endsWith(".json")) yield p;
  }
}

// Walk real instructions, skipping PUSH data and the trailing CBOR metadata.
function findBad(hex, { hasMetadata } = { hasMetadata: true }) {
  const code = Buffer.from(hex.replace(/^0x/, ""), "hex");
  if (code.length === 0) return [];
  const metaLen = hasMetadata && code.length >= 2 ? code.readUInt16BE(code.length - 2) + 2 : 0;
  const end = metaLen < code.length ? code.length - metaLen : code.length;
  const bad = [];
  for (let i = 0; i < end; i++) {
    const op = code[i];
    if (CANCUN_ONLY[op]) bad.push(`${CANCUN_ONLY[op]} at byte ${i}`);
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
  }
  return bad;
}

let checked = 0;
let failed = 0;
let gloamChecked = 0;
for (const file of artifacts(outDir)) {
  const a = JSON.parse(readFileSync(file, "utf8"));
  const source = Object.keys(a.metadata?.settings?.compilationTarget ?? {})[0] ?? "";
  if (!CHECKED_SOURCES.some((prefix) => source.startsWith(prefix))) continue; // not forge-std/test helpers
  for (const [kind, hex] of [["runtime", a.deployedBytecode?.object], ["creation", a.bytecode?.object]]) {
    if (!hex || hex === "0x") continue;
    checked++;
    if (source.startsWith("lib/gloam/")) gloamChecked++;
    const bad = findBad(hex);
    if (bad.length) {
      failed++;
      console.error(`✗ ${source} (${kind}): ${bad.join(", ")}`);
    }
  }
}
// Raw bytecode we deploy that has no Foundry artifact: circomlibjs PoseidonT3 (Gloam fixture).
const RAW_BLOBS = ["contracts/lib/gloam/contracts/test/fixtures/Poseidon2.json"];
for (const file of RAW_BLOBS) {
  const hex = JSON.parse(readFileSync(file, "utf8")).bytecode;
  if (!hex) {
    console.error(`✗ ${file}: no bytecode field`);
    process.exit(1);
  }
  checked++;
  gloamChecked++;
  // Creation code from circomlibjs carries no CBOR metadata; scan every byte as code.
  const bad = findBad(hex, { hasMetadata: false });
  if (bad.length) {
    failed++;
    console.error(`✗ ${file} (creation): ${bad.join(", ")}`);
  }
}

if (checked === 0) {
  console.error(`No artifacts from ${CHECKED_SOURCES.join(", ")} found in ${outDir}. Run \`forge build\` first.`);
  process.exit(1);
}
if (gloamChecked === 0) {
  console.error(`No Gloam artifacts found in ${outDir}. The deploy script must compile them; run \`forge build\`.`);
  process.exit(1);
}
if (failed) {
  console.error("\nThese opcodes don't exist on Aevum. Set evm_version = \"shanghai\" in foundry.toml.");
  process.exit(1);
}
console.log(`✓ ${checked} bytecode blobs checked (${gloamChecked} from Gloam): Shanghai-safe.`);
