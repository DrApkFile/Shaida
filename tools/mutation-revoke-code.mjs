#!/usr/bin/env node
// Mutation check for D35 (revocation) and D36 (reader codes): each mutation weakens one check in the pure core; the
// tests named for it must then fail. The source file is restored after every run, pass or fail.
// Writes evidence/mutation-revoke-code.md. Usage: node tools/mutation-revoke-code.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PKG = join(ROOT, "packages/shaida-proofs");
const TESTS = ["test/verify.revoke-code.test.ts", "test/verify.revoke-code.property.test.ts"];

const MUTATIONS = [
  {
    id: "M1",
    what: "remove the revocation check (step 5a)",
    file: "src/verify/verify.ts",
    from: 'if (revocation.state === "revoked") {',
    to: "if (false) {",
    mustFail: ["RV10", "RV13", "RP01"],
  },
  {
    id: "M2",
    what: "check revocation only for links that say v2",
    file: "src/verify/verify.ts",
    from: "const revocation = await deps.revocation(BigInt(link.salt));",
    to: 'const revocation = link.v === 2 ? await deps.revocation(BigInt(link.salt)) : ({ state: "none" } as const);',
    mustFail: ["RV13", "RP01"],
  },
  {
    id: "M3",
    what: "remove the code binding (the code no longer enters the reader id)",
    file: "src/reader-code.ts",
    from: "poseidon3([READER_CODE_TAG, nameHash, poseidon1([code])])",
    to: "poseidon3([READER_CODE_TAG, nameHash, poseidon1([0n])])",
    mustFail: ["RC03", "RP01"],
  },
  {
    id: "M4",
    what: "accept a code-protected link without a code (fall back to the name)",
    file: "src/verify/verify.ts",
    from: 'if (expected === null) return fail("WrongReader", "The link is code-protected: it needs the reader\'s name and their reader code.");\n  if (readerIdHash !== expected)',
    to: "if (expected !== null && readerIdHash !== expected)",
    mustFail: ["RC02", "RC04", "RP01"],
  },
];

function runTests() {
  try {
    return { code: 0, out: execFileSync("node", ["--import", "tsx", "--test", "--test-reporter=spec", ...TESTS], { cwd: PKG, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}
const failedIds = (out) => [...new Set([...out.matchAll(/✖ ((?:RV|RC|RP)\d+)/g)].map((m) => m[1]))].sort();

const rows = [];
let ok = true;
const baseline = runTests();
rows.push(["—", "no mutation", baseline.code === 0 ? "all pass" : `**FAILED** (${failedIds(baseline.out).join(", ")})`, baseline.code === 0 ? "ok" : "**FAILED**"]);
if (baseline.code !== 0) ok = false;
for (const m of MUTATIONS) {
  const path = join(PKG, m.file);
  const original = readFileSync(path, "utf8");
  if (original.split(m.from).length !== 2) throw new Error(`${m.id}: the text to mutate is not in ${m.file} exactly once`);
  let result;
  try {
    writeFileSync(path, original.replace(m.from, m.to));
    result = runTests();
  } finally {
    writeFileSync(path, original);
  }
  const failed = failedIds(result.out);
  const missing = m.mustFail.filter((id) => !failed.includes(id));
  const caught = result.code !== 0 && missing.length === 0;
  if (!caught) ok = false;
  rows.push([m.id, m.what, `failing: ${failed.join(", ") || "none"}${missing.length ? `; expected also ${missing.join(", ")}` : ""}`, caught ? "caught" : "**NOT CAUGHT**"]);
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim() !== "";
const md = [
  "# Mutation check: revocation (D35) and reader codes (D36)",
  "",
  `Command: \`node tools/mutation-revoke-code.mjs\`. Commit ${commit}${dirty ? " (working tree had uncommitted changes)" : ""}, ${new Date().toISOString()}, Node ${process.version}, local (no chain).`,
  `Each mutation edits one line of packages/shaida-proofs and runs ${TESTS.join(" and ")}; the source is restored after each run.`,
  "",
  "| Mutation | What it removes | Tests that failed | Result |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${r.join(" | ")} |`),
  "",
  ok ? "Every mutation was caught by the tests named for it." : "**At least one mutation was not caught.**",
  "",
].join("\n");
writeFileSync(join(ROOT, "evidence/mutation-revoke-code.md"), md);
console.log(md);
process.exit(ok ? 0 : 1);
