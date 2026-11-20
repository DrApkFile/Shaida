// One-line local server for spike S8: serves www/ and saves reports the page POSTs to /results into results/.
// Usage: pnpm --filter @shaida/s8-bench serve   (listens on 0.0.0.0:8088, so a phone on the same Wi-Fi can open it)
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reportSchema } from "./src/report-schema.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WWW = join(HERE, "www");
const PORT = Number(process.env.PORT ?? 8088);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".zkey": "application/octet-stream",
};
if (!existsSync(join(WWW, "index.html"))) {
  console.error("✗ www/ is not built: run `PTAU_PATH=… pnpm --filter @shaida/s8-bench build` first");
  process.exit(1);
}

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/results") {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > 256_000) req.destroy();
    });
    req.on("end", () => {
      let parsed;
      try {
        parsed = reportSchema.safeParse(JSON.parse(body));
      } catch {
        parsed = { success: false as const, error: new Error("not JSON") };
      }
      if (!parsed.success) {
        res.writeHead(400).end(`report refused: ${String(parsed.error).slice(0, 300)}`);
        return;
      }
      const file = join(HERE, "results", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      writeFileSync(file, `${JSON.stringify(parsed.data, null, 2)}\n`);
      console.log(`saved ${file} (${parsed.data.label || "no label"})`);
      res.writeHead(201).end("saved");
    });
    return;
  }
  const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!)).replace(/^(\.\.[/\\])+/, "");
  const file = resolve(WWW, `.${path.endsWith("/") ? `${path}index.html` : path}`);
  if (!file.startsWith(WWW) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`S8 bench on http://localhost:${PORT}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) console.log(`  same Wi-Fi: http://${a.address}:${PORT}`);
  }
});
