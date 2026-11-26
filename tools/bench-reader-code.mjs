#!/usr/bin/env node
// Offline guessing cost of a reader code (D36, LIMITS): an attacker with the link and the reader's name tries codes
// until Poseidon(5, nameHash, Poseidon(code)) equals the link's readerIdHash. Measures guesses per second with
// poseidon-lite on this machine (one core) and writes evidence/reader-code-work.md with the work factor.
// Usage: node tools/bench-reader-code.mjs
import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(ROOT, "packages/shaida-proofs/package.json"));
const { poseidon1, poseidon3 } = require("poseidon-lite");

const nameHash = 0x1234567n;
const target = poseidon3([5n, nameHash, poseidon1([(1n << 80n) - 1n])]);
const N = 20_000;
let hit = 0;
const runs = [];
for (let r = 0; r < 5; r++) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) if (poseidon3([5n, nameHash, poseidon1([BigInt(r * N + i)])]) === target) hit++;
  runs.push(Number(process.hrtime.bigint() - t0) / 1e9);
}
runs.sort((a, b) => a - b);
const median = runs[2];
const perSec = N / median;
const year = 365.25 * 86400;
const bits = [60, 80];
const lines = bits.map((b) => {
  const space = 2 ** b;
  const expected = space / 2; // a random code is found after half the space on average
  return `| ${b} (${b / 5} characters) | ${space.toExponential(3)} | ${(expected / perSec / year).toExponential(2)} | ${(expected / (perSec * 1e3) / year).toExponential(2)} | ${(expected / (perSec * 1e6) / year).toExponential(2)} |`;
});
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const md = [
  "# Reader code: offline guessing cost (D36)",
  "",
  `Command: \`node tools/bench-reader-code.mjs\`. Commit ${commit}, ${new Date().toISOString()}, Node ${process.version}, ${cpus()[0]?.model ?? "unknown CPU"} (one core), poseidon-lite 0.3.0. Class: real (this machine).`,
  "",
  `One guess = Poseidon(code) and Poseidon(5, nameHash, ·), compared with the link's readerIdHash. ${N} guesses per run, 5 runs: median ${median.toFixed(3)} s, so **${Math.round(perSec).toLocaleString("en-US")} guesses per second** on one core (runs: ${runs.map((x) => x.toFixed(3)).join(", ")} s).`,
  "",
  "Expected time to find a random code (half the space). The 1,000× and 1,000,000× columns are assumptions, not measurements: a many-core cluster and a large GPU farm with an optimised Poseidon.",
  "",
  "| Code bits | Codes | Years, this core | Years, 1,000× faster | Years, 1,000,000× faster |",
  "|---|---:|---:|---:|---:|",
  ...lines,
  "",
  "Shaida uses 80 bits (16 characters). A link lives at most 365 days (D27), so an attacker has at most that long, and the holder can revoke it earlier (D35).",
  "",
].join("\n");
writeFileSync(join(ROOT, "evidence/reader-code-work.md"), md);
console.log(md);
process.exit(hit === 0 ? 0 : 1);
