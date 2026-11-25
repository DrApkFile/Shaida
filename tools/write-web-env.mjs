#!/usr/bin/env node
// Writes NEXT_PUBLIC_SHAIDA_<NETWORK> (Shaida's contract addresses, JSON) into web/.env.local from a deployment
// record, keeping every other line of that file. NEXT_PUBLIC_* are build-time: restart `next dev` / rebuild after.
// Usage: node tools/write-web-env.mjs --network fork|aevum [--deployment deployments/fork.json] [--print]
//   --print: print the KEY=value line (for a host's env settings, DEPLOY_RENDER.md) and write nothing
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const fail = (m) => {
  console.error(`✗ write-web-env: ${m}`);
  process.exit(1);
};

const network = arg("network");
const CHAIN = { fork: 440050, aevum: 44005 };
if (!(network in CHAIN)) fail("--network must be fork or aevum");
const file = resolve(ROOT, arg("deployment") ?? `deployments/${network}.json`);
if (!existsSync(file)) fail(`${file} not found (deploy first)`);
const d = JSON.parse(readFileSync(file, "utf8"));
if (d.chainId !== CHAIN[network]) fail(`${file} is chain ${d.chainId}, expected ${CHAIN[network]}`);
const need = { pool: "ShieldPoolPoseidon", ledger: "ShaidaLedger", depositor: "ShaidaDepositor", registry: "PayerRegistry", memo: "GloamPayMemo", incomeVerifier: "IncomeVerifier" };
const contracts = {};
for (const [k, name] of Object.entries(need)) {
  const a = d.contracts?.[name]?.address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(a ?? "")) fail(`${name} has no address in ${file}`);
  contracts[k] = a;
}
// Revocations (D35) is deployed after the stack and recorded on its own (tools/write-revocations.mjs).
if (!/^0x[0-9a-fA-F]{40}$/.test(d.revocations?.address ?? "")) fail(`Revocations has no address in ${file} (make deploy-revocations-${network})`);
contracts.revocations = d.revocations.address;
if (!Number.isInteger(d.poolDeployBlock)) fail(`poolDeployBlock missing in ${file}`);
contracts.startBlock = String(d.poolDeployBlock);

const envPath = join(ROOT, "web/.env.local");
const key = `NEXT_PUBLIC_SHAIDA_${network.toUpperCase()}`;
if (process.argv.includes("--print")) {
  console.log(`${key}=${JSON.stringify(contracts)}`);
  process.exit(0);
}
const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split("\n").filter((l) => !l.startsWith(`${key}=`)) : [];
while (lines.length && lines.at(-1) === "") lines.pop();
lines.push(`${key}=${JSON.stringify(contracts)}`);
writeFileSync(envPath, lines.join("\n") + "\n");
console.log(`✓ web/.env.local: ${key} from ${file.slice(ROOT.length + 1)} (commit ${d.gitCommit}${d.gitDirty ? ", dirty" : ""})`);
