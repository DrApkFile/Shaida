#!/usr/bin/env node
// PRD §11 acts 4–6 through the real UI on `make fork`, in headless Chromium at --width (390 by default; run again with
// --width 1280 for desktop). Ada (demo) makes a receive address and a vault in her browser; scripts/fork-pay-to.ts pays
// it 3 + 4 + 2 tUSD8 (Acme Studio, registered) and 5 tUSD8 (Mallory, NOT registered); Ada sweeps in Inbox, proves
// ≥ 9 tUSD8 for "Landlord Bola" expiring in 30 days in Prove (final key, proving timed in the browser); Bola opens the
// link in a separate profile, sees VALID, checks on chain and records the check; then the attacks, by name.
// Screenshots and report-<width>.md go to evidence/ui/. Usage: node tools/ui-flow-acts-4-6.mjs [--width 390]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withChromium } from "./ui-cdp.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:3100");
const CHROMIUM = arg("chromium", "/usr/bin/chromium");
const WIDTH = Number(arg("width", "390"));
const RPC = "http://127.0.0.1:8555";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(REPO, "evidence/ui");
const PASS = "demo passphrase 1";
const log = [];
const facts = {};
const note = (s) => { log.push(`${new Date().toISOString()} ${s}`); console.log(s); };
const cast = (...a) => execFileSync("cast", [...a, "--rpc-url", RPC], { encoding: "utf8" }).trim();
const name = (n) => `${WIDTH}-${n}`;

const b64 = { dec: (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8")), enc: (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url") };

async function unlock(p) {
  await p.until(`document.querySelector("input[type=password]") || document.querySelector(".vault-bar")`, 60_000, "vault gate");
  if (await p.eval(`!!document.querySelector("input[type=password]")`)) { await p.type("input[type=password]", PASS); await p.click("Unlock"); }
}

async function verifyAs(p, path, reader) {
  await p.goto("/");
  await p.goto(path);
  await p.type("input[name=reader]", reader);
  await p.click("Verify");
  await p.until(`document.querySelector("[data-verdict]")`, 120_000, "verdict");
  return p.eval(`({ verdict: document.querySelector("[data-verdict]").dataset.verdict, code: document.querySelector("[data-verdict]").dataset.code ?? null, text: document.querySelector("[data-verdict]").innerText })`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (cast("chain-id") !== "440050") throw new Error("not make fork");
  await withChromium({ chromium: CHROMIUM, port: 9334, base: BASE, out: OUT, note }, async (c, page) => {
    const ada = await page("ada", { width: WIDTH });
    await ada.goto("/");
    await ada.until(`document.body.innerText.includes("prove you earn enough")`, 60_000, "landing");
    await ada.shot(name("01-landing"));

    await ada.goto("/app/inbox");
    await ada.type("input[type=password]", PASS);
    await ada.click("Create vault");
    await ada.click("Create receive address");
    await ada.until(`document.querySelector(".receive-tag")`, 30_000, "receive address");
    const tag = await ada.eval(`document.querySelector(".receive-tag").innerText.trim()`);
    const paid = JSON.parse(execFileSync("pnpm", ["--silent", "--filter", "@shaida/pay", "exec", "tsx", "scripts/fork-pay-to.ts", "--tag", tag], { cwd: REPO, encoding: "utf8" }).trim().split("\n").at(-1));
    note(`paid Ada's browser receive address: ${paid.rows.length} txs; Mallory (unregistered) via the relayer: deposit ${paid.refusals.deposit}, vouched pay ${paid.refusals.pay}`);
    facts.payTxs = paid.rows;

    await ada.goto("/app/inbox");
    await unlock(ada);
    await ada.until(`document.querySelectorAll(".payment").length === 4`, 180_000, "4 payments in the inbox");
    await ada.click("Sweep all");
    await ada.until(`document.querySelectorAll(".payment .state.swept").length === 3 || document.querySelector("section[aria-labelledby=payments] [role=alert]")`, 900_000, "3 swept");
    const sweepAlert = await ada.eval(`document.querySelector("section[aria-labelledby=payments] [role=alert]")?.innerText ?? ""`);
    if (sweepAlert) throw new Error(`sweep refused: ${sweepAlert}`);
    note(`inbox: 3 swept; Mallory's: ${await ada.eval(`[...document.querySelectorAll(".payment")].find(p => p.innerText.includes("Mallory"))?.querySelector(".state")?.innerText`)}`);
    await ada.shot(name("02-inbox-swept"));

    await ada.goto("/app/prove");
    await unlock(ada);
    await ada.until(`document.querySelectorAll(".payment.countable").length === 3 && document.querySelectorAll(".payment.not-countable").length === 1`, 180_000, "3 countable, 1 not");
    const notCounted = await ada.eval(`document.querySelector(".payment.not-countable").innerText.replace(/\\s+/g, " ")`);
    if (!/no registered payer/.test(notCounted)) throw new Error(`unregistered payment shown as: ${notCounted}`);
    note(`attack: payment from the unregistered wallet → "${notCounted}"`);
    await ada.type("input[name=threshold]", "9.5");
    await ada.until(`document.querySelector(".suggest")`, 10_000, "threshold suggestions");
    note(`off-step threshold 9.5 → ${await ada.eval(`document.querySelector(".suggest").innerText.replace(/\\s+/g, " ")`)}`);
    await ada.shot(name("03-prove-suggest"));
    await ada.click("9 tUSD8");
    await ada.type("input[name=reader]", "Landlord Bola");
    await ada.click("Build proof link");
    await ada.until(`document.querySelector(".link-result") || document.querySelector("section[aria-labelledby=prove] [role=alert]")`, 1_200_000, "proof link");
    const proveAlert = await ada.eval(`document.querySelector("section[aria-labelledby=prove] [role=alert]")?.innerText ?? ""`);
    if (proveAlert) throw new Error(`prove refused: ${proveAlert}`);
    facts.browserProveMs = (await ada.eval(`document.querySelector(".link-result").dataset.proveMs`)).split(",").map(Number);
    const url = await ada.eval(`document.querySelector(".link-box").innerText.trim()`);
    const path = url.slice(url.indexOf("/v#"));
    facts.link = path;
    note(`proof link built in the browser: proving ${facts.browserProveMs.join(" + ")} ms with the final key; ${path.length} chars`);
    await ada.shot(name("04-prove-link"));
    await ada.goto("/app/shared");
    await unlock(ada);
    await ada.until(`document.querySelector(".shared-link")`, 30_000, "shared link");
    await ada.shot(name("05-shared"));
    // The overview has no vault form: reach it through its section tab, so the vault opened above stays open.
    await ada.eval(`document.querySelector('.section-tabs a[href="/app"]').click()`);
    await ada.until(`document.querySelectorAll(".check .chip.ok").length === 5 && document.querySelectorAll(".big-num")[3]?.innerText === "1"`, 120_000, "dashboard counts");
    await ada.shot(name("06-dashboard"));

    const bola = await page("bola", { width: WIDTH });
    const valid = await verifyAs(bola, path, "Landlord Bola");
    if (valid.verdict !== "VALID") throw new Error(`Bola sees ${valid.verdict} ${valid.code}`);
    note(`Bola: ${valid.text.split("\n").slice(0, 2).join(" ")}`);
    await bola.click("Check on-chain");
    await bola.until(`document.querySelector(".on-chain-ok") || document.querySelector(".on-chain [role=alert]")`, 60_000, "on-chain check");
    note(`check on-chain: ${await bola.eval(`(document.querySelector(".on-chain-ok") ?? document.querySelector(".on-chain [role=alert]")).innerText`)}`);
    await bola.click("Record check");
    await bola.until(`document.querySelector(".attest-record")?.innerText.startsWith("Recorded") || document.querySelector(".on-chain [role=alert]")`, 180_000, "attest");
    const attest = await bola.eval(`document.querySelector(".attest-record").innerText`);
    if (!attest.startsWith("Recorded")) throw new Error(`attest: ${attest}`);
    facts.attest = attest;
    note(`record check: ${attest}`);
    await bola.shot(name("07-verify-valid"));

    const j = b64.dec(path.slice(3));
    j.proofs = j.proofs.map((p) => ({ ...p, publicSignals: p.publicSignals.map((s, i) => (i === 2 ? (BigInt(s) + 1_000_000n).toString() : s)) }));
    const attacks = [
      ["edited threshold (+1 tUSD8 in the link)", "ProofInvalid", `/v#${b64.enc(j)}`, "Landlord Bola", "08-attack-edited"],
      ["a different reader (Tenant Chidi)", "WrongReader", path, "Tenant Chidi", "09-attack-reader"],
    ];
    for (const [what, want, link, reader, shot] of attacks) {
      const got = await verifyAs(bola, link, reader);
      if (got.code !== want) throw new Error(`${what}: ${got.verdict} ${got.code}, expected ${want}`);
      note(`attack: ${what} → ${got.code}`);
      await bola.shot(name(shot));
    }
    // ProofExpired: the browser clock moved 31 days ahead in this profile only (an expiry of 30 days has passed).
    const later = await page("bola-31-days-later", { width: WIDTH, init: `(() => { const D = Date, off = 31 * 86400e3; class S extends D { constructor(...a) { a.length ? super(...a) : super(D.now() + off); } static now() { return D.now() + off; } } globalThis.Date = S; })()` });
    const expired = await verifyAs(later, path, "Landlord Bola");
    if (expired.code !== "ProofExpired") throw new Error(`expired link: ${expired.verdict} ${expired.code}`);
    note("attack: the link opened with the browser clock 31 days ahead → ProofExpired");
    await later.shot(name("10-attack-expired"));
  });
  const machine = {
    cpu: execFileSync("sh", ["-c", "lscpu | sed -n 's/^Model name: *//p'"], { encoding: "utf8" }).trim(),
    threads: execFileSync("nproc", { encoding: "utf8" }).trim(),
    memory: readFileSync("/proc/meminfo", "utf8").match(/MemTotal:\s+(\d+)/)?.[1] ?? "—",
    browser: execFileSync(CHROMIUM, ["--version"], { encoding: "utf8" }).trim(),
  };
  note(`machine: ${machine.cpu}, ${machine.threads} threads, ${Math.round(Number(machine.memory) / 1048576)} GiB RAM; ${machine.browser} headless`);
  facts.machine = machine;
}

const report = (ok, extra = "") => `# UI flow, acts 4–6 on make fork (${WIDTH} px)\n\nGenerated by \`node tools/ui-flow-acts-4-6.mjs --width ${WIDTH}\`. Personas are demo.\n\nResult: ${ok ? "passed" : `FAILED${extra}`}\n\n${log.map((l) => `- ${l}`).join("\n")}\n`;
main().then(
  () => { writeFileSync(join(OUT, `report-${WIDTH}.md`), report(true)); writeFileSync(join(OUT, `facts-${WIDTH}.json`), JSON.stringify(facts, null, 2) + "\n"); process.exit(0); },
  (e) => { note(`FAILED: ${e.message}`); writeFileSync(join(OUT, `report-${WIDTH}-FAILED-${Date.now()}.md`), report(false, `: ${e.message}`)); process.exit(1); },
);
