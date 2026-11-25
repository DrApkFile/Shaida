// Reads, from the deploy block to the head, every transaction and event touching the deployment's contracts, plus
// tUSD8 transfers one hop in and out of every public address those transactions name (payers, withdrawal
// recipients). The result (a "dump") is what any observer with an RPC can rebuild; the analysis runs on it offline.
import { decodeEventLog } from "viem";
import { EVENT_BY_TOPIC, TOKEN_TRANSFER_TOPIC } from "./abi.mjs";
import { explorerTxs, hex, logsChunked } from "./rpc.mjs";

const lower = (a) => a.toLowerCase();
const topicOf = (addr) => `0x${addr.slice(2).toLowerCase().padStart(64, "0")}`;

/**
 * @param rpc        rpcClient
 * @param deployment { chainId, contracts: {pool, ledger, depositor, registry, memo, incomeVerifier}, token, fromBlock }
 * @param options    { explorer?: string, toBlock?: bigint, log?: (msg) => void }
 */
export async function collect(rpc, deployment, { explorer, toBlock, log = () => {} } = {}) {
  const chainId = Number(await rpc.call("eth_chainId", []));
  if (chainId !== deployment.chainId) throw new Error(`RPC is chain ${chainId}, the deployment is chain ${deployment.chainId}`);
  const head = toBlock ?? BigInt(await rpc.call("eth_blockNumber", []));
  const from = BigInt(deployment.fromBlock);
  const ours = Object.values(deployment.contracts).map(lower);

  log(`logs of ${ours.length} contracts, blocks ${from}–${head}`);
  const logs = await logsChunked(rpc, { address: ours }, from, head);
  const hashes = new Set(logs.map((l) => lower(l.transactionHash)));
  const fromLogs = new Set(hashes);

  const completeness = { explorer: "not checked", onlyInExplorer: [], failedInExplorer: [] };
  if (explorer) {
    completeness.explorer = explorer;
    for (const a of ours) {
      const r = await explorerTxs(explorer, a);
      if (!r.ok) throw new Error(`explorer txlist for ${a}: ${r.why}`);
      for (const t of r.txs) {
        if (t.isError) completeness.failedInExplorer.push(t.hash);
        if (!fromLogs.has(t.hash)) completeness.onlyInExplorer.push(t.hash);
        hashes.add(t.hash);
      }
    }
  }

  log(`${hashes.size} transactions`);
  const blockTimes = new Map();
  const timeOf = async (block) => {
    if (!blockTimes.has(block)) blockTimes.set(block, Number((await rpc.call("eth_getBlockByNumber", [hex(block), false])).timestamp));
    return blockTimes.get(block);
  };
  const txs = [];
  for (const hash of hashes) {
    const [tx, receipt] = await Promise.all([rpc.call("eth_getTransactionByHash", [hash]), rpc.call("eth_getTransactionReceipt", [hash])]);
    const block = Number(receipt.blockNumber);
    if (BigInt(block) > head) continue;
    txs.push({
      hash, block, time: await timeOf(block), index: Number(receipt.transactionIndex), from: lower(tx.from), to: tx.to ? lower(tx.to) : null,
      nonce: Number(tx.nonce), type: Number(tx.type ?? 0), input: tx.input, gasLimit: Number(tx.gas), gasUsed: Number(receipt.gasUsed),
      gasPrice: BigInt(tx.gasPrice).toString(), status: receipt.status === "0x1" ? "success" : "reverted", contractAddress: receipt.contractAddress ? lower(receipt.contractAddress) : null,
      logs: receipt.logs.map((l) => ({ address: lower(l.address), topics: l.topics, data: l.data, logIndex: Number(l.logIndex) })),
    });
  }
  txs.sort((a, b) => a.block - b.block || a.index - b.index);

  const publicAddrs = publicAddresses(txs, deployment);
  const tokenHops = [];
  if (publicAddrs.length) {
    log(`tUSD8 transfers one hop from ${publicAddrs.length} public addresses`);
    const t = [TOKEN_TRANSFER_TOPIC];
    const out = await logsChunked(rpc, { address: deployment.token, topics: [...t, publicAddrs.map(topicOf)] }, from, head);
    const inc = await logsChunked(rpc, { address: deployment.token, topics: [...t, null, publicAddrs.map(topicOf)] }, from, head);
    const seen = new Set();
    for (const l of [...out, ...inc]) {
      const k = `${l.transactionHash}:${l.logIndex}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const block = Number(l.blockNumber);
      tokenHops.push({ hash: lower(l.transactionHash), block, time: await timeOf(block), from: lower(`0x${l.topics[1].slice(26)}`), to: lower(`0x${l.topics[2].slice(26)}`), value: BigInt(l.data).toString() });
    }
    tokenHops.sort((a, b) => a.block - b.block);
  }

  return {
    schema: "shaida-privacy-dump/1", chainId, rpc: rpc.url, fromBlock: Number(from), toBlock: Number(head), readAt: new Date().toISOString(),
    contracts: Object.fromEntries(Object.entries(deployment.contracts).map(([k, v]) => [k, lower(v)])), token: lower(deployment.token),
    completeness, txs, tokenHops,
  };
}

/** Addresses our events name in clear: payers (Deposited, PayerRegistered) and withdrawal recipients (Unshielded). */
function publicAddresses(txs, deployment) {
  const out = new Set();
  for (const tx of txs) for (const l of tx.logs) {
    const ev = decodeKnown(l);
    if (!ev) continue;
    if (ev.eventName === "Deposited") out.add(lower(ev.args.payer));
    if (ev.eventName === "PayerRegistered") out.add(lower(ev.args.account));
    if (ev.eventName === "Unshielded") out.add(lower(ev.args.to));
  }
  for (const c of [...Object.values(deployment.contracts), deployment.token]) out.delete(lower(c));
  return [...out];
}

/** The event a log is, by its topic 0, or null for an event the audit does not know (counted, never dropped). */
export function decodeKnown(l) {
  const abi = EVENT_BY_TOPIC.get(l.topics[0]);
  return abi ? decodeEventLog({ abi: [abi], data: l.data, topics: l.topics, strict: true }) : null;
}
