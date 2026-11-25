#!/usr/bin/env node
// The reader's privacy audit (evidence/privacy-audit.md): what someone holding a proof link learns from it, alone
// and together with the public chain (a dump from privacy-observer.mjs collect). Offline and read-only.
// Links come from the truth file's `links[].from` ({url}; {file, key}: a JSON file and a dotted key holding a /v…#… URL;
// or {attest}: a proof rebuilt from an attest tx's calldata, which carries no reader hash, expiry or salt), or from
// --link name=URL (repeatable). --reader-name tests names against each link's reader hash (repeatable).
// Usage (from the repo root):
//   node tools/privacy-reader.mjs --dump evidence/privacy-audit/dump-44005.json --truth evidence/privacy-audit/truth-44005.json --reader-name "Landlord Bola" --out evidence/privacy-audit/reader-44005.json
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "./privacy/src/tsx.mjs";

const { actionsOf } = await import("./privacy/src/decode.mjs");
const { jsonOut } = await import("./privacy/src/files.mjs");
const { analyseLinks, linkFromAttest, linkFromUrl, scoreLink } = await import("./privacy/src/reader.mjs");
const { renderReader } = await import("./privacy/src/report.mjs");
const REPO = fileURLToPath(new URL("..", import.meta.url));

const all = (n) => process.argv.flatMap((a, i) => (a === `--${n}` ? [process.argv[i + 1]] : []));
const one = (n) => all(n)[0];

async function main() {
  if (!one("dump")) throw new Error("--dump is required");
  const dump = JSON.parse(readFileSync(one("dump"), "utf8"));
  const truth = one("truth") ? JSON.parse(readFileSync(one("truth"), "utf8")) : null;
  const actions = await actionsOf(dump);
  const inputs = [];
  for (const l of truth?.links ?? []) {
    if (l.from?.url) inputs.push({ name: l.name, link: linkFromUrl(l.from.url) });
    else if (l.from?.attest) inputs.push({ name: l.name, link: linkFromAttest(actions, l.from.attest) });
    else if (l.from?.file) inputs.push({ name: l.name, link: linkFromUrl(l.from.key.split(".").reduce((o, k) => o[k], JSON.parse(readFileSync(`${REPO}${l.from.file}`, "utf8")))) });
    else throw new Error(`link ${l.name} has no usable source`);
  }
  for (const s of all("link")) { const i = s.indexOf("="); inputs.push({ name: s.slice(0, i), link: linkFromUrl(s.slice(i + 1)) }); }
  const results = await analyseLinks(dump, inputs, { readerNames: all("reader-name") });
  if (truth) for (const r of results) { const t = truth.links.find((l) => l.name === r.name); if (t) r.score = scoreLink(r, t, truth); }
  const out = { schema: "shaida-privacy-reader/1", chainId: dump.chainId, links: results };
  if (one("out")) writeFileSync(one("out"), jsonOut(out));
  console.log(renderReader(out));
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
