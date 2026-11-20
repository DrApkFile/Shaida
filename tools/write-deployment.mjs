#!/usr/bin/env node
// Writes deployments/<network>.json from a DeployStack broadcast, after checking every
// receipt and every contract's code against the chain itself (the broadcast file is a claim,
// the RPC is the evidence). Refuses on any mismatch; writes nothing partial.
// Usage: node tools/write-deployment.mjs --chain 44005 --rpc https://rpc-test.qday.info --out deployments/aevum.json
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const TUSD8 = "0x456569838f1d43009a91eba4263147afd7233483";
const NETWORKS = { 44005: "aevum-testnet", 440050: "aevum-fork" };
const EXPECTED_CREATES = [
  "PoseidonT3",
  "ShieldVerifierFinal",
  "ShieldIVerifierFinal",
  "UnshieldVerifierFinal",
  "UnshieldIVerifierFinal",
  "TransferVerifierFinal",
  "TransferIVerifierFinal",
  "DualProofVerifier",
  "ShieldPoolPoseidon",
  "GloamPayMemo",
];
const EXPECTED_SETUP_CALLS = [
  "turnOnDepositLimits()",
  "setShieldVerifier(address)",
  "setDepositLimit(address,uint128,uint128)",
  "endSetup()",
];
// cast sig "poseidon2()"
const POSEIDON2_SELECTOR = "0xca5ee4b2";

function fail(message) {
  console.error(`✗ write-deployment: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!["chain", "rpc", "out"].includes(key) || argv[i + 1] === undefined) {
      fail(`usage: --chain <44005|440050> --rpc <url> --out <file> (got ${argv[i]})`);
    }
    args[key] = argv[i + 1];
  }
  for (const k of ["chain", "rpc", "out"]) if (!args[k]) fail(`missing --${k}`);
  const chainId = Number(args.chain);
  if (!NETWORKS[chainId]) fail(`chain ${args.chain} is not Aevum testnet (44005) or make fork (440050)`);
  return { chainId, rpc: args.rpc, out: resolve(ROOT, args.out) };
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) fail(`${method} HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) fail(`${method}: ${body.error.message}`);
  return body.result;
}

function git(args, cwd = ROOT) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const { chainId, rpc: rpcUrl, out } = parseArgs(process.argv.slice(2));
const broadcastFile = join(ROOT, `contracts/broadcast/DeployStack.s.sol/${chainId}/run-latest.json`);
const run = JSON.parse(readFileSync(broadcastFile, "utf8"));

const liveChain = Number(await rpc(rpcUrl, "eth_chainId", []));
if (liveChain !== chainId) fail(`RPC reports chain ${liveChain}, expected ${chainId}`);
if (Number(run.chain) !== chainId) fail(`broadcast is for chain ${run.chain}, expected ${chainId}`);
if (run.pending?.length) fail(`broadcast has ${run.pending.length} pending txs: outcome unknown, not recording`);

const creates = run.transactions.filter((t) => t.transactionType === "CREATE");
const calls = run.transactions.filter((t) => t.transactionType === "CALL");
if (creates.length !== EXPECTED_CREATES.length) fail(`expected ${EXPECTED_CREATES.length} creates, got ${creates.length}`);
const callFns = calls.map((t) => t.function);
if (JSON.stringify(callFns) !== JSON.stringify(EXPECTED_SETUP_CALLS)) fail(`unexpected setup calls: ${callFns}`);

const deployers = new Set(run.transactions.map((t) => t.transaction.from.toLowerCase()));
if (deployers.size !== 1) fail(`more than one sender: ${[...deployers]}`);

async function confirmed(tx) {
  const receipt = await rpc(rpcUrl, "eth_getTransactionReceipt", [tx.hash]);
  if (!receipt) fail(`no receipt on chain for ${tx.hash}: outcome unknown, not recording`);
  if (receipt.status !== "0x1") fail(`tx ${tx.hash} reverted on chain`);
  if (receipt.type !== "0x0") fail(`tx ${tx.hash} is type ${receipt.type}, not legacy`);
  return { txHash: tx.hash, block: Number(receipt.blockNumber), gasUsed: Number(receipt.gasUsed) };
}

const contracts = {};
const pool = creates.find((t) => t.contractName === "ShieldPoolPoseidon");
if (!pool) fail("no ShieldPoolPoseidon create in the broadcast");
// The raw PoseidonT3 create has no contract name; identify it by what the pool says it uses.
const poolPoseidon = "0x" + (await rpc(rpcUrl, "eth_call", [{ to: pool.contractAddress, data: POSEIDON2_SELECTOR }, "latest"])).slice(26);
for (const tx of creates) {
  const address = tx.contractAddress.toLowerCase();
  const name = tx.contractName ?? (address === poolPoseidon.toLowerCase() ? "PoseidonT3" : null);
  if (!name || !EXPECTED_CREATES.includes(name)) fail(`unexpected create ${tx.contractName} at ${address}`);
  if (contracts[name]) fail(`${name} created twice`);
  const code = await rpc(rpcUrl, "eth_getCode", [address, "latest"]);
  if (!code || code === "0x") fail(`${name} at ${address} has no code on chain`);
  contracts[name] = { address: tx.contractAddress, ...(await confirmed(tx)) };
}
const setupTxs = [];
for (const tx of calls) setupTxs.push({ function: tx.function, ...(await confirmed(tx)) });

const gitDirty = git(["status", "--porcelain"]).length > 0;
const record = {
  network: NETWORKS[chainId],
  chainId,
  rpc: rpcUrl,
  token: { symbol: "tUSD8", address: TUSD8, decimals: 6 },
  deployer: [...deployers][0],
  gitCommit: git(["rev-parse", "HEAD"]),
  gitDirty,
  gloamCommit: git(["rev-parse", "HEAD"], join(ROOT, "contracts/lib/gloam")),
  verifierKeys: "gloam ceremony-final (src/verifiers/final), checked final-accept and dev-reject at deploy",
  poolDeployBlock: contracts.ShieldPoolPoseidon.block,
  contracts,
  setupTxs,
  notBuiltYet: ["PayerRegistry", "ShaidaDepositor", "ShaidaLedger", "IncomeVerifier"],
  broadcastFile: broadcastFile.slice(ROOT.length + 1),
  recordedAt: new Date().toISOString(),
};
if (chainId === 44005 && gitDirty) fail("refusing to record an Aevum deploy from a dirty tree");

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
console.log(`✓ ${out.slice(ROOT.length + 1)}: ${Object.keys(contracts).length} contracts, ${setupTxs.length} setup txs, pool at block ${record.poolDeployBlock}${gitDirty ? " (git tree dirty)" : ""}`);
