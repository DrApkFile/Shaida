#!/usr/bin/env node
// Fetches the ceremony's final income zkey from the GitHub release ceremony-v1 into a local cache and refuses it
// unless its sha256 equals ceremony/record.json final.zkey.sha256. The web app serves only this checked local copy
// (tools/copy-income-artifacts.mjs); nothing is fetched at page load.
//   node tools/fetch-income-key.mjs              download (or reuse the cached copy) and check
//   node tools/fetch-income-key.mjs --evidence   also write evidence/ceremony-release.md (CLAIMS CL34)
// Cache: $SHAIDA_RELEASE_DIR, else ${XDG_CACHE_HOME:-~/.cache}/shaida-release (not /tmp: it is RAM-backed here).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_TAG = "ceremony-v1";
export const RELEASE_PAGE = `https://github.com/DrApkFile/Shaida/releases/tag/${RELEASE_TAG}`;
export const ASSET_URL = `https://github.com/DrApkFile/Shaida/releases/download/${RELEASE_TAG}/income_final.zkey`;

const repo = fileURLToPath(new URL("..", import.meta.url));
export const releaseDir = () =>
  process.env.SHAIDA_RELEASE_DIR ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "shaida-release");
export const expectedZkeySha = () => {
  const record = JSON.parse(readFileSync(join(repo, "ceremony/record.json"), "utf8"));
  if (record.final === null) throw new Error("ceremony/record.json has no final key");
  return record.final.zkey.sha256;
};
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

async function download(to) {
  const res = await fetch(ASSET_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${ASSET_URL}: HTTP ${res.status}`);
  const part = `${to}.part`;
  writeFileSync(part, Buffer.from(await res.arrayBuffer()));
  renameSync(part, to);
}

async function main() {
  const evidence = process.argv.includes("--evidence");
  const dir = releaseDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "income_final.zkey");
  const expected = expectedZkeySha();
  let downloaded = false;
  if (evidence || !existsSync(file)) {
    // Evidence is always about the asset as served now, never a cached copy.
    await download(file);
    downloaded = true;
  }
  const got = sha(file);
  if (got !== expected) {
    console.error(`✗ ${file}: sha256 ${got}, ceremony/record.json says ${expected}. Not used.`);
    process.exit(1);
  }
  const bytes = statSync(file).size;
  console.log(`✓ income_final.zkey ${got} (${bytes} bytes) ${downloaded ? "downloaded from" : "cached from"} ${ASSET_URL}`);
  if (!evidence) return;
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const page = await fetch(RELEASE_PAGE, { redirect: "follow" });
  const md = [
    "# Ceremony release `ceremony-v1`",
    "",
    "Written by `node tools/fetch-income-key.mjs --evidence` (do not edit by hand).",
    "",
    "| Item | Value |",
    "|---|---|",
    `| Date (UTC) | ${new Date().toISOString()} |`,
    `| Commit | \`${commit}\` |`,
    `| Release page | ${RELEASE_PAGE} (HTTP ${page.status}) |`,
    `| Asset | ${ASSET_URL} |`,
    `| Downloaded bytes | ${bytes} |`,
    `| sha256 of the download | \`${got}\` |`,
    `| ceremony/record.json final.zkey.sha256 | \`${expected}\` |`,
    `| Result | ${got === expected && page.ok ? "MATCH" : "MISMATCH"} |`,
    "",
  ].join("\n");
  writeFileSync(join(repo, "evidence/ceremony-release.md"), md);
  console.log("✓ evidence/ceremony-release.md");
  if (!page.ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0), (e) => { console.error(`✗ ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
}
