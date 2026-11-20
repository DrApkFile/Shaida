// Runs the S8 page in headless Chromium on this machine (DevTools protocol, no extra packages) and saves the report,
// with this machine's CPU and RAM, into results/. Usage: pnpm --filter @shaida/s8-bench headless [runs]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, hostname, tmpdir, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reportSchema } from "./src/report-schema.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = Number(process.argv[2] ?? 3);
const CHROMIUM = process.env.CHROMIUM ?? "chromium";
const PORT = 8089;
const fail = (msg: string): never => {
  console.error(`✗ s8 headless: ${msg}`);
  process.exit(1);
};

const server = spawn(process.execPath, ["--import", "tsx", join(HERE, "serve.ts")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise<void>((ok) => server.stdout!.on("data", (d: Buffer) => d.toString().includes("S8 bench on") && ok()));

const profile = mkdtempSync(join(tmpdir(), "s8-chromium-"));
const browser = spawn(CHROMIUM, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], {
  stdio: ["ignore", "ignore", "pipe"],
});
const wsUrl = await new Promise<string>((ok) => {
  let err = "";
  browser.stderr!.on("data", (d: Buffer) => {
    err += d.toString();
    const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) ok(m[1]!);
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
let nextId = 0;
const pending = new Map<number, (r: { result?: unknown; error?: unknown }) => void>();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: unknown };
  if (msg.id !== undefined) pending.get(msg.id)?.(msg);
});
function cdp<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((ok, ko) =>
    pending.set(id, (r) => (r.error ? ko(new Error(`${method}: ${JSON.stringify(r.error)}`)) : ok(r.result as T))),
  );
}

const version = await cdp<{ product: string }>("Browser.getVersion");
const cpu = cpus();
const label = `${hostname()}: ${cpu[0]?.model.replace(/\s+/g, " ")}, headless ${version.product}`;
const url = `http://127.0.0.1:${PORT}/?auto=1&nosave=1&runs=${RUNS}&label=${encodeURIComponent(label)}`;
const { targetId } = await cdp<{ targetId: string }>("Target.createTarget", { url });
const { sessionId } = await cdp<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });

const deadline = Date.now() + 60 * 60 * 1000;
let report: unknown = null;
while (report === null) {
  if (Date.now() > deadline) fail("no report after 60 minutes");
  await new Promise((r) => setTimeout(r, 5000));
  const r = await cdp<{ result: { value?: string } }>(
    "Runtime.evaluate",
    { expression: "JSON.stringify(window.__s8 ?? null)", returnByValue: true },
    sessionId,
  );
  report = JSON.parse(r.result.value ?? "null");
}
const withHost = {
  ...(report as object),
  host: {
    cpuModel: cpu[0]?.model.replace(/\s+/g, " ") ?? "—",
    logicalCpus: cpu.length,
    ramGiB: Math.round((totalmem() / 2 ** 30) * 10) / 10,
    browser: `headless ${version.product}`,
  },
};
const parsed = reportSchema.parse(withHost);
const file = join(HERE, "results", `${new Date().toISOString().replace(/[:.]/g, "-")}-headless.json`);
writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
console.log(`✓ ${file} (${parsed.runs.length} runs, ${parsed.errors.length} errors)`);
ws.close();
browser.kill();
server.kill();
rmSync(profile, { recursive: true, force: true });
process.exit(parsed.errors.length ? 1 : 0);
