#!/usr/bin/env node
// Drives the real /pay and /inbox UI on `make fork` in headless Chromium at 390 px wide (CLAUDE.md), with two
// isolated browser profiles: Acme Studio (demo) pays Ada (demo) once through the UI, Ada sweeps it in the UI.
// Writes screenshots and a report to evidence/ui-fork/. No dependencies: Node's WebSocket speaks CDP.
// Usage: node tools/ui-flow-fork.mjs [--base http://localhost:3100] [--chromium /usr/bin/chromium]
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:3100");
const CHROMIUM = arg("chromium", "/usr/bin/chromium");
const RPC = "http://127.0.0.1:8555";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(REPO, "evidence/ui-fork");
const PORT = 9333;
const WIDTH = 390;
const PASS = "demo passphrase 1";
const log = [];
const note = (s) => { log.push(`${new Date().toISOString()} ${s}`); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 300; i++) { // up to 60 s: a loaded machine starts chromium slowly
    try { return (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(200); } // not listening yet
  }
  throw new Error("chromium did not open its debugging port");
}

function cdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      const { ok, bad } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? bad(new Error(`${msg.error.message} ${msg.error.data ?? ""}`)) : ok(msg.result);
    }
  };
  const ready = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}, sessionId) => ready.then(() => new Promise((ok, bad) => { const n = ++id; waiting.set(n, { ok, bad }); ws.send(JSON.stringify({ id: n, method, params, sessionId })); }));
  return { send, close: () => ws.close() };
}

async function page(c, name) {
  const { browserContextId } = await c.send("Target.createBrowserContext"); // its own localStorage: one vault each
  const { targetId } = await c.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await c.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => c.send(m, p, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 844, deviceScaleFactor: 2, mobile: true });
  const evaluate = async (expression) => {
    const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${name}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const p = {
    name,
    goto: async (path) => { await s("Page.navigate", { url: BASE + path }); await p.until(`document.readyState === "complete" && !!document.querySelector("main")`, 120_000, `load ${path}`); },
    eval: evaluate,
    until: async (expr, ms, what) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await evaluate(`Boolean(${expr})`)) return;
        await sleep(400);
      }
      const alerts = await evaluate(`[...document.querySelectorAll('[role=alert]')].map(e => e.innerText).join(' | ')`);
      throw new Error(`${name}: timed out waiting for ${what}${alerts ? `; on screen: ${alerts}` : ""}`);
    },
    type: async (sel, value) => { await p.until(`document.querySelector(${JSON.stringify(sel)})`, 60_000, sel); return evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error("no ${sel}");
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); })()`); },
    click: async (text) => {
      await p.until(`[...document.querySelectorAll("button")].some(b => b.innerText.trim().startsWith(${JSON.stringify(text)}) && !b.disabled)`, 60_000, `button "${text}"`);
      await evaluate(`[...document.querySelectorAll("button")].find(b => b.innerText.trim().startsWith(${JSON.stringify(text)}) && !b.disabled).click()`);
    },
    shot: async (label) => {
      const overflow = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
      const { data } = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      writeFileSync(join(OUT, `${label}.png`), Buffer.from(data, "base64"));
      note(`screenshot ${label}.png (horizontal overflow ${overflow}px)`);
      if (overflow > 0) throw new Error(`${label}: page is ${overflow}px wider than ${WIDTH}px`);
    },
  };
  return p;
}

const cast = (...a) => execFileSync("cast", [...a, "--rpc-url", RPC], { encoding: "utf8" }).trim();

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (cast("chain-id") !== "440050") throw new Error("not make fork");
  const chrome = spawn(CHROMIUM, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "shaida-ui-"))}`, "--no-first-run", "--no-sandbox"], { stdio: "ignore" });
  try {
    const c = cdp(await connect());
    const ada = await page(c, "ada");
    const acme = await page(c, "acme");

    await ada.goto("/");
    await ada.until(`document.body.innerText.includes("sha256 match") && document.body.innerText.includes("ledger leaves")`, 120_000, "home checks");
    await ada.shot("01-home");

    await ada.goto("/inbox");
    await ada.type('input[type=password]', PASS);
    await ada.click("Create vault");
    await ada.click("Create receive address");
    await ada.until(`document.querySelector(".receive-tag")`, 30_000, "receive address");
    const tag = await ada.eval(`document.querySelector(".receive-tag").innerText.trim()`);
    note(`Ada (demo) receive address ${tag.slice(0, 24)}…`);
    await ada.shot("02-inbox-empty");

    await acme.goto("/pay");
    await acme.type('input[type=password]', PASS);
    await acme.click("Create vault");
    await acme.click("Acme Studio (demo)");
    await acme.click("Create Acme Studio (demo)");
    await acme.until(`document.querySelector("dd.mono")`, 30_000, "demo payer address");
    const payer = await acme.eval(`document.querySelector("dd.mono").innerText.trim()`);
    execFileSync("make", ["-s", "register-payer", `TO=${payer}`, "NAME=Acme Studio (demo)"], { cwd: REPO, stdio: "inherit" });
    const mm = "0x4d4b7031D35B74215bebe33F6AF6e682Ea99d0b1";
    cast("rpc", "anvil_impersonateAccount", mm);
    cast("send", "0x456569838f1d43009A91ebA4263147Afd7233483", "mint(address,uint256)", payer, "20000000", "--from", mm, "--unlocked", "--legacy");
    note(`Acme Studio (demo) ${payer}: registered, 20 tUSD8 minted, tQDAY ${cast("balance", payer)} wei`);
    await acme.until(`document.body.innerText.includes("yes, #")`, 30_000, "registered payer");
    await acme.shot("03-pay-ready");

    await acme.type('#deposit ~ form input, section[aria-labelledby=deposit] input', "10");
    await acme.click("Deposit privately");
    await acme.until(`document.querySelectorAll("section[aria-labelledby=deposit] .step.done").length === 5 || document.querySelector("section[aria-labelledby=deposit] [role=alert]")`, 240_000, "deposit");
    const depAlert = await acme.eval(`document.querySelector("section[aria-labelledby=deposit] [role=alert]")?.innerText ?? ""`);
    if (depAlert) throw new Error(`deposit refused: ${depAlert}`);
    note("deposit: all 5 steps done");
    await acme.until(`document.querySelector(".total")?.innerText.startsWith("10 ")`, 90_000, "private balance 10");
    await acme.shot("04-deposited");

    await acme.type("section[aria-labelledby=pay] textarea", tag);
    await acme.type("section[aria-labelledby=pay] input[inputmode=decimal]", "3");
    await acme.type("section[aria-labelledby=pay] input:not([inputmode])", "Invoice 1 (demo)");
    await acme.click("Pay privately");
    await acme.until(`document.querySelectorAll("section[aria-labelledby=pay] .step.done").length === 6 || document.querySelector("section[aria-labelledby=pay] [role=alert]")`, 300_000, "pay");
    const payAlert = await acme.eval(`document.querySelector("section[aria-labelledby=pay] [role=alert]")?.innerText ?? ""`);
    if (payAlert) throw new Error(`pay refused: ${payAlert}`);
    note("vouched pay + memo: all 6 steps done");
    await acme.shot("05-paid");

    await ada.goto("/inbox");
    await ada.type('input[type=password]', PASS);
    await ada.click("Unlock");
    await ada.until(`[...document.querySelectorAll(".payment")].some(p => p.innerText.includes("Invoice 1 (demo)"))`, 120_000, "payment in inbox");
    await ada.shot("06-inbox-seen");
    await ada.click("Sweep");
    await ada.until(`[...document.querySelectorAll(".payment")].some(p => p.innerText.includes("Invoice 1 (demo)") && p.querySelector(".state.swept")) || document.querySelector("section[aria-labelledby=payments] [role=alert]")`, 300_000, "swept");
    const sweepAlert = await ada.eval(`document.querySelector("section[aria-labelledby=payments] [role=alert]")?.innerText ?? ""`);
    if (sweepAlert) throw new Error(`sweep refused: ${sweepAlert}`);
    note("sweep: swept (S leaf with Ada's fresh note seen in the checked ledger tree)");
    await ada.shot("07-inbox-swept");
    c.close();
  } finally {
    chrome.kill();
  }
}

main().then(
  () => { writeFileSync(join(OUT, "report.md"), `# UI flow on make fork (390 px)\n\nResult: passed\n\n${log.map((l) => `- ${l}`).join("\n")}\n`); process.exit(0); },
  (e) => { note(`FAILED: ${e.message}`); writeFileSync(join(OUT, `report-FAILED-${Date.now()}.md`), `# UI flow on make fork (390 px)\n\nResult: FAILED\n\n${log.map((l) => `- ${l}`).join("\n")}\n`); process.exit(1); },
);
