#!/usr/bin/env node
// Gate step 7 (BUILD_CONTRACT: README claims ⊆ PROVEN).
// - CLAIMS.md is a table: | ID | Claim | Status | Evidence |, Status PROVEN or NOT PROVEN.
// - Every PROVEN claim has evidence, and all of it resolves: `path` (file or directory exists) or `test:ID`
//   (a test title with that ID in a *.test.ts file, or a Solidity test function `test_…ID…` / named exactly ID), or
//   `absent:path` (a claim that something does not exist yet: fails once the file appears).
// - README.md: every claim it makes carries a marker `<!-- CL07 -->` (several allowed). In the intro and the Status
//   section every bullet or paragraph needs one; `<!-- not-built -->` marks a statement of what does not exist.
//   Each referenced claim must exist and be PROVEN.
// - Every `make <target>` in README's code blocks is a real Makefile target.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(repo, p), "utf8");
let failures = 0;
const bad = (m) => { console.error(`✗ ${m}`); failures++; };

// ---- CLAIMS.md ----
const claims = new Map();
for (const line of read("CLAIMS.md").split("\n")) {
  const m = /^\|\s*(CL\d{2,3})\s*\|(.*)\|\s*(PROVEN|NOT PROVEN)\s*\|(.*)\|\s*$/.exec(line);
  if (!m) continue;
  const [, id, text, status, evidence] = m;
  if (claims.has(id)) bad(`CLAIMS.md: ${id} appears twice`);
  claims.set(id, { text: text.trim(), status, evidence: [...evidence.matchAll(/`([^`]+)`/g)].map((x) => x[1]) });
}
if (claims.size === 0) bad("CLAIMS.md has no claim rows");

const testFiles = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    if (n === "node_modules" || n === "lib" || n === "out" || n === "cache") continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith(".test.ts") || n.endsWith(".t.sol")) testFiles.push(readFileSync(p, "utf8"));
  }
};
for (const d of ["packages", "ceremony/test", "contracts/test"]) walk(join(repo, d));
const testExists = (id) => {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ts = new RegExp(`(it|test|describe)\\(\\s*["'\`]${esc}\\b`);
  const sol = new RegExp(`function\\s+(${esc}\\s*\\(|test\\w*_${esc}(_|\\s*\\())`);
  return testFiles.some((t) => ts.test(t) || sol.test(t));
};

for (const [id, c] of claims) {
  if (c.status !== "PROVEN") continue;
  if (c.evidence.length === 0) bad(`${id} is PROVEN but cites no evidence`);
  for (const e of c.evidence) {
    if (e.startsWith("test:")) { if (!testExists(e.slice(5))) bad(`${id}: no test titled ${e.slice(5)}`); }
    else if (e.startsWith("absent:")) { if (existsSync(join(repo, e.slice(7)))) bad(`${id}: ${e.slice(7)} exists, so the claim no longer holds`); }
    else if (!existsSync(join(repo, e.replace(/#.*$/, "")))) bad(`${id}: evidence ${e} does not exist`);
  }
}

// ---- README ----
const readme = read("README.md");
const refs = [...readme.matchAll(/<!--\s*(CL\d{2,3})\s*-->/g)].map((m) => m[1]);
for (const id of new Set(refs)) {
  const c = claims.get(id);
  if (!c) bad(`README cites ${id}, which is not in CLAIMS.md`);
  else if (c.status !== "PROVEN") bad(`README states ${id} (“${c.text.slice(0, 70)}…”), which is ${c.status}`);
}

// Intro (before the first ##) and the Status section: each block of text must carry a marker.
const sections = readme.split(/^## /m);
const checked = [sections[0].split("\n").slice(1).join("\n"), ...sections.filter((s) => s.startsWith("Status"))];
for (const body of checked) {
  const blocks = body.replace(/^Status\n/, "").split(/\n(?=- )|\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  for (const b of blocks) {
    if (/^\s*```/.test(b)) continue;
    if (!/<!--\s*(CL\d{2,3}|not-built)\s*-->/.test(b)) bad(`README statement without a claim marker: “${b.replace(/\s+/g, " ").slice(0, 90)}…”`);
  }
}

// make targets in code blocks
const targets = new Set([...read("Makefile").matchAll(/^([a-zA-Z0-9_-]+(?:\s+[a-zA-Z0-9_-]+)*)\s*:(?!=)/gm)].flatMap((m) => m[1].split(/\s+/)));
for (const block of readme.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
  for (const m of block[1].matchAll(/^make\s+([a-z0-9-]+)/gm)) if (!targets.has(m[1])) bad(`README lists make ${m[1]}, which the Makefile does not have`);
}

const proven = [...claims.values()].filter((c) => c.status === "PROVEN").length;
console.log(`${failures ? "·" : "✓"} claims: ${claims.size} in CLAIMS.md (${proven} PROVEN, ${claims.size - proven} NOT PROVEN); README cites ${new Set(refs).size}`);
if (failures) { console.error(`claims check: ${failures} failure(s)`); process.exit(1); }
