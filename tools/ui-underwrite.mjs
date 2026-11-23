#!/usr/bin/env node
// The underwriting bot and the templates in headless Chromium, on the app built for Aevum testnet (44005), read-only:
// no wallet, no transaction. Writes <out>/report-<width>.md, screenshots, and the served llms.txt and agent card.
//   1. /underwrite loads its presets from /api/underwrite (rent-check, revenue-credit).
//   2. Live run 1's link (made out to "Landlord Bola") asked under rent-check: DECLINE(WrongReader).
//   3. The final-key fixture link (made out to the bot, but built on a test ledger root): INCONCLUSIVE(UnknownRoot).
//   4. /v?for=merchant with run 1's link, typed "Landlord Bola": VALID in the merchant's words, with the bot pointer.
//   5. /v?for=grantee, the landing page's "Who it is for", /llms.txt and /.well-known/agent.json.
// Usage: node tools/ui-underwrite.mjs [--width 390] [--base http://localhost:3100] [--out evidence/underwrite-ui]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withChromium } from "./ui-cdp.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:3100");
const WIDTH = Number(arg("width", "390"));
const REPO = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(REPO, arg("out", "evidence/underwrite-ui"));
const run1 = JSON.parse(readFileSync(join(REPO, "evidence/live-44005-run1.json"), "utf8")).link;
const fixture = JSON.parse(readFileSync(join(REPO, "packages/shaida-underwrite/test/fixtures/final-key-link.json"), "utf8")).fragment;
const log = [];
const note = (s) => { log.push(`${new Date().toISOString()} ${s}`); console.log(s); };
const fragmentOf = (link) => link.slice(link.indexOf("#") + 1);

async function decide(p, link, preset, expect) {
  await p.goto(`/underwrite?preset=${preset}`);
  await p.until(`document.querySelector("textarea[name=link]")`, 60_000, "the bot's form");
  await p.type("textarea[name=link]", link);
  await p.click("Ask the bot");
  await p.until(`document.querySelector("[data-decision]") || document.querySelector(".bot-page [role=alert]")`, 240_000, "a decision");
  const d = await p.eval(`(() => { const e = document.querySelector("[data-decision]"); return e ? { kind: e.dataset.decision, codes: e.dataset.codes ?? "", text: e.innerText.replace(/\\s+/g, " ") } : { kind: "error", codes: "", text: document.querySelector(".bot-page [role=alert]").innerText }; })()`);
  note(`${preset}: ${d.kind}${d.codes ? `(${d.codes})` : ""}: ${d.text.slice(0, 220)}`);
  if (`${d.kind}(${d.codes})` !== expect) throw new Error(`expected ${expect}, got ${d.kind}(${d.codes})`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const [path, file] of [["/llms.txt", "llms.txt"], ["/.well-known/agent.json", "agent.json"]]) {
    const r = await fetch(BASE + path);
    const body = await r.text();
    if (r.status !== 200) throw new Error(`${path}: HTTP ${r.status}`);
    writeFileSync(join(OUT, file), body);
    note(`${path}: HTTP 200, ${body.length} bytes, ${r.headers.get("content-type")}`);
  }
  await withChromium({ chromium: "/usr/bin/chromium", port: 9337, base: BASE, out: OUT, note }, async (_c, page) => {
    const p = await page("lender", { width: WIDTH });
    await p.goto("/underwrite");
    await p.until(`document.querySelectorAll("[aria-label=Policy] button").length === 2`, 60_000, "two presets");
    note(`presets: ${await p.eval(`[...document.querySelectorAll("[aria-label=Policy] button")].map(b => b.innerText).join(" | ")`)}`);
    await p.shot(`${WIDTH}-underwrite-presets`);

    await decide(p, run1, "rent-check", "DECLINE(WrongReader)");
    await p.shot(`${WIDTH}-underwrite-wrong-reader`);
    await decide(p, `${BASE}/v#${fixture}`, "revenue-credit", "INCONCLUSIVE(UnknownRoot)");
    await p.shot(`${WIDTH}-underwrite-inconclusive`);

    for (const [tpl, word] of [["merchant", "customer payment"], ["grantee", "disbursement"]]) {
      await p.goto(`/v?for=${tpl}#${fragmentOf(run1)}`);
      await p.type("input[name=reader]", "Landlord Bola");
      await p.click("Verify");
      await p.until(`document.querySelector("[data-verdict]")`, 240_000, "verdict");
      const v = await p.eval(`({ verdict: document.querySelector("[data-verdict]").dataset.verdict, h1: document.querySelector("h1").innerText, text: document.querySelector("[data-verdict]").innerText.replace(/\\s+/g, " ") })`);
      note(`/v?for=${tpl}: "${v.h1}", ${v.verdict}: ${v.text.slice(0, 200)}`);
      if (v.verdict !== "VALID" || !v.text.includes(word)) throw new Error(`/v?for=${tpl}: ${v.verdict}, wording "${word}" missing`);
      if (tpl === "merchant" && !(await p.eval(`!!document.querySelector('a[href^="/underwrite?preset=revenue-credit#"]')`))) throw new Error("no bot pointer on the merchant page");
      await p.shot(`${WIDTH}-verify-${tpl}`);
    }

    await p.goto("/");
    await p.eval(`document.getElementById("who")?.scrollIntoView()`);
    const who = await p.eval(`[...document.querySelectorAll('a[href^="/app/prove"], a[href="/underwrite"]')].map(a => a.getAttribute("href")).join(", ")`);
    note(`landing links: ${who}`);
    if (!who.includes("/app/prove?for=merchant") || !who.includes("/app/prove?for=grantee") || !who.includes("/underwrite")) throw new Error("landing is missing a template or bot link");
    await p.shot(`${WIDTH}-landing`);
  });
}
const report = (ok, extra = "") => `# Underwriting bot and templates in the browser (${WIDTH} px)\n\nGenerated by \`node tools/ui-underwrite.mjs --width ${WIDTH} --base ${BASE}\` against a local \`next start\` built with \`NEXT_PUBLIC_NETWORKS=aevum\`, reading Aevum testnet (44005). Read-only: no wallet, no transaction; recording was off. Personas are demo. An APPROVE needs a link made out to the bot, which is the live check (evidence/underwrite-live-44005.md).\n\nResult: ${ok ? "passed" : `FAILED${extra}`}\n\n${log.map((l) => `- ${l}`).join("\n")}\n`;
main().then(
  () => { writeFileSync(join(OUT, `report-${WIDTH}.md`), report(true)); process.exit(0); },
  (e) => { note(`FAILED: ${e.message}`); writeFileSync(join(OUT, `report-${WIDTH}-FAILED-${Date.now()}.md`), report(false, `: ${e.message}`)); process.exit(1); },
);
