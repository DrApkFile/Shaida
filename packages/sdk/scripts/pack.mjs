// Makes the tarball to publish (nothing is published): builds dist/, stages dist/, README.md, NOTICE.md and LICENSE
// with a publish manifest, and runs npm pack there. The manifest has no devDependencies and no scripts: the dev side
// names private workspace packages (@shaida/proofs, @shaida/underwrite) under an npm scope that is not Shaida's (D34),
// and an integrator needs neither. Usage: pnpm --filter shaida-sdk tarball [-- <destination dir>]
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = fileURLToPath(new URL("..", import.meta.url));
const KEEP = ["name", "version", "description", "license", "type", "sideEffects", "engines", "exports", "main", "types", "files", "keywords", "repository", "dependencies"];

/** The package.json that ships: the working manifest's public fields only. */
export function publishManifest(pkg) {
  const out = {};
  for (const k of KEEP) {
    if (!(k in pkg)) throw new Error(`publishManifest: package.json has no "${k}"`);
    out[k] = pkg[k];
  }
  const text = JSON.stringify(out);
  if (/workspace:|@shaida\//.test(text)) throw new Error("publishManifest: a workspace or @shaida/ specifier would ship");
  return out;
}

/** Builds, stages and packs; returns npm pack's JSON entry with the tarball's absolute path. */
export function packTarball(dest, env = process.env) {
  const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  run(process.execPath, ["scripts/build.mjs"], PKG);
  const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
  const stage = join(PKG, "build/stage");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const f of pkg.files) cpSync(join(PKG, f), join(stage, f), { recursive: true });
  writeFileSync(join(stage, "package.json"), `${JSON.stringify(publishManifest(pkg), null, 2)}\n`);
  mkdirSync(dest, { recursive: true });
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", dest], stage))[0];
  return { ...packed, path: join(dest, packed.filename) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k) && k !== "PNPM_SCRIPT_SRC_DIR"));
  const p = packTarball(resolve(process.argv[2] ?? PKG), env);
  console.log(`${p.path}: ${p.size} bytes packed, ${p.entryCount} files, ${p.integrity}`);
  process.exit(0);
}
