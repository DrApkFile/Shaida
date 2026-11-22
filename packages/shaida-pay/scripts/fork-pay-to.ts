// `make fork` only, for the acts 4–6 UI flow: pays a receive address made in a browser 3, 4 and 2 tUSD8 from
// Acme Studio (demo, registered; vouched, gasless) and 5 tUSD8 from Mallory (demo, NOT registered; a plain pool
// transfer with her own gas). Prints one JSON line with the txs. Usage: tsx scripts/fork-pay-to.ts --tag gloam1…
import { fetchCheckedTrees, relayClient, type FlowContext, type RelayRecord } from "../src/index";
import { payTo, type Env } from "./acts-4-6-setup";
import { readDeployment, type ActRow } from "./evidence";
import { assertFork } from "./fork-setup";
import { finalProvers, forkClient, nodeFetch, rootReader, sleep } from "./node-env";

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d; };
const BASE = arg("base", "http://localhost:3100");
const RPC = arg("rpc", "http://127.0.0.1:8555");
const TAG = arg("tag", "");

async function main() {
  if (!TAG) throw new Error("--tag is required");
  const client = forkClient(RPC);
  await assertFork(client);
  const dep = readDeployment();
  const ctx: FlowContext = { chainId: 440050, contracts: { pool: dep.pool, ledger: dep.ledger, depositor: dep.depositor }, provers: finalProvers(), nowSec: () => BigInt(Math.floor(Date.now() / 1000)) };
  const relay = relayClient(BASE, nodeFetch);
  const rows: ActRow[] = [];
  const must: Env["must"] = (r, what) => { if (!r.ok) throw new Error(`${what}: ${r.error.code}: ${r.error.message}`); return r.value; };
  const settle = async (r: RelayRecord, act: string, what: string) => {
    const s = must(await relay.settle(r.requestId, { sleep, timeoutMs: 60_000 }), `${act} status`);
    if (s.state !== "mined" || s.reverted) throw new Error(`${what}: ${s.state}`);
    rows.push({ act, what, fn: s.fn, hash: s.hash, block: s.block ?? "—", gasUsed: s.gasUsed ?? "—" });
    return s;
  };
  const trees = async () => must(await fetchCheckedTrees(BASE, 440050, nodeFetch, rootReader(client), { sleep }), "index");
  const refusals = await payTo({ client, rpc: RPC, dep, ctx, relay, rows, trees, settle, must }, TAG);
  console.log(JSON.stringify({ refusals, rows }));
}

main().then(() => process.exit(0), (e: unknown) => { console.error(e); process.exit(1); });
