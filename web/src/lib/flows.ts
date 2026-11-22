"use client";
// Browser wiring for @shaida/pay: checked provers (loaded on first use), checked trees, a public client.
import type { Prover } from "@gloamtrade/sdk";
import { createPublicClient, http, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { CheckedTrees, RootReader } from "@shaida/index";
import { fetchCheckedTrees, incomeKeyFor, loadCircuit, memProver, relayClient, type Circuit, type FlowContext, type Groth16Lib, type IncomeKey, type WithdrawContext } from "@shaida/pay";
import type { Result } from "@shaida/proofs";
import type { Network } from "./env";
import { shaidaSetup, type ShaidaContracts } from "./shaida";

const reads = parseAbi([
  "function isKnownRoot(bytes32 root) view returns (bool)",
  "function isSpent(bytes32 nullifier) view returns (bool)",
  "function activeIdOf(address account) view returns (uint32)",
  "function balanceOf(address) view returns (uint256)",
]);
const hex32 = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;

const fetchBytes = async (url: string) => {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.arrayBuffer();
};

const proverCache = new Map<Circuit, Promise<Prover>>();
/** A Prover that fetches and hash-checks its circuit the first time it is used. A failed load is not cached. */
function lazyProver(circuit: Circuit): Prover {
  return async (input) => {
    let p = proverCache.get(circuit);
    if (!p) {
      p = (async () => {
        const loaded = await loadCircuit("/gloam", circuit, fetchBytes);
        if (!loaded.ok) throw new Error(loaded.error.message);
        const snarkjs = (await import("snarkjs")) as unknown as Groth16Lib;
        return memProver(snarkjs, loaded.value);
      })();
      proverCache.set(circuit, p);
      p.catch(() => proverCache.delete(circuit));
    }
    return (await p)(input);
  };
}

export interface Wiring {
  readonly net: Network;
  readonly contracts: ShaidaContracts;
  readonly ctx: FlowContext;
  /** Withdrawals (pool.unshield), proved with Gloam's final unshield key on first use. */
  readonly withdraw: WithdrawContext;
  readonly client: PublicClient;
  readonly relay: ReturnType<typeof relayClient>;
  readonly incomeKey: Result<IncomeKey>;
  trees(onProgress?: (behind: bigint) => void): Promise<Result<CheckedTrees>>;
  isSpent(nullifier: Hex, block: bigint): Promise<boolean>;
  payerId(payer: Address): Promise<{ id: number } | { error: string }>;
}

const browserFetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
  const res = await fetch(url, { ...init, cache: "no-store" });
  return { status: res.status, json: () => res.json() as Promise<unknown> };
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function wiringFor(net: Network): { ok: true; value: Wiring } | { ok: false; problem: string } {
  const setup = shaidaSetup(net.key);
  if (!setup.ok) return { ok: false, problem: setup.problem };
  const contracts = setup.contracts;
  const rpc = net.chain.rpcUrls.default.http[0];
  if (!rpc) return { ok: false, problem: `No RPC URL for ${net.chain.name}.` };
  const client = createPublicClient({ transport: http(rpc) }) as PublicClient;
  const reader: RootReader = {
    isKnownRoot: (c, root, block) => client.readContract({ address: c as Address, abi: reads, functionName: "isKnownRoot", args: [hex32(root)], blockNumber: block }),
  };
  const ctx: FlowContext = {
    chainId: net.chain.id,
    contracts: { pool: contracts.pool, ledger: contracts.ledger, depositor: contracts.depositor },
    provers: { shield: lazyProver("shield"), transfer: lazyProver("transfer") },
    nowSec: () => BigInt(Math.floor(Date.now() / 1000)),
  };
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return {
    ok: true,
    value: {
      net, contracts, ctx, client,
      withdraw: { chainId: net.chain.id, contracts: { pool: contracts.pool }, proveUnshield: lazyProver("unshield") },
      relay: relayClient(origin, browserFetch),
      incomeKey: incomeKeyFor(process.env.NEXT_PUBLIC_SHAIDA_INCOME_KEY, net.chain.id),
      trees: (onProgress) => fetchCheckedTrees(origin, net.chain.id, browserFetch, reader, { sleep, onProgress }),
      isSpent: (nullifier, block) => client.readContract({ address: contracts.pool, abi: reads, functionName: "isSpent", args: [nullifier], blockNumber: block }),
      payerId: async (payer) => {
        try {
          return { id: await client.readContract({ address: contracts.registry, abi: reads, functionName: "activeIdOf", args: [payer] }) };
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          if (/PayerRevoked/.test(m)) return { error: "PayerRevoked" };
          if (/PayerNotRegistered|revert/i.test(m)) return { error: "PayerNotRegistered" };
          return { error: `could not read the payer registry: ${m.split("\n")[0]}` };
        }
      },
    },
  };
}
