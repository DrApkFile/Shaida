// Verify a Shaida income proof link from Node, talking only to the Aevum RPC: node verify-node.mjs "<link>" "<reader>"
// Optional: RPC_URL (another endpoint you trust), SHAIDA_NETWORK (a custom local network as JSON, e.g. the fork fixture).
import { verifyIncomeLink } from "@shaida/sdk";

const [link, readerName] = process.argv.slice(2);
if (!link || !readerName) { console.error('usage: node verify-node.mjs "<link>" "<reader name>"'); process.exit(2); }
const network = process.env.SHAIDA_NETWORK ? JSON.parse(process.env.SHAIDA_NETWORK, (k, v) => (k === "fromBlock" ? BigInt(v) : v)) : "aevum-testnet";
const v = await verifyIncomeLink(link, { readerName, network, ...(process.env.RPC_URL ? { rpcUrl: process.env.RPC_URL } : {}) });
const day = (d) => d.toISOString().slice(0, 10);
if (v.status === "VALID") {
  console.log(`VALID: at least ${Number(v.threshold) / 1e6} tUSD8 from ${v.count} payments, ${day(v.from)} to ${day(v.to)}; expires ${v.expiry.toISOString()} (${v.network}, block ${v.block})`);
} else console.log(`${v.status} ${v.code}: ${v.message}`);
process.exit(v.status === "VALID" ? 0 : 1);
