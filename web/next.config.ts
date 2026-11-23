import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

/** The commit this build is from, for /api/health: Render's RENDER_GIT_COMMIT, else git. Unknown stays unset ("—"). */
function buildCommit(): string | undefined {
  const fromHost = process.env.RENDER_GIT_COMMIT?.trim();
  if (fromHost && /^[0-9a-f]{40}$/.test(fromHost)) return fromHost;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (e) {
    console.warn(`next.config: no build commit (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
    return undefined;
  }
}
const commit = buildCommit();

/**
 * The proving files in public/ (copied at prebuild only when their sha256 matches the pins) are served with that
 * pin as a header and a one-day cache. The browser still hashes every byte and refuses a mismatch before proving.
 */
function circuitHeaders() {
  // next runs with web/ as its working directory
  const read = (p: string) => JSON.parse(readFileSync(resolve(process.cwd(), p), "utf8")) as Record<string, unknown>;
  const gloam = read("../packages/shaida-pay/gloam-artifacts.json") as Record<string, { wasm: { file: string; sha256: string }; zkey: { file: string; sha256: string } } | string>;
  const income = read("../packages/shaida-pay/income-artifacts.json") as Record<"wasm" | "zkey", { file: string; sha256: string }>;
  const files: { path: string; sha256: string }[] = [];
  for (const [name, c] of Object.entries(gloam)) {
    if (name === "note" || typeof c === "string") continue;
    for (const a of [c.wasm, c.zkey]) files.push({ path: `/gloam/${a.file}`, sha256: a.sha256 });
  }
  for (const a of [income.wasm, income.zkey]) files.push({ path: `/circuits/income/${a.file}`, sha256: a.sha256 });
  return files.map((f) => ({
    source: f.path,
    headers: [
      { key: "x-shaida-sha256", value: f.sha256 },
      { key: "cache-control", value: "public, max-age=86400" },
    ],
  }));
}

const config: NextConfig = {
  // The shared config package ships TypeScript source.
  transpilePackages: ["@aevum-kit/aevum", "@shaida/index", "@shaida/kv", "@shaida/proofs", "@shaida/relay", "@shaida/pay", "@shaida/underwrite"],
  // The underwriting bot verifies Groth16 on the server (D30): Node loads snarkjs and ffjavascript itself.
  serverExternalPackages: ["snarkjs", "ffjavascript"],
  env: commit ? { SHAIDA_BUILD_COMMIT: commit } : {},
  // No dev-mode badge over the page (screenshots in evidence/ui show the app only).
  devIndicators: false,
  // D26: the pay and inbox screens moved into the dashboard; old links keep working.
  async headers() {
    return circuitHeaders();
  },
  // D30: the underwriting bot's agent card lives at the well-known path.
  async rewrites() {
    return [{ source: "/.well-known/agent.json", destination: "/api/agent-card" }];
  },
  async redirects() {
    return [
      { source: "/pay", destination: "/app/pay", permanent: false },
      { source: "/inbox", destination: "/app/inbox", permanent: false },
    ];
  },
};

export default config;
