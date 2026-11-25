#!/usr/bin/env node
// Adds the Revocations deploy (D35) to deployments/<network>.json from its DeployRevocations broadcast, after checking
// the receipt and the contract against the chain itself (the broadcast is a claim, the RPC is the evidence):
// exactly one create, mined, legacy, code at the address, wired to the file's PoseidonT3, saltOf(1) equal to
// poseidon-lite's value, nothing revoked. Writes the `revocations` entry only; every other field is kept as it was.
// Usage: node tools/write-revocations.mjs --chain 44005 --rpc https://rpc-test.qday.info --out deployments/aevum.json
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const CHAINS = [44005, 440050];
// cast sig "poseidon2()" / "saltOf(uint256)" / "revokedAt(uint256)"
const POSEIDON2_SELECTOR = "0xca5ee4b2";
const SALT_OF_SELECTOR = "0x8c9d5a77";
const REVOKED_AT_SELECTOR = "0x871bd456";
const SALT_OF_1 = "0c9d5facc929a65bc38007fe19281760a02ac15f4b85bff641d65d156d4c213d";

const fail = (m) => {
  console.error(`✗ write-revocations: ${m}`);
  process.exit(1);
};
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const chainId = Number(arg("chain"));
const rpcUrl = arg("rpc");
const out = arg("out") && resolve(ROOT, arg("out"));
if (!CHAINS.includes(chainId) || !rpcUrl || !out) fail("usage: --chain <44005|440050> --rpc <url> --out <deployment file>");

async function rpc(method, params) {
  const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!res.ok) fail(`${method} HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) fail(`${method}: ${body.error.message}`);
  return body.result;
}
const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const word = (n) => BigInt(n).toString(16).padStart(64, "0");

// The selectors above are checked against cast, so a typo cannot read the wrong function.
for (const [sig, sel] of [["poseidon2()", POSEIDON2_SELECTOR], ["saltOf(uint256)", SALT_OF_SELECTOR], ["revokedAt(uint256)", REVOKED_AT_SELECTOR]]) {
  const real = execFileSync("cast", ["sig", sig], { encoding: "utf8" }).trim();
  if (real !== sel) fail(`selector of ${sig} is ${real}, not ${sel}`);
}

const record = JSON.parse(readFileSync(out, "utf8"));
if (record.chainId !== chainId) fail(`${out} is chain ${record.chainId}, not ${chainId}`);
if (record.revocations) fail(`${out} already records Revocations at ${record.revocations.address}: refusing to overwrite`);
const poseidonT3 = record.contracts?.PoseidonT3?.address?.toLowerCase();
if (!poseidonT3) fail(`${out} has no PoseidonT3`);

const broadcastFile = join(ROOT, `contracts/broadcast/DeployRevocations.s.sol/${chainId}/run-latest.json`);
const run = JSON.parse(readFileSync(broadcastFile, "utf8"));
if (Number(run.chain) !== chainId) fail(`broadcast is for chain ${run.chain}`);
if (run.pending?.length) fail(`broadcast has ${run.pending.length} pending txs: outcome unknown, not recording`);
if (run.transactions.length !== 1 || run.transactions[0].transactionType !== "CREATE" || run.transactions[0].contractName !== "Revocations") {
  fail(`expected exactly one create of Revocations, got ${run.transactions.map((t) => `${t.transactionType} ${t.contractName}`).join(", ")}`);
}
const tx = run.transactions[0];
if (Number(await rpc("eth_chainId", [])) !== chainId) fail(`the RPC is not chain ${chainId}`);
const receipt = await rpc("eth_getTransactionReceipt", [tx.hash]);
if (!receipt) fail(`no receipt for ${tx.hash}: outcome unknown, not recording`);
if (receipt.status !== "0x1") fail(`tx ${tx.hash} reverted`);
if (receipt.type !== "0x0") fail(`tx ${tx.hash} is type ${receipt.type}, not legacy`);
const address = receipt.contractAddress?.toLowerCase();
if (!address || address !== tx.contractAddress.toLowerCase()) fail("receipt and broadcast disagree on the address");
const code = await rpc("eth_getCode", [address, "latest"]);
if (!code || code === "0x") fail(`no code at ${address}`);
const call = (data) => rpc("eth_call", [{ to: address, data }, "latest"]);
const wired = `0x${(await call(POSEIDON2_SELECTOR)).slice(26)}`.toLowerCase();
if (wired !== poseidonT3) fail(`Revocations uses Poseidon ${wired}, not the deployment's PoseidonT3 ${poseidonT3}`);
if ((await call(`${SALT_OF_SELECTOR}${word(1)}`)).slice(2) !== SALT_OF_1) fail("saltOf(1) differs from poseidon-lite");
if (BigInt(await call(`${REVOKED_AT_SELECTOR}${SALT_OF_1}`)) !== 0n) fail("the fresh contract already has a revocation");

const gitDirty = git(["status", "--porcelain"]).length > 0;
if (chainId === 44005 && gitDirty) fail("refusing to record an Aevum deploy from a dirty tree");
record.revocations = {
  address,
  txHash: tx.hash,
  block: Number(receipt.blockNumber),
  gasUsed: Number(receipt.gasUsed),
  deployer: receipt.from.toLowerCase(),
  poseidonT3,
  gitCommit: git(["rev-parse", "HEAD"]),
  gitDirty,
  check: "PoseidonT3 vector, saltOf(1) = poseidon-lite, nothing revoked; read back from the chain",
  broadcastFile: broadcastFile.slice(ROOT.length + 1),
  recordedAt: new Date().toISOString(),
};
writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
console.log(`✓ ${out.slice(ROOT.length + 1)}: Revocations at ${address}, block ${record.revocations.block}, ${record.revocations.gasUsed} gas`);
