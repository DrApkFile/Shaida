#!/usr/bin/env node
// Copies Gloam's shield, transfer and unshield circuits with their FINAL ceremony keys into web/public/gloam/ for in-browser
// proving, refusing any file whose sha256 differs from packages/shaida-pay/gloam-artifacts.json. Gloam's files are
// copied unchanged and its LICENSE goes with them (NOTICE.md). The browser checks the same hashes before proving.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const gloam = join(repo, "contracts/lib/gloam");
const out = join(repo, "web/public/gloam");
const pins = JSON.parse(readFileSync(join(repo, "packages/shaida-pay/gloam-artifacts.json"), "utf8"));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

mkdirSync(out, { recursive: true });
let bad = 0;
for (const circuit of ["shield", "transfer", "unshield"]) {
  for (const kind of ["wasm", "zkey"]) {
    const a = pins[circuit][kind];
    const from = join(gloam, a.source);
    const got = sha(from);
    if (got !== a.sha256) {
      console.error(`✗ ${a.source}: sha256 ${got}, pinned ${a.sha256}`);
      bad++;
      continue;
    }
    copyFileSync(from, join(out, a.file));
    console.log(`✓ web/public/gloam/${a.file}`);
  }
}
copyFileSync(join(gloam, "LICENSE"), join(out, "LICENSE"));
if (bad) process.exit(1);
