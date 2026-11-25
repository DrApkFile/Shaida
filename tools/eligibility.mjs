#!/usr/bin/env node
// `make eligibility`: re-checks every acceptance gate of briefing/EVENT.md (A01–A12) against the live system, read-only.
// It sends no transaction and needs no key: GitHub's public API, the live site (GET, and two POSTs to the bot with
// record=false), and Aevum testnet (eth_chainId, eth_getCode, eth_getTransactionReceipt, eth_call via cast).
// A09 (DoraHacks registration) and A12 (no malicious code) cannot be checked by a script: they are printed as MANUAL
// with what to look at. Writes evidence/eligibility.md (or a -FAILED- copy). Exit 0 when no automatic check fails.
// Usage: node tools/eligibility.mjs [--site https://shaida.onrender.com] [--no-gitleaks]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const SITE = arg("site", "https://shaida.onrender.com");
const REPO_SLUG = "DrApkFile/Shaida";
const TUSD8 = "0x456569838f1d43009a91eba4263147afd7233483";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(REPO, p), "utf8");
const D = JSON.parse(read("deployments/aevum.json"));
const RPC = D.rpc;
const rows = [];
const add = (id, what, result, status) => { rows.push({ id, what, result: String(result).replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 400), status }); console.log(`${status.padEnd(12)} ${id} ${what}: ${result}`); };
const pass = (id, what, ok, result) => add(id, what, result, ok ? "PASS" : "FAIL");

async function rpc(method, params) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
const cast = (...a) => spawnSync("cast", [...a, "--rpc-url", RPC], { encoding: "utf8" });
const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" }).trim();
async function getJson(url, init) {
  const res = await fetch(url, init);
  return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text() };
}
/** Runs one check; an exception is that check's FAIL, never a skipped row. */
async function check(id, what, fn) {
  try { await fn(); } catch (e) { add(id, what, `error: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`, "FAIL"); }
}

const runFiles = ["evidence/live-44005-run1.md", "evidence/live-44005-run2.md", "evidence/underwrite-live-44005.md", "evidence/budget.md"];
const txHashes = [...new Set(runFiles.flatMap((f) => [...read(f).matchAll(/explorer-test\.qday\.info\/tx\/(0x[0-9a-f]{64})/g)].map((m) => m[1])))];
const PROOF_CHECKED = "0x" + execFileSync("cast", ["keccak", "IncomeProofChecked(uint256,uint256,uint256)"], { encoding: "utf8" }).trim().slice(2);

function run1Args() {
  const link = JSON.parse(read("web/src/app/example-links.json"))["44005"].link;
  const j = JSON.parse(Buffer.from(link.slice(link.indexOf("#") + 1), "base64url").toString("utf8"));
  const { pi_a: a, pi_b: b, pi_c: c } = j.proofs[0].proof;
  return { proof: `([${a[0]},${a[1]}],[[${b[0][1]},${b[0][0]}],[${b[1][1]},${b[1][0]}]],[${c[0]},${c[1]}])`, signals: j.proofs[0].publicSignals, link };
}

async function main() {
  const head = git("rev-parse", "HEAD");
  const originMaster = git("rev-parse", "origin/master");

  await check("A01", "public repo, permissive licence", async () => {
    const r = await getJson(`https://api.github.com/repos/${REPO_SLUG}`, { headers: { accept: "application/vnd.github+json", "user-agent": "shaida-eligibility" } });
    const lic = read("LICENSE");
    pass("A01", "public repo, permissive licence", r.status === 200 && r.body.private === false && r.body.license?.spdx_id === "MIT" && lic.startsWith("MIT License"),
      `GitHub API ${r.status}: private ${r.body.private}, licence ${r.body.license?.spdx_id}; LICENSE starts "${lic.split("\n")[0]}"`);
  });

  await check("A02", "contracts deployed on 44005", async () => {
    const names = Object.keys(D.contracts);
    const empty = [];
    for (const n of names) if (((await rpc("eth_getCode", [D.contracts[n].address, "latest"])) ?? "0x").length <= 2) empty.push(n);
    pass("A02", "contracts deployed on 44005", D.chainId === 44005 && empty.length === 0, `code at ${names.length - empty.length} of ${names.length} addresses in deployments/aevum.json${empty.length ? `; empty: ${empty.join(", ")}` : ""}`);
  });

  await check("A03", "deployed commit is public", async () => {
    const sha = D.gitCommit;
    const ancestor = spawnSync("git", ["-C", REPO, "merge-base", "--is-ancestor", sha, "origin/master"]).status === 0;
    const r = await getJson(`https://api.github.com/repos/${REPO_SLUG}/commits/${sha}`, { headers: { "user-agent": "shaida-eligibility" } });
    pass("A03", "deployed commit is public", ancestor && r.status === 200 && D.gitDirty === false, `deployments/aevum.json gitCommit ${sha.slice(0, 12)} (dirty ${D.gitDirty}): ancestor of origin/master ${ancestor}; GitHub ${r.status}`);
  });

  await check("A04", "tx hashes show the app working", async () => {
    let ok = 0, events = 0;
    const bad = [];
    for (const h of txHashes) {
      const r = await rpc("eth_getTransactionReceipt", [h]);
      if (r?.status === "0x1") ok++; else bad.push(h.slice(0, 10));
      events += (r?.logs ?? []).filter((l) => l.address.toLowerCase() === D.contracts.IncomeVerifier.address.toLowerCase() && l.topics[0] === PROOF_CHECKED).length;
    }
    pass("A04", "tx hashes show the app working", ok === txHashes.length && txHashes.length > 0 && events === 3,
      `${ok} of ${txHashes.length} tx hashes in ${runFiles.join(", ")} mined with status 1${bad.length ? `; not: ${bad.join(", ")}` : ""}; IncomeProofChecked events among them: ${events} (run 1, run 2, the bot)`);
  });

  await check("A05", "live demo works logged out", async () => {
    const h = await getJson(`${SITE}/api/health`);
    const land = await fetch(`${SITE}/`, { redirect: "manual" });
    const html = await land.text();
    const v = await fetch(`${SITE}/v`, { redirect: "manual" });
    const nets = JSON.stringify(h.body.networks);
    pass("A05", "live demo works logged out", h.status === 200 && h.body.ok === true && h.body.commit === originMaster && nets === '[{"key":"aevum","chainId":44005}]' && land.status === 200 && html.includes("See a live proof") && v.status === 200,
      `/api/health ${h.status}: commit ${String(h.body.commit).slice(0, 12)} (origin/master ${originMaster.slice(0, 12)}), networks ${nets}, store ${h.body.store}; / ${land.status} with "See a live proof" ${html.includes("See a live proof")}; /v ${v.status}; no cookie or login asked`);
  });

  await check("A06", "docs: problem, architecture, workflows, technologies", async () => {
    const readme = read("README.md");
    const want = ["## Status", "## The problem", "## How it works", "## The 60-second judge path", "## Tech"];
    const missing = want.filter((s) => !readme.includes(s));
    pass("A06", "docs: problem, architecture, workflows, technologies", missing.length === 0 && readme.includes("```mermaid"), missing.length ? `README lacks ${missing.join(", ")}` : `README has ${want.join(", ")} and a mermaid diagram`);
  });

  await check("A07", "reused code credited", async () => {
    const notice = read("NOTICE.md");
    const names = ["Aevum Starter Kit", "Gloam", "circomlib", "snarkjs", "Inter Tight"];
    const missing = names.filter((n) => !notice.includes(n));
    const lic = existsSync(join(REPO, "contracts/lib/gloam/LICENSE"));
    pass("A07", "reused code credited", missing.length === 0 && lic && read("README.md").includes("Based in part on the [Aevum Starter Kit]"),
      `NOTICE.md names ${names.length - missing.length} of ${names.length} (${names.join(", ")})${missing.length ? `; missing ${missing.join(", ")}` : ""}; contracts/lib/gloam/LICENSE ${lic ? "present" : "MISSING"}; README credit line present`);
  });

  if (process.argv.includes("--no-gitleaks")) add("A08", "no secrets in repo or history", "gitleaks not run (--no-gitleaks): the gate's step 8 runs it", "NOT RUN");
  else await check("A08", "no secrets in repo or history", async () => {
    const g = spawnSync("gitleaks", ["detect", "--source", REPO, "--config", join(REPO, ".gitleaks.toml"), "--redact", "--no-banner"], { encoding: "utf8" });
    if (g.error) { add("A08", "no secrets in repo or history", `gitleaks not runnable: ${g.error.message}`, "FAIL"); return; }
    const summary = `${g.stdout}${g.stderr}`.split("\n").filter((l) => /commits scanned|no leaks|leaks found/i.test(l)).map((l) => l.replace(/^.*?(\d+ commits|no leaks|leaks found)/, "$1")).join("; ");
    pass("A08", "no secrets in repo or history", g.status === 0, `gitleaks over the whole history: exit ${g.status}; ${summary}`);
  });

  add("A09", "team member registered on DoraHacks", "a person checks the BUIDL page lists Kene as the team member (SUBMISSION.md)", "MANUAL");

  await check("A10", "uses tUSD8", async () => {
    const sym = cast("call", TUSD8, "symbol()(string)").stdout.trim();
    const dec = cast("call", TUSD8, "decimals()(uint8)").stdout.trim();
    const asset = cast("call", D.contracts.IncomeVerifier.address, "asset()(uint256)").stdout.trim().split(" ")[0];
    const assetAddr = asset ? `0x${BigInt(asset).toString(16).padStart(40, "0")}` : "";
    pass("A10", "uses tUSD8", sym === '"tUSD8"' && dec === "6" && D.token.address.toLowerCase() === TUSD8 && assetAddr === TUSD8,
      `${TUSD8}: symbol ${sym}, decimals ${dec}; deployments token ${D.token.address}; IncomeVerifier.asset() = ${assetAddr}`);
  });

  await check("A11", "all settlement on Aevum", async () => {
    const id = await rpc("eth_chainId", []);
    const build = read("tools/render-build.sh").includes('NEXT_PUBLIC_NETWORKS:-}" == "aevum"');
    const h = await getJson(`${SITE}/api/health`);
    pass("A11", "all settlement on Aevum", id === "0xabe5" && build && h.body.networks?.length === 1 && h.body.networks[0].chainId === 44005,
      `RPC ${RPC} eth_chainId ${id} (44005); render-build.sh refuses any NEXT_PUBLIC_NETWORKS but "aevum" ${build}; live site serves ${JSON.stringify(h.body.networks)}`);
  });

  add("A12", "no malicious code, no attacks on the platform", "a person reviews: the only scripts that send txs are the deploy, the run scripts and the app's relayer (THREAT_MODEL.md, PRD §8); this check sent none", "MANUAL");

  // Live guards a judge can try (PROOF_PLAN.md).
  const { proof, signals, link } = run1Args();
  const SIG = "check((uint256[2],uint256[2][2],uint256[2]),uint256[7])(bool)";
  await check("G1", "IncomeVerifier.check accepts run 1's proof", async () => {
    const r = cast("call", D.contracts.IncomeVerifier.address, SIG, proof, `[${signals.join(",")}]`, "--gas-limit", "400000");
    pass("G1", "IncomeVerifier.check accepts run 1's proof", r.status === 0 && r.stdout.trim() === "true", `eth_call → ${r.stdout.trim() || r.stderr.split("\n")[0]}`);
  });
  await check("G2", "IncomeVerifier.check refuses run 1's proof with the threshold edited", async () => {
    const t = [...signals]; t[2] = "4000000";
    const r = cast("call", D.contracts.IncomeVerifier.address, SIG, proof, `[${t.join(",")}]`, "--gas-limit", "400000");
    pass("G2", "IncomeVerifier.check refuses run 1's proof with the threshold edited", r.status !== 0 && /ProofInvalid|0x7fcdd1f4/.test(r.stderr), `eth_call → ${r.stderr.split("\n").find((l) => l.includes("revert")) ?? r.stdout.trim()}`);
  });
  const bot = JSON.parse(read("evidence/underwrite-live-44005/run.json"));
  const ask = (l, preset) => getJson(`${SITE}/api/underwrite`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ link: l, preset, record: false }) });
  for (const [id, l, preset, want] of [
    ["G3", bot.link, "rent-check", "APPROVE"],
    ["G4", bot.link, "revenue-credit", "DECLINE BelowMinThreshold,TooFewPayments,PeriodTooShort"],
    ["G5", `${SITE}${link}`, "rent-check", "DECLINE WrongReader"],
  ]) {
    await check(id, `bot: ${preset} → ${want}`, async () => {
      const r = await ask(l, preset);
      const d = r.body.decision;
      const got = d ? `${d.kind}${d.reasons?.length ? ` ${d.reasons.map((x) => x.code).join(",")}` : ""}` : `HTTP ${r.status}`;
      pass(id, `bot: ${preset} → ${want}`, got === want, `${got}; decision ${d?.decisionId?.slice(0, 16) ?? "—"}…, evaluated ${d?.evaluatedAt ?? "—"}`);
    });
  }

  const failed = rows.filter((r) => r.status === "FAIL" || r.status === "NOT RUN").length;
  const md = `# Eligibility re-check (A01–A12) against the live system

Written by \`make eligibility\` (\`node tools/eligibility.mjs\`). Do not edit by hand. Read-only: no transaction, no key.
Acceptance IDs: briefing/EVENT.md. Live guards G1–G5: PROOF_PLAN.md.

| Field | Value |
|---|---|
| Date (UTC) | ${new Date().toISOString()} |
| Checked from commit | \`${head}\` (origin/master \`${originMaster}\`) |
| Site / RPC | ${SITE} / ${RPC} |
| Result | ${failed ? `**FAILED** (${failed} check(s))` : "every automatic check passed; A09 and A12 are MANUAL"} |

| ID | Check | Result | Status |
|---|---|---|---|
${rows.map((r) => `| ${r.id} | ${r.what} | ${r.result} | ${r.status === "PASS" ? "PASS" : `**${r.status}**`} |`).join("\n")}
`;
  writeFileSync(join(REPO, failed ? `evidence/eligibility-FAILED-${Date.now()}.md` : "evidence/eligibility.md"), md);
  console.log(failed ? `eligibility: ${failed} check(s) failed` : "eligibility: PASS (A09, A12 manual)");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(`eligibility: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
