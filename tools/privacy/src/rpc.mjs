// JSON-RPC and explorer reads for the privacy audit. Read-only: only eth_* getters and the explorer's txlist.
// eth_getLogs pages are at most 1,000 blocks (toBlock − fromBlock ≤ 999 here, CLAUDE.md), with retry and backoff.

const LOG_SPAN = 999n;

export function rpcClient(url, { retries = 5, fetchImpl = fetch } = {}) {
  let id = 0;
  async function call(method, params) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
        if (!r.ok) throw new Error(`${method}: HTTP ${r.status}`);
        const j = await r.json();
        if (j.error) throw new Error(`${method}: ${j.error.message}`);
        return j.result;
      } catch (e) {
        if (attempt >= retries) throw e;
        await new Promise((ok) => setTimeout(ok, 500 * 2 ** attempt));
      }
    }
  }
  return { call, url };
}

export const hex = (n) => `0x${BigInt(n).toString(16)}`;

/** Every log matching `filter` in [from, to], in pages of ≤ 1,000 blocks. `onPage` reports progress. */
export async function logsChunked(rpc, filter, from, to, onPage = () => {}) {
  const out = [];
  for (let start = BigInt(from); start <= BigInt(to); start += LOG_SPAN + 1n) {
    const end = start + LOG_SPAN < BigInt(to) ? start + LOG_SPAN : BigInt(to);
    const page = await rpc.call("eth_getLogs", [{ ...filter, fromBlock: hex(start), toBlock: hex(end) }]);
    out.push(...page);
    onPage(end);
  }
  return out;
}

/** Every tx the explorer lists for `address` (including failed ones), or a named reason it could not be read. */
export async function explorerTxs(explorer, address, fetchImpl = fetch) {
  const url = `${explorer}/api?module=account&action=txlist&address=${address}&page=1&offset=10000&sort=asc`;
  const r = await fetchImpl(url);
  if (!r.ok) return { ok: false, why: `HTTP ${r.status} from ${url}` };
  const j = await r.json();
  if (!Array.isArray(j.result)) return { ok: false, why: `explorer replied ${JSON.stringify(j).slice(0, 200)}` };
  return { ok: true, txs: j.result.map((t) => ({ hash: t.hash.toLowerCase(), isError: t.isError === "1" })) };
}
