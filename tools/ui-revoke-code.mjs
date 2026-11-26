#!/usr/bin/env node
// /v with revocation (D35) and reader codes (D36) in headless Chromium, on the app built for `make fork`, over the
// links of the privacy fixture's --revoke run (tools/privacy/fixtures/fork-truth-revoke.json). Read-only: no wallet,
// no transaction. Writes <out>/report-<width>.md and screenshots.
//   1. "Get a code to give the person proving to you": a 16-character Crockford code, shown once, hidden on Done.
//   2. Ada's code-protected link (for "Landlord Bola"): labelled code-protected and revocable, asks for a code; the
//      name alone and a wrong code are WrongReader, with the code-protected words. (VALID needs Bola's real code,
//      which the fixture never kept: the live check and test RC01.)
//   3. Chidi's revoked name-only link (for "Lender Dayo"): labelled name only; Verify is REVOKED with block and time.
//   4. Run 1's v1 link from 44005: labelled name only and not revocable (made before revocation existed).
// Usage: node tools/ui-revoke-code.mjs [--width 390] [--base http://localhost:3100] [--out evidence/revoke-code-ui]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withChromium } from "./ui-cdp.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:3100");
const WIDTH = Number(arg("width", "390"));
const REPO = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(REPO, arg("out", "evidence/revoke-code-ui"));
const truth = JSON.parse(readFileSync(join(REPO, "tools/privacy/fixtures/fork-truth-revoke.json"), "utf8"));
const run1 = JSON.parse(readFileSync(join(REPO, "evidence/live-44005-run1.json"), "utf8")).link;
const linkOf = (name) => truth.links.find((l) => l.name === name).from.url;
const log = [];
const note = (s) => { log.push(`${new Date().toISOString()} ${s}`); console.log(s); };
const hashOf = (link) => link.slice(link.indexOf("#"));

const verdict = (p) => p.eval(`(() => { const e = document.querySelector("[data-verdict]"); return { verdict: e.dataset.verdict, code: e.dataset.code ?? "", text: e.innerText.replace(/\\s+/g, " ") }; })()`);
const label = (p) => p.eval(`(() => { const e = document.querySelector(".link-kind"); return e ? { mode: e.dataset.readerMode, revocable: e.dataset.revocable, text: e.innerText.replace(/\\s+/g, " ") } : null; })()`);

async function verify(p, reader, code, expect) {
  await p.type("input[name=reader]", reader);
  if (code !== null) await p.type("input[name=reader-code]", code);
  await p.click("Verify");
  await p.until(`document.querySelector("[data-verdict]")`, 240_000, "verdict");
  const v = await verdict(p);
  note(`  "${reader}"${code === null ? "" : ` + code "${code === "" ? "" : "a wrong code"}"`}: ${v.verdict} ${v.code}: ${v.text.slice(0, 240)}`);
  if (`${v.verdict} ${v.code}` !== expect) throw new Error(`expected ${expect}, got ${v.verdict} ${v.code}`);
  return v;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await withChromium({ chromium: "/usr/bin/chromium", port: 9338, base: BASE, out: OUT, note }, async (_c, page) => {
    const p = await page("reader", { width: WIDTH });

    note("1. the reader code card on /v");
    await p.goto("/v");
    await p.click("Get a code to give the person proving to you");
    await p.until(`document.querySelector(".reader-code")`, 10_000, "the code");
    const code = await p.eval(`document.querySelector(".reader-code").innerText.trim()`);
    if (!/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/.test(code)) throw new Error(`not a 16-character Crockford code: ${code.length} chars`);
    note(`  a code of 16 Crockford base32 characters in 4 groups is shown (not written here; masked in the screenshot), with Copy and "Done, hide it"`);
    // The screenshot shows the card with the code masked: a code is a secret even when it is thrown away.
    await p.eval(`document.querySelector(".reader-code").innerText = "XXXX-XXXX-XXXX-XXXX (masked in this screenshot)"`);
    await p.shot(`${WIDTH}-1-reader-code`);
    await p.click("Done, hide it");
    await p.until(`!document.querySelector(".reader-code")`, 5_000, "the code hidden");
    if (await p.eval(`!!document.querySelector(".reader-code")`)) throw new Error("the code is still shown after Done");
    const stored = await p.eval(`JSON.stringify(Object.keys(localStorage)) + JSON.stringify(Object.keys(sessionStorage))`);
    if (stored.includes(code) || (await p.eval(`JSON.stringify({...localStorage, ...sessionStorage})`)).includes(code)) throw new Error("the code is in browser storage");
    note(`  hidden on Done; not in localStorage or sessionStorage`);

    note("2. Ada's code-protected link (Landlord Bola)");
    await p.goto(`/v${hashOf(linkOf("ada"))}`);
    await p.until(`document.querySelector(".link-kind")`, 30_000, "the link's label");
    const l2 = await label(p);
    note(`  label: ${l2.text}`);
    if (l2.mode !== "code" || l2.revocable !== "true" || !l2.text.includes("Code-protected")) throw new Error("Ada's link is not labelled code-protected and revocable");
    if (!(await p.eval(`!!document.querySelector("input[name=reader-code]")`))) throw new Error("no reader code field");
    const v2 = await verify(p, "Landlord Bola", null, "INVALID WrongReader");
    if (!v2.text.includes("code-protected")) throw new Error("the WrongReader words do not say the link is code-protected");
    await p.shot(`${WIDTH}-2-code-link-name-only`);
    await p.goto(`/v${hashOf(linkOf("ada"))}`);
    await verify(p, "Landlord Bola", "0000-0000-0000-0001", "INVALID WrongReader");
    await p.shot(`${WIDTH}-2-code-link-wrong-code`);

    note("3. Chidi's revoked name-only link (Lender Dayo)");
    await p.goto(`/v${hashOf(linkOf("chidi"))}`);
    await p.until(`document.querySelector(".link-kind")`, 30_000, "the link's label");
    const l3 = await label(p);
    note(`  label: ${l3.text}`);
    if (l3.mode !== "name" || l3.revocable !== "true" || !l3.text.includes("Name only: anyone with this link and the name can view it")) throw new Error("Chidi's link label");
    const v3 = await verify(p, "Lender Dayo", null, "REVOKED ProofRevoked");
    const block = truth.revocations[0].block;
    if (!v3.text.includes(`block ${block}`)) throw new Error(`REVOKED does not name block ${block}`);
    await p.shot(`${WIDTH}-3-revoked`);

    note("4. run 1's v1 link (made on 44005 before revocation existed)");
    await p.goto(`/v${hashOf(run1)}`);
    await p.until(`document.querySelector(".link-kind")`, 30_000, "the link's label");
    const l4 = await label(p);
    note(`  label: ${l4.text}`);
    if (l4.mode !== "name" || l4.revocable !== "false" || !l4.text.includes("not revocable (made before revocation existed)")) throw new Error("run 1's link label");
    if (await p.eval(`!!document.querySelector("input[name=reader-code]")`)) throw new Error("a v1 link asks for a code");
    await p.shot(`${WIDTH}-4-v1-label`);
  });
}
const report = (ok, extra = "") => `# /v with revocation and reader codes (${WIDTH} px)\n\nGenerated by \`node tools/ui-revoke-code.mjs --width ${WIDTH} --base ${BASE}\` against a local \`next start\` built for \`make fork\` (chain 440050), over the links of the privacy fixture's \`--revoke\` run. Read-only: no wallet, no transaction. Personas are demo. Run 1's link is from 44005, so on the fork only its label is checked. VALID with a reader code needs the reader's real code, which nothing kept: it is the live check's step and test RC01.\n\nResult: ${ok ? "passed" : `FAILED${extra}`}\n\n${log.map((l) => `- ${l}`).join("\n")}\n`;
main().then(
  () => { writeFileSync(join(OUT, `report-${WIDTH}.md`), report(true)); process.exit(0); },
  (e) => { note(`FAILED: ${e.message}`); writeFileSync(join(OUT, `report-${WIDTH}-FAILED-${Date.now()}.md`), report(false, `: ${e.message}`)); process.exit(1); },
);
