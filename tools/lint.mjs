#!/usr/bin/env node
// Gate step 4 (lint):
// 1. `forge lint`: every finding fails, except the ones DECISIONS accepts, listed in tools/lint-allow.json by
//    lint id, file and exact source line (not line numbers), with the number of times each may appear.
// 2. TypeScript rules from CLAUDE.md that tsc does not enforce: no `any` type, no empty `catch` block.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
let failures = 0;
const bad = (m) => { console.error(`✗ ${m}`); failures++; };

// ---- forge lint ----
const allow = JSON.parse(readFileSync(join(repo, "tools/lint-allow.json"), "utf8"));
// forge prints findings on stderr and may exit 0 with warnings: read both streams, judge by the findings.
const run = spawnSync("forge", ["lint"], { cwd: join(repo, "contracts"), encoding: "utf8" });
if (run.error) bad(`forge lint did not run: ${run.error.message}`);
const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
if (run.status !== 0 && !/\[[a-z0-9-]+\]/.test(out)) bad(`forge lint exited ${run.status} without findings: ${out.slice(0, 400)}`);
const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
const findings = [];
const re = /^(warning|error|note|help)\[([a-z0-9-]+)\][^\n]*\n\s*╭▸ ([^:\n]+):(\d+):\d+/gm;
for (let m; (m = re.exec(plain)); ) {
  const [, level, id, file, line] = m;
  const code = readFileSync(join(repo, "contracts", file), "utf8").split("\n")[Number(line) - 1]?.trim() ?? "";
  findings.push({ level, id, file, line: Number(line), code });
}
const used = new Map();
for (const f of findings) {
  const rule = allow.find((a) => a.lint === f.id && a.file === f.file && a.code === f.code);
  if (!rule) { bad(`forge lint ${f.level}[${f.id}] ${f.file}:${f.line}: ${f.code}`); continue; }
  used.set(rule, (used.get(rule) ?? 0) + 1);
}
for (const rule of allow) {
  const n = used.get(rule) ?? 0;
  if (n > rule.count) bad(`forge lint [${rule.lint}] ${rule.file}: ${n} findings, ${rule.decision} accepts ${rule.count}`);
  else console.log(`✓ forge lint [${rule.lint}] ${rule.file}: ${n}/${rule.count} accepted by ${rule.decision}`);
}
const unlisted = findings.length - [...used.values()].reduce((x, y) => x + y, 0);
console.log(`${unlisted ? "·" : "✓"} forge lint: ${findings.length} finding(s), ${unlisted ? `${unlisted} outside the allowlist` : "none outside the allowlist"}`);

// ---- TypeScript rules ----
const ROOTS = ["packages", "web/src", "ceremony", "tools"];
const SKIP = new Set(["node_modules", "build", "out", ".next", "dist", "public", "s8-bench", "work", "outbox", "logs"]);
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    if (SKIP.has(n)) continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|mts|mjs)$/.test(n) && !n.endsWith(".d.ts")) files.push(p);
  }
};
for (const r of ROOTS) walk(join(repo, r));

const ANY = /(:\s*any\b|\bas\s+any\b|<any>|\bany\[\]|Array<any>|Record<[^>]*,\s*any>)/;
const EMPTY_CATCH = /catch\s*(\([^)]*\))?\s*\{(\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\}/g;
for (const f of files) {
  if (f === fileURLToPath(import.meta.url)) continue; // its own patterns would match
  const text = readFileSync(f, "utf8");
  const rel = relative(repo, f);
  text.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
    if (ANY.test(code)) bad(`${rel}:${i + 1}: \`any\` type (CLAUDE.md: no any): ${line.trim()}`);
  });
  for (const m of text.matchAll(EMPTY_CATCH)) bad(`${rel}:${text.slice(0, m.index).split("\n").length}: empty catch block`);
}
console.log(`${failures ? "·" : "✓"} TypeScript rules over ${files.length} files (no any, no empty catch)`);

// ---- colours only in the tokens file (DESIGN.md, D25) ----
const TOKENS = join(repo, "web/src/app/tokens.css");
const styled = [];
const walkWeb = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walkWeb(p);
    else if (/\.(css|tsx|ts)$/.test(n) && !n.endsWith(".d.ts") && p !== TOKENS) styled.push(p);
  }
};
walkWeb(join(repo, "web/src"));
const COLOUR = /(#[0-9a-fA-F]{3,8}\b(?![-\w])|\b(?:rgba?|hsla?|oklch|oklab)\()/;
let colourFails = 0;
for (const f of styled) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    // `#` followed by hex is also an id selector or a URL fragment in code: only flag colour-like contexts.
    const m = COLOUR.exec(line);
    if (!m) return;
    if (m[0].startsWith("#") && !/[:,(\s"'`]#[0-9a-fA-F]{3,8}\b/.test(line)) return;
    if (m[0].startsWith("#") && /href=|url\(#|`#\$\{|"#"|'#'/.test(line)) return;
    bad(`${relative(repo, f)}:${i + 1}: colour outside web/src/app/tokens.css (D25): ${line.trim().slice(0, 100)}`);
    colourFails++;
  });
}
console.log(`${colourFails ? "·" : "✓"} colours: ${styled.length} web/src files, only tokens.css writes a colour`);

if (failures) { console.error(`lint: ${failures} failure(s)`); process.exit(1); }
