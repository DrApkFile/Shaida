// Headless Chromium over the DevTools protocol for the UI flows (tools/ui-flow-*.mjs). No dependencies: Node's
// WebSocket speaks CDP. Each page() is its own browser context (own localStorage: one vault each).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(port) {
  for (let i = 0; i < 300; i++) { // up to 60 s: a loaded machine starts chromium slowly
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(200); } // not listening yet
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

/** Starts Chromium; `run(c, page)` drives it; the profile (in RAM-backed /tmp here) is removed afterwards. */
export async function withChromium({ chromium, port, base, out, note }, run) {
  const profile = mkdtempSync(join(tmpdir(), "shaida-ui-"));
  const chrome = spawn(chromium, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-sandbox"], { stdio: "ignore" });
  try {
    const c = cdp(await connect(port));
    await run(c, (name, opts) => page(c, name, { base, out, note, ...opts }));
    c.close();
  } finally {
    const exited = new Promise((r) => { chrome.once("exit", r); setTimeout(r, 5_000); });
    chrome.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true });
  }
}

async function page(c, name, { base, out, note, width = 390, init = null }) {
  const { browserContextId } = await c.send("Target.createBrowserContext");
  const { targetId } = await c.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await c.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => c.send(m, p, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  if (init) await s("Page.addScriptToEvaluateOnNewDocument", { source: init });
  const size = async (w) => s("Emulation.setDeviceMetricsOverride", { width: w, height: w < 768 ? 844 : 900, deviceScaleFactor: w < 768 ? 2 : 1, mobile: w < 768 });
  await size(width);
  let current = width;
  const evaluate = async (expression) => {
    const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${name}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const p = {
    name,
    send: s,
    browserContextId,
    resize: async (w) => { current = w; await size(w); await sleep(500); },
    goto: async (path) => { await s("Page.navigate", { url: base + path }); await p.until(`document.readyState === "complete" && !!document.querySelector("main")`, 120_000, `load ${path}`); },
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
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); })()`); },
    click: async (text) => {
      await p.until(`[...document.querySelectorAll("button")].some(b => b.innerText.trim().startsWith(${JSON.stringify(text)}) && !b.disabled)`, 60_000, `button "${text}"`);
      await evaluate(`[...document.querySelectorAll("button")].find(b => b.innerText.trim().startsWith(${JSON.stringify(text)}) && !b.disabled).click()`);
    },
    shot: async (label) => {
      const overflow = await evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
      const { data } = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      writeFileSync(join(out, `${label}.png`), Buffer.from(data, "base64"));
      note(`screenshot ${label}.png at ${current} px (horizontal overflow ${overflow}px)`);
      if (overflow > 0) throw new Error(`${label}: page is ${overflow}px wider than ${current}px`);
    },
  };
  return p;
}
