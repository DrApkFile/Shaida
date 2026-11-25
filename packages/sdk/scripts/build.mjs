// Builds dist/: one ESM bundle (Shaida's own code from packages/shaida-proofs and shaida-underwrite, the final vkey,
// the presets, and viem's sha256 helpers inlined; snarkjs, ffjavascript, zod and poseidon-lite left as dependencies)
// and the public .d.ts files. Refuses a declaration that reaches outside the package, and a bundle that inlined a
// GPL dependency.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const dist = join(pkg, "dist");
const EXTERNAL = ["snarkjs", "ffjavascript", "zod", "poseidon-lite"];
rmSync(dist, { recursive: true, force: true });
rmSync(join(pkg, "build"), { recursive: true, force: true });

const result = await build({
  entryPoints: [join(pkg, "src/index.ts")],
  outfile: join(dist, "index.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: EXTERNAL,
  alias: { viem: join(pkg, "src/viem-shim.ts") },
  mainFields: ["module", "main"],
  metafile: true,
  legalComments: "eof",
  banner: { js: "// shaida-sdk 0.1.0 (MIT). Bundles Shaida's own MIT code and parts of viem / @noble/hashes (MIT). See NOTICE.md." },
  logLevel: "warning",
});
const inputs = Object.keys(result.metafile.inputs);
const gpl = inputs.filter((p) => /node_modules\/(\.pnpm\/)?(snarkjs|ffjavascript|circomlib|circom_runtime|r1csfile|wasmcurves|wasmbuilder)/.test(p));
if (gpl.length) throw new Error(`the bundle inlined GPL code: ${gpl.join(", ")}`);
const owner = (p) => {
  const m = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(p);
  if (m) return `${m[1]} (npm)`;
  if (p.startsWith("../shaida-proofs/")) return "@shaida/proofs (workspace, MIT)";
  if (p.startsWith("../shaida-underwrite/")) return "@shaida/underwrite (workspace, MIT)";
  if (p.startsWith("../../config/")) return "config/underwrite-policies.json (Shaida, MIT)";
  if (p.startsWith("src/")) return "shaida-sdk (MIT)";
  return p;
};
const packages = [...new Set(inputs.map(owner))].sort();
writeFileSync(join(pkg, "build-inputs.json"), `${JSON.stringify({ note: "what dist/index.js inlines (esbuild metafile); written by scripts/build.mjs", packages }, null, 2)}\n`);

execFileSync(process.execPath, [join(pkg, "node_modules/typescript/bin/tsc"), "-p", join(pkg, "tsconfig.build.json")], { stdio: "inherit" });
// tsc mirrors the common root of every input (the repo, because of config/underwrite-policies.json): find sdk/src in it.
const typesDir = [join(pkg, "build/types/sdk/src"), join(pkg, "build/types/packages/sdk/src")].find((d) => existsSync(join(d, "index.d.ts")));
if (!typesDir) throw new Error("tsc wrote no sdk/src/index.d.ts");
mkdirSync(dist, { recursive: true });
// Relative specifiers get ".js" so the declarations resolve under moduleResolution node16 / nodenext as well.
for (const f of readdirSync(typesDir).filter((f) => f.endsWith(".d.ts"))) {
  const text = readFileSync(join(typesDir, f), "utf8").replace(/(from\s+|import\()(["'])(\.\/[^"']+?)(?<!\.js)\2/g, "$1$2$3.js$2");
  writeFileSync(join(dist, f), text);
}
const shipped = new Set(["index.d.ts"]);
const queue = ["index.d.ts"];
while (queue.length) {
  const f = queue.pop();
  const text = readFileSync(join(dist, f), "utf8");
  for (const [, spec] of text.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)) {
    if (!spec.startsWith("./")) throw new Error(`${f} imports ${spec}: a published declaration must not reach outside the package`);
    const next = `${spec.slice(2).replace(/\.js$/, "")}.d.ts`;
    if (!shipped.has(next)) { shipped.add(next); queue.push(next); }
  }
}
for (const f of readdirSync(dist).filter((f) => f.endsWith(".d.ts") && !shipped.has(f))) rmSync(join(dist, f));
rmSync(join(pkg, "build"), { recursive: true, force: true });
console.log(`✓ dist/index.js (${readFileSync(join(dist, "index.js")).length} bytes), declarations: ${[...shipped].sort().join(", ")}`);
console.log(`  inlined: ${packages.join(", ")}`);
