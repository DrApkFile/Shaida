// A JSON-RPC server that replays the fork fixture (tools/privacy/fixtures/*-fixes.json: every transaction of the
// D32 fork run, with logs and block times, recorded from chain 440050). It answers only what that record can answer:
// eth_chainId, eth_blockNumber, eth_getBlockByNumber for recorded blocks, eth_getLogs (Aevum's ≤ 1000-block rule),
// and ShaidaLedger's isKnownRoot / nextIndex at any block, computed from the recorded leaves with Gloam's
// incremental tree (prefixRoots). It is not a chain: IncomeVerifier has no code here, so check() is an error.
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prefixRoots } from "../../shaida-underwrite/src/root-time";

const FIX = fileURLToPath(new URL("../../../tools/privacy/fixtures/", import.meta.url));
const dump = JSON.parse(readFileSync(`${FIX}fork-dump-fixes.json`, "utf8")) as {
  chainId: number; toBlock: number; contracts: { ledger: string; incomeVerifier: string };
  txs: { block: number; time: number; hash: string; logs: { address: string; topics: string[]; data: string; logIndex: number }[] }[];
};
const deployment = JSON.parse(readFileSync(`${FIX}fork-deployment-fixes.json`, "utf8")) as { contracts: { ShaidaLedger: { block: number } } };
const truth = JSON.parse(readFileSync(`${FIX}fork-truth-fixes.json`, "utf8")) as { links: { name: string; reader: string; holder: string; from: { url: string } }[] };

const VOUCHED = "0x0f261e8c13be127d3405bce37a07673fe92d4b7002a3c90a2bc5af9274b48bd6";
const SWEPT = "0xb8b0aa967035d4c4e2afe48f28aab6fc93be6b675d3936a1884e0f0f0fdafc95";
const ledger = dump.contracts.ledger.toLowerCase();
const logs = dump.txs.flatMap((t) => t.logs.map((l) => ({ ...l, address: l.address.toLowerCase(), blockNumber: t.block, transactionHash: t.hash })));
const leaves = logs
  .filter((l) => l.address === ledger && (l.topics[0] === VOUCHED || l.topics[0] === SWEPT))
  .map((l) => ({ index: Number(BigInt(`0x${l.data.slice(2, 66)}`)), leaf: BigInt(`0x${l.data.slice(66, 130)}`), block: l.blockNumber, vouch: l.topics[0] === VOUCHED }))
  .sort((a, b) => a.index - b.index);
leaves.forEach((l, i) => { if (l.index !== i) throw new Error(`fixture: leaf ${i} is missing`); });
const roots = prefixRoots(leaves.map((l) => l.leaf));
const blockTime = new Map(dump.txs.map((t) => [t.block, t.time]));

export const FIXTURE = {
  chainId: dump.chainId,
  head: dump.toBlock,
  network: { name: "aevum-fork (fixture replay)", chainId: dump.chainId, ledger, incomeVerifier: dump.contracts.incomeVerifier.toLowerCase(), fromBlock: BigInt(deployment.contracts.ShaidaLedger.block) },
  leaves,
  links: truth.links.map((l) => ({ name: l.name, reader: l.reader, holder: l.holder, url: l.from.url })),
  timeOf: (block: number) => blockTime.get(block),
} as const;

export interface FixtureOptions {
  /** Pretend the chain head is this block (state after it is unknown). Default: the last recorded block. */
  readonly head?: number;
  /** Answer eth_chainId with another chain (the wrong-RPC test). */
  readonly chainId?: number;
}

export interface FixtureServer {
  readonly url: string;
  readonly calls: { method: string; params: unknown[] }[];
  close(): Promise<void>;
}

const word = (n: bigint | number) => `0x${BigInt(n).toString(16).padStart(64, "0")}`;

function answer(method: string, params: unknown[], o: Required<FixtureOptions>): unknown {
  const tag = (t: unknown) => (t === "latest" || t === undefined ? o.head : Number(BigInt(t as string)));
  switch (method) {
    case "eth_chainId": return `0x${o.chainId.toString(16)}`;
    case "eth_blockNumber": return `0x${o.head.toString(16)}`;
    case "eth_getBlockByNumber": {
      const b = tag(params[0]);
      const t = blockTime.get(b);
      return t === undefined || b > o.head ? null : { number: `0x${b.toString(16)}`, timestamp: `0x${t.toString(16)}` };
    }
    case "eth_getLogs": {
      const f = params[0] as { address: string; fromBlock: string; toBlock: string; topics?: (string | string[])[] };
      const from = tag(f.fromBlock);
      const to = Math.min(tag(f.toBlock), o.head);
      if (to - from > 1000) throw Object.assign(new Error("block range is too large (max 1000)"), { code: -32000 });
      const t0 = f.topics?.[0];
      const want = t0 === undefined ? null : Array.isArray(t0) ? t0 : [t0];
      return logs
        .filter((l) => l.address === f.address.toLowerCase() && l.blockNumber >= from && l.blockNumber <= to && (!want || want.includes(l.topics[0]!)))
        .map((l) => ({ address: l.address, topics: l.topics, data: l.data, blockNumber: `0x${l.blockNumber.toString(16)}`, transactionHash: l.transactionHash, logIndex: `0x${l.logIndex.toString(16)}` }));
    }
    case "eth_call": {
      const c = params[0] as { to: string; data: string };
      const b = Math.min(tag(params[1]), o.head);
      if (c.to.toLowerCase() !== ledger) throw Object.assign(new Error(`the fixture replays ShaidaLedger only; ${c.to} has no code here`), { code: -32601 });
      if (b < FIXTURE.network.fromBlock) return "0x";
      const n = leaves.filter((l) => l.block <= b).length;
      if (c.data === "0xfc7e9c6f") return word(n);
      if (c.data.startsWith("0x6d9833e3")) return word(roots.slice(0, n).includes(BigInt(`0x${c.data.slice(10)}`)) ? 1 : 0);
      throw Object.assign(new Error(`ShaidaLedger call ${c.data.slice(0, 10)} is not replayed`), { code: -32601 });
    }
    default: throw Object.assign(new Error(`${method} is not replayed by the fixture`), { code: -32601 });
  }
}

export async function startFixtureRpc(opts: FixtureOptions = {}, port = 0): Promise<FixtureServer> {
  const o = { head: opts.head ?? FIXTURE.head, chainId: opts.chainId ?? FIXTURE.chainId };
  const calls: FixtureServer["calls"] = [];
  const server: Server = createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString(); });
    req.on("end", () => {
      const r = JSON.parse(body) as { id: number; method: string; params: unknown[] };
      calls.push({ method: r.method, params: r.params });
      res.setHeader("content-type", "application/json");
      try {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: r.id, result: answer(r.method, r.params, o) }));
      } catch (e) {
        const err = e as Error & { code?: number };
        res.end(JSON.stringify({ jsonrpc: "2.0", id: r.id, error: { code: err.code ?? -32000, message: err.message } }));
      }
    });
  });
  await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("fixture RPC: no port");
  return { url: `http://127.0.0.1:${addr.port}`, calls, close: () => new Promise((ok) => server.close(() => ok())) };
}
