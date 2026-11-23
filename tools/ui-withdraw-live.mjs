#!/usr/bin/env node
// Checklist B (evidence/budget.md) on the live site: Ada (demo) restores her run-1 vault backup in headless Chromium
// at 390 px, picks her 3 swept notes in /app/withdraw and withdraws them in one batch to the forward address, then
// exports the updated backup. The Withdraw button is clicked at most once and never again, whatever happens; the
// backup is exported even after a failure, so the vault's withdrawal records are kept.
// The vault passphrase is read from ~/.config/shaida and goes to the page only over the DevTools protocol: never
// printed, logged, put in argv, a screenshot or a report (any message is scrubbed of it before it is written).
// Writes evidence/ui-44005/{390-00,390-01,390-02}*.png and report-withdraw-390.md.
// Usage: node tools/ui-withdraw-live.mjs --base https://shaida.onrender.com --to 0x…
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep, withChromium } from "./ui-cdp.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", "https://shaida.onrender.com");
const TO = arg("to", "");
const WIDTH = 390;
const REPO = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(REPO, "evidence/ui-44005");
const PRIVATE = join(homedir(), ".config/shaida");
const BACKUP_IN = join(PRIVATE, "ada-live-run-1.vault.json");
const BACKUP_OUT = join(PRIVATE, "ada-after-batch.vault.json");
const EXPECTED = ["0.5", "1", "1.5"];
const PASS = readFileSync(join(PRIVATE, "ada-live-run-1.vault-passphrase"), "utf8").trim();
const scrub = (s) => String(s).split(PASS).join("[redacted]");
const log = [];
const note = (s) => { const line = `${new Date().toISOString()} ${scrub(s)}`; log.push(line); console.log(line); };
let clicked = false;

async function exportBackup(c, ada, target) {
  const dl = mkdtempSync(join(PRIVATE, "dl-")); // inside the mode-700 folder
  try {
    await c.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl, browserContextId: ada.browserContextId });
    await ada.click("Export backup");
    const file = join(dl, "shaida-vault-44005.json");
    for (let i = 0; i < 100 && !existsSync(file); i++) await sleep(200);
    if (!existsSync(file)) throw new Error("Export backup produced no file");
    await sleep(500);
    chmodSync(file, 0o600);
    const blob = JSON.parse(readFileSync(file, "utf8"));
    const keys = Object.keys(blob).sort().join(",");
    if (keys !== "ct,iterations,iv,kdf,salt,v" || blob.kdf !== "PBKDF2-SHA256") throw new Error(`the export is not a sealed vault blob (${keys})`);
    if (existsSync(target)) throw new Error(`${target} exists already; not overwritten (the export is left in ${dl})`);
    renameSync(file, target);
    chmodSync(target, 0o600);
    note(`backup exported to ${target} (mode 600, sealed blob, ${readFileSync(target).length} bytes)`);
  } finally {
    if (!existsSync(join(dl, "shaida-vault-44005.json"))) rmSync(dl, { recursive: true, force: true });
  }
}

async function main() {
  if (!/^0x[0-9a-fA-F]{40}$/.test(TO)) throw new Error("--to must be an address");
  mkdirSync(OUT, { recursive: true });
  await withChromium({ chromium: "/usr/bin/chromium", port: 9337, base: BASE, out: OUT, note }, async (c, page) => {
    const ada = await page("ada", { width: WIDTH });
    // W0 restore
    await ada.goto("/app/withdraw");
    await ada.until(`document.querySelector("details summary")`, 120_000, "the vault box");
    const heading = await ada.eval(`document.querySelector(".card h2")?.innerText ?? ""`);
    if (heading !== "Create your vault") throw new Error(`expected a fresh profile ("Create your vault"), saw "${heading}"`);
    await ada.eval(`document.querySelector("details summary").click()`);
    const { root } = await ada.send("DOM.getDocument", {});
    const { nodeId } = await ada.send("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
    await ada.send("DOM.setFileInputFiles", { nodeId, files: [BACKUP_IN] });
    await ada.type("input[type=password]", PASS);
    await ada.click("Restore");
    await ada.until(`document.querySelector(".vault-bar") || document.querySelector("[role=alert]")`, 120_000, "vault open");
    if (!(await ada.eval(`!!document.querySelector(".vault-bar")`))) throw new Error(`restore refused: ${await ada.eval(`document.querySelector("[role=alert]").innerText`)}`);
    note("W0 vault restored from ada-live-run-1.vault.json");

    // W1 pick: exactly 3 notes, 1.5 / 1 / 0.5, each in the pool
    await ada.until(`document.querySelectorAll(".withdraw-note").length >= 3 || document.querySelector("section[aria-labelledby=withdraw] [role=alert]")`, 180_000, "3 swept notes");
    await ada.until(`[...document.querySelectorAll(".withdraw-note .state")].every(s => s.innerText === "in the pool") || document.querySelector("section[aria-labelledby=withdraw] [role=alert]")`, 120_000, "notes checked on chain");
    await sleep(3_000);
    const notes = await ada.eval(`[...document.querySelectorAll(".withdraw-note")].map(li => li.innerText.replace(/\\s+/g, " ").trim())`);
    note(`W1 notes listed: ${notes.join(" | ")}`);
    await ada.shot(`${WIDTH}-00-vault-restored`);
    const amounts = notes.map((t) => /([0-9.]+) tUSD8/.exec(t)?.[1]).sort();
    if (notes.length !== 3 || JSON.stringify(amounts) !== JSON.stringify(EXPECTED) || !notes.every((t) => t.includes("in the pool"))) throw new Error(`expected 3 notes 1.5 / 1 / 0.5 in the pool, saw ${notes.length}: ${notes.join(" | ")}`);
    const warning = await ada.eval(`document.querySelector(".notice.warn strong")?.innerText ?? ""`);
    if (warning !== "Withdrawals are public and reveal their amounts.") throw new Error(`warning not shown (saw "${warning}")`);
    note(`W1 warning shown: "${warning}"`);
    await ada.eval(`document.querySelectorAll(".withdraw-note input[type=checkbox]").forEach(b => { if (!b.checked) b.click(); })`);
    await ada.type("input[name=to]", TO);
    await sleep(500);
    const label = await ada.eval(`[...document.querySelectorAll("section[aria-labelledby=withdraw] button")].map(b => b.innerText.trim()).find(t => t.startsWith("Withdraw")) ?? ""`);
    const toValue = await ada.eval(`document.querySelector("input[name=to]").value`);
    if (label !== "Withdraw 3 notes (3 tUSD8)" || toValue !== TO) throw new Error(`not ready: button "${label}", recipient ${toValue}`);
    await ada.shot(`${WIDTH}-01-withdraw-picked`);
    // W2 withdraw: one click, never again
    clicked = true;
    note(`W2 click "${label}" (once) → ${TO}`);
    await ada.click("Withdraw 3 notes (3 tUSD8)");
    try {
      await ada.until(`[...document.querySelectorAll(".withdraw-note .state")].filter(s => s.innerText.startsWith("withdrawn")).length === 3 || document.querySelector("section[aria-labelledby=withdraw] [role=alert]")`, 1_800_000, "3 withdrawn");
      const alert = await ada.eval(`document.querySelector("section[aria-labelledby=withdraw] [role=alert]")?.innerText ?? ""`);
      note(`W2 states: ${(await ada.eval(`[...document.querySelectorAll(".withdraw-note")].map(li => li.innerText.replace(/\\s+/g, " ").trim())`)).join(" | ")}`);
      if (alert) throw new Error(`withdraw stopped: ${alert}`);
      await ada.shot(`${WIDTH}-02-withdrawn`);
    } finally {
      // W3: the updated backup, even after a failure (it records what was sent)
      await exportBackup(c, ada, clicked && log.some((l) => l.includes("390-02-withdrawn")) ? BACKUP_OUT : join(PRIVATE, `ada-after-batch-FAILED-${Date.now()}.vault.json`));
    }
  });
}

const report = (ok, extra = "") => `# Withdrawal batch on Aevum testnet through the live site (${WIDTH} px)\n\nGenerated by \`node tools/ui-withdraw-live.mjs --base ${BASE} --to ${TO}\` (headless Chromium, the agent). Personas are demo. Checklist B in evidence/budget.md. The vault passphrase was passed to the page over CDP only and appears nowhere here.\n\nResult: ${ok ? "passed" : `FAILED${scrub(extra)}`}${clicked ? "" : " (the Withdraw button was not clicked; nothing sent)"}\n\n${log.map((l) => `- ${l}`).join("\n")}\n`;
main().then(
  () => { writeFileSync(join(OUT, `report-withdraw-${WIDTH}.md`), report(true)); process.exit(0); },
  (e) => { note(`FAILED: ${e.message}`); writeFileSync(join(OUT, `report-withdraw-${WIDTH}-FAILED-${Date.now()}.md`), report(false, `: ${e.message}`)); process.exit(1); },
);
