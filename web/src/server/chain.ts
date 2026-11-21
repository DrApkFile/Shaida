import "server-only";
import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import { parseAbi } from "viem";
import type { IndexChain, RawLog } from "@shaida/index";
import type { Network } from "@/lib/env";

/** nextIndex() has the same signature on the Gloam pool and on ShaidaLedger. */
const nextIndexAbi = parseAbi(["function nextIndex() view returns (uint256)"]);

const clients = new Map<number, PublicClient>();

/** One public client per chain, on the chain's own RPC (HTTPS polling; Aevum has no WebSocket). */
export function publicClientFor(net: Network): PublicClient {
  const existing = clients.get(net.chain.id);
  if (existing) return existing;
  const client = createPublicClient({ chain: net.chain, transport: http(undefined, { retryCount: 0, timeout: 20_000 }) }) as PublicClient;
  clients.set(net.chain.id, client);
  return client;
}

interface RpcLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  logIndex: Hex;
  transactionHash: Hex;
}

/** The index's chain reads over viem. Retries are the index's own (backoff per page), so viem's are off. */
export function indexChainFor(net: Network): IndexChain {
  const client = publicClientFor(net);
  return {
    chainId: () => client.getChainId(),
    blockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    getLogs: async (addresses, page) => {
      const logs = (await client.request({
        method: "eth_getLogs",
        params: [{ address: addresses as Hex[], fromBlock: `0x${page.fromBlock.toString(16)}`, toBlock: `0x${page.toBlock.toString(16)}` }],
      })) as RpcLog[];
      return logs.map(
        (l): RawLog => ({
          address: l.address,
          topics: l.topics,
          data: l.data,
          blockNumber: BigInt(l.blockNumber),
          logIndex: Number(BigInt(l.logIndex)),
          transactionHash: l.transactionHash,
        }),
      );
    },
    nextIndex: (contract, block) =>
      client.readContract({ address: contract as Hex, abi: nextIndexAbi, functionName: "nextIndex", blockNumber: block }),
  };
}
