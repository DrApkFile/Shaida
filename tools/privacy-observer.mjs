#!/usr/bin/env node
// The observer's privacy audit (evidence/privacy-audit.md): what anyone with the explorer and an RPC learns about a
// Shaida deployment. Read-only: sends no transaction. Two steps:
//   collect  reads every tx and event touching the deployment's contracts (and tUSD8 one hop around the public
//            addresses they name) into a dump file. Needs the RPC.
//   analyse  decodes the dump, lists every public field by class, runs attacks A1–A6 and, given a ground truth,
//            scores them. Offline.
// Usage (from the repo root):
//   node tools/privacy-observer.mjs collect --deployment deployments/aevum.json --explorer https://explorer-test.qday.info --out evidence/privacy-audit/dump-44005.json
//   node tools/privacy-observer.mjs analyse --dump evidence/privacy-audit/dump-44005.json --truth evidence/privacy-audit/truth-44005.json --out evidence/privacy-audit/observer-44005.json
import { readFileSync, writeFileSync } from "node:fs";
import { collect } from "./privacy/src/collect.mjs";
import { deploymentOf, jsonOut } from "./privacy/src/files.mjs";
import { analyse } from "./privacy/src/observer.mjs";
import { renderObserver } from "./privacy/src/report.mjs";
import { rpcClient } from "./privacy/src/rpc.mjs";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const need = (n) => { const v = arg(n); if (!v) throw new Error(`--${n} is required`); return v; };

async function main() {
  const mode = process.argv[2];
  if (mode === "collect") {
    const dep = deploymentOf(JSON.parse(readFileSync(need("deployment"), "utf8")));
    const rpc = rpcClient(arg("rpc") ?? dep.rpc);
    const dump = await collect(rpc, dep, { explorer: arg("explorer"), toBlock: arg("to-block") ? BigInt(arg("to-block")) : undefined, log: (m) => console.error(`· ${m}`) });
    writeFileSync(need("out"), jsonOut(dump));
    console.log(`wrote ${arg("out")}: ${dump.txs.length} txs, ${dump.tokenHops.length} tUSD8 hops, blocks ${dump.fromBlock}–${dump.toBlock}`);
    return;
  }
  if (mode === "analyse") {
    const dump = JSON.parse(readFileSync(need("dump"), "utf8"));
    const truth = arg("truth") ? JSON.parse(readFileSync(arg("truth"), "utf8")) : null;
    const result = await analyse(dump, truth);
    if (arg("out")) writeFileSync(arg("out"), jsonOut(result));
    console.log(renderObserver(result));
    return;
  }
  throw new Error("usage: privacy-observer.mjs collect|analyse …");
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
