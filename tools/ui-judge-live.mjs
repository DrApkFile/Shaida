#!/usr/bin/env node
// The judge path (PROOF_PLAN.md) on the live site, in headless Chromium, read-only: no wallet, no transaction.
//   landing → "See a live proof" → "Landlord Bola" → VALID → Check on-chain (eth_call) → attacks by name:
//   edited threshold (ProofInvalid), another reader (WrongReader), edited expiry (ContextMismatch); then the states a
//   judge can reach without a wallet: no proof in the link (empty), a malformed link (error), a link over a ledger
//   root the chain does not know (INCONCLUSIVE UnknownRoot: the stale/resync state), the dashboard with no vault; then
//   the bot: its sample link APPROVE under rent-check and DECLINE under revenue-credit, run 1's link WrongReader.
//   D35/D36: the live revoke's revokedAt on chain (eth_call), run 1 labelled name-only and not revocable, and the
//   reader-code card on /v (the code is masked in the screenshot and never written).
// "Record check" is never pressed. Writes <out>/report-<width>.md and screenshots (default out: evidence/judge-ui).
// Usage: node tools/ui-judge-live.mjs [--width 390] [--base https://shaida.onrender.com]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withChromium } from "./ui-cdp.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", "https://shaida.onrender.com");
const WIDTH = Number(arg("width", "390"));
const CHROMIUM = arg("chromium", "/usr/bin/chromium");
const REPO = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(REPO, arg("out", "evidence/judge-ui"));
const run1 = JSON.parse(readFileSync(join(REPO, "web/src/app/example-links.json"), "utf8"))["44005"].link;
const botLink = JSON.parse(readFileSync(join(REPO, "evidence/underwrite-live-44005/run.json"), "utf8")).link;
const testRoot = JSON.parse(readFileSync(join(REPO, "packages/shaida-underwrite/test/fixtures/final-key-link.json"), "utf8")).fragment;
const BOT = "Shaida underwriting bot (demo)";
const RPC = "https://rpc-test.qday.info";
const liveRevoke = JSON.parse(readFileSync(join(REPO, "evidence/revoke-live-44005/run.json"), "utf8"));
const LIVE_REVOKE = { registry: liveRevoke.registry, salt: liveRevoke.salt, block: BigInt(liveRevoke.block) };
const log = [];
const note = (s) => { log.push(`${new Date().toISOString()} ${s}`); console.log(s); };
const b64 = { dec: (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8")), enc: (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url") };
const fragmentOf = (link) => link.slice(link.indexOf("#") + 1);
const shotName = (n) => `${WIDTH}-${n}`;

function edited(fragment, change) {
  const j = b64.dec(fragment);
  change(j);
  return `/v#${b64.enc(j)}`;
}

async function verdictOf(p) {
  await p.until(`document.querySelector("[data-verdict]")`, 180_000, "verdict");
  return p.eval(`(() => { const e = document.querySelector("[data-verdict]"); return { verdict: e.dataset.verdict, code: e.dataset.code ?? "", text: e.innerText.replace(/\\s+/g, " ") }; })()`);
}

async function verifyAs(p, path, reader) {
  await p.goto("/");
  await p.goto(path);
  await p.type("input[name=reader]", reader);
  await p.click("Verify");
  return verdictOf(p);
}

async function decide(p, link, preset, prefilled) {
  await p.goto("/");
  if (prefilled) {
    // The judge's sample URL: /underwrite?preset=…#<proof> fills the form itself (BotDesk).
    await p.goto(`/underwrite?preset=${preset}#${fragmentOf(link)}`);
    await p.until(`document.querySelector("textarea[name=link]")?.value.includes(${JSON.stringify(fragmentOf(link).slice(0, 40))})`, 60_000, "the prefilled link");
  } else {
    await p.goto(`/underwrite?preset=${preset}`);
    await p.until(`document.querySelector("textarea[name=link]")`, 60_000, "the bot's form");
    await p.type("textarea[name=link]", link);
  }
  await p.click("Ask the bot");
  await p.until(`document.querySelector("[data-decision]") || document.querySelector(".bot-page [role=alert]")`, 240_000, "a decision");
  return p.eval(`(() => { const e = document.querySelector("[data-decision]"); return e ? { kind: e.dataset.decision, codes: e.dataset.codes ?? "", text: e.innerText.replace(/\\s+/g, " ") } : { kind: "error", codes: "", text: document.querySelector(".bot-page [role=alert]").innerText }; })()`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const health = await (await fetch(`${BASE}/api/health`)).json();
  note(`/api/health: commit ${health.commit}, networks ${JSON.stringify(health.networks)}, store ${health.store}`);
  // D35: the live revoke (evidence/revoke-live-44005.md) is on chain: Revocations.revokedAt(salt) is its block.
  const call = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: LIVE_REVOKE.registry, data: `0x871bd456${LIVE_REVOKE.salt.slice(2)}` }, "latest"] }) })).json();
  if (BigInt(call.result ?? "0x0") !== LIVE_REVOKE.block) throw new Error(`revokedAt(live salt) = ${call.result ?? JSON.stringify(call.error)}, expected ${LIVE_REVOKE.block}`);
  note(`Revocations.revokedAt(the live revoke's salt) = ${LIVE_REVOKE.block} (eth_call, nothing sent)`);
  await withChromium({ chromium: CHROMIUM, port: 9337, base: BASE, out: OUT, note }, async (_c, page) => {
    const judge = await page("judge", { width: WIDTH });
    await judge.goto("/");
    const href = await judge.eval(`[...document.querySelectorAll("a")].find(a => a.innerText.includes("See a live proof"))?.getAttribute("href") ?? null`);
    if (href !== run1) throw new Error(`landing "See a live proof" is ${href}, not run 1's link`);
    note(`landing: "See a live proof" links run 1's proof (${href.length} characters)`);
    await judge.shot(shotName("01-landing"));

    const valid = await verifyAs(judge, href, "Landlord Bola");
    if (valid.verdict !== "VALID") throw new Error(`run 1's link: ${valid.verdict} ${valid.code}`);
    note(`Landlord Bola → VALID: ${valid.text.slice(0, 160)}`);
    // D35/D36: run 1 predates both, so it is labelled name-only and not revocable, and still VALID.
    const kind = await judge.eval(`document.querySelector(".link-kind")?.innerText.replace(/\\s+/g, " ") ?? ""`);
    if (!kind.includes("Name only: anyone with this link and the name can view it") || !kind.includes("not revocable (made before revocation existed)")) throw new Error(`run 1's label: ${kind}`);
    if (!valid.text.includes("Not revocable (made before revocation existed)")) throw new Error("run 1's VALID has no Revocation row");
    note(`run 1's label: ${kind}`);
    await judge.click("Check on-chain");
    await judge.until(`document.querySelector(".on-chain-ok") || document.querySelector(".on-chain [role=alert]")`, 120_000, "on-chain check");
    const onChain = await judge.eval(`(document.querySelector(".on-chain-ok") ?? document.querySelector(".on-chain [role=alert]")).innerText.replace(/\\s+/g, " ")`);
    if (!(await judge.eval(`!!document.querySelector(".on-chain-ok")`))) throw new Error(`on-chain check: ${onChain}`);
    note(`Check on-chain: ${onChain}`);
    await judge.shot(shotName("02-valid-on-chain"));

    const f = fragmentOf(run1);
    const attacks = [
      ["threshold edited in the link (3 → 4 tUSD8)", edited(f, (j) => { j.proofs[0].publicSignals[2] = "4000000"; }), "Landlord Bola", "ProofInvalid", "03-attack-threshold"],
      ["another reader name (Tenant Chidi)", run1, "Tenant Chidi", "WrongReader", "04-attack-reader"],
      ["expiry edited in the link (+30 days)", edited(f, (j) => { j.expiry += 30 * 86400; }), "Landlord Bola", "ContextMismatch", "05-attack-expiry"],
      ["a malformed link (error state)", "/v#bm90LWEtbGluaw", "Landlord Bola", "ProofInvalid", "06-error-malformed"],
      ["a proof over a ledger root 44005 does not know (stale/resync state)", `/v#${testRoot}`, BOT, "UnknownRoot", "07-inconclusive-unknown-root"],
    ];
    for (const [what, path, reader, want, shot] of attacks) {
      const got = await verifyAs(judge, path, reader);
      if (got.code !== want) throw new Error(`${what}: ${got.verdict} ${got.code}, expected ${want}`);
      note(`${what} → ${got.verdict} ${got.code}: ${got.text.slice(0, 140)}`);
      await judge.shot(shotName(shot));
    }

    // README's browser-console snippet, pasted as a judge would, on the page that holds run 1's link.
    const SNIPPET = readFileSync(join(REPO, "README.md"), "utf8").match(/```js\n(.*)\n\s*```/)[1].trim();
    await judge.goto("/");
    await judge.goto(run1);
    await judge.type("input[name=reader]", "Landlord Bola");
    await judge.eval(SNIPPET);
    await judge.until(`!document.querySelector("[data-verdict]")`, 10_000, "the page to drop the old verdict");
    await judge.click("Verify");
    const pasted = await verdictOf(judge);
    if (pasted.code !== "ProofInvalid") throw new Error(`README console snippet: ${pasted.verdict} ${pasted.code}, expected ProofInvalid`);
    note(`README console snippet (threshold → 4 tUSD8) pasted on the page → ${pasted.verdict} ${pasted.code}`);
    await judge.shot(shotName("07b-attack-console-snippet"));

    await judge.goto("/v");
    await judge.until(`document.querySelector(".card.empty")`, 60_000, "empty state on /v");
    note(`/v with no fragment (empty state): ${await judge.eval(`document.querySelector(".card.empty").innerText.replace(/\\s+/g, " ")`)}`);
    await judge.shot(shotName("08-empty-v"));

    // D36: the reader code card. The code is masked before the screenshot and never written to the report.
    await judge.click("Get a code to give the person proving to you");
    await judge.until(`document.querySelector(".reader-code")`, 10_000, "the reader code");
    const code = await judge.eval(`document.querySelector(".reader-code").innerText.trim()`);
    if (!/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/.test(code)) throw new Error(`reader code: not 16 Crockford characters in 4 groups (${code.length} chars)`);
    await judge.eval(`document.querySelector(".reader-code").innerText = "XXXX-XXXX-XXXX-XXXX (masked in this screenshot)"`);
    note(`/v "Get a code to give the person proving to you": a 16-character Crockford code in 4 groups, shown once (not written here; masked in the screenshot)`);
    await judge.shot(shotName("08b-reader-code"));
    await judge.click("Done, hide it");
    await judge.until(`!document.querySelector(".reader-code")`, 5_000, "the code hidden");

    await judge.goto("/app");
    note(`/app in a fresh profile (no vault, no wallet): ${(await judge.eval(`document.querySelector("main").innerText.replace(/\\s+/g, " ")`)).slice(0, 200)}`);
    await judge.shot(shotName("09-dashboard-fresh"));

    const bot = [
      [botLink, "rent-check", true, "APPROVE()", "10-bot-approve"],
      [botLink, "revenue-credit", true, "DECLINE(BelowMinThreshold,TooFewPayments,PeriodTooShort)", "11-bot-decline"],
      [`${BASE}${run1}`, "rent-check", false, "DECLINE(WrongReader)", "12-bot-wrong-reader"],
    ];
    for (const [link, preset, prefilled, want, shot] of bot) {
      const d = await decide(judge, link, preset, prefilled);
      if (`${d.kind}(${d.codes})` !== want) throw new Error(`bot ${preset}: ${d.kind}(${d.codes}), expected ${want}`);
      note(`bot ${preset}${prefilled ? " (sample URL, form prefilled)" : ""} → ${d.kind}${d.codes ? ` (${d.codes})` : ""}: ${d.text.slice(0, 160)}`);
      await judge.shot(shotName(shot));
    }
  });
  note(`browser: ${execFileSync(CHROMIUM, ["--version"], { encoding: "utf8" }).trim()} headless; nothing was recorded or sent`);
}

const report = (ok, extra = "") => `# The judge path on the live site (${WIDTH} px)\n\nGenerated by \`node tools/ui-judge-live.mjs --width ${WIDTH} --base ${BASE}\`. Do not edit by hand. Read-only: no wallet, no transaction ("Record check" is never pressed; Check on-chain is an eth_call). Personas are demo.\n\nResult: ${ok ? "passed" : `FAILED${extra}`}\n\n${log.map((l) => `- ${l}`).join("\n")}\n`;
main().then(
  () => { writeFileSync(join(OUT, `report-${WIDTH}.md`), report(true)); process.exit(0); },
  (e) => { note(`FAILED: ${e.message}`); writeFileSync(join(OUT, `report-${WIDTH}-FAILED-${Date.now()}.md`), report(false, `: ${e.message}`)); process.exit(1); },
);
