// Node-side wiring for scripts: Gloam's FINAL ceremony provers (sha256-pinned), a fork RPC client, fetch.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactProver, type Prover } from "@gloamtrade/sdk";
import { createPublicClient, http, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { RootReader } from "@shaida/index";
import type { Fetch } from "../src/index";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CIRCUITS = join(REPO, "contracts/lib/gloam/app/public/circuits");

/** Measured 2026-11-20 (REALITY_SPIKES): only circuits/final/ matches Gloam's *VerifierFinal contracts. */
export const GLOAM_FINAL = {
  shield: { wasm: join(CIRCUITS, "shield.wasm"), zkey: join(CIRCUITS, "final/shield_final.zkey"), zkeySha256: "3054877c35e2e0e9f76c43aa4791ac2b3ac51b8967d51be2215e89c0a5fbb512" },
  transfer: { wasm: join(CIRCUITS, "transfer.wasm"), zkey: join(CIRCUITS, "final/transfer_final.zkey"), zkeySha256: "bdbae966705bc85e76571b4945da74a43fc4503a955fd4e3799358bcff749cdb" },
} as const;

function pinned(path: string, sha256: string): string {
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== sha256) throw new Error(`${path}: sha256 ${actual}, expected ${sha256} (not Gloam's final ceremony key)`);
  return path;
}

export function finalProvers(): { shield: Prover; transfer: Prover } {
  return {
    shield: artifactProver({ wasm: GLOAM_FINAL.shield.wasm, zkey: pinned(GLOAM_FINAL.shield.zkey, GLOAM_FINAL.shield.zkeySha256) }),
    transfer: artifactProver({ wasm: GLOAM_FINAL.transfer.wasm, zkey: pinned(GLOAM_FINAL.transfer.zkey, GLOAM_FINAL.transfer.zkeySha256) }),
  };
}

const isKnownRootAbi = parseAbi(["function isKnownRoot(bytes32 root) view returns (bool)", "function isSpent(bytes32 nullifier) view returns (bool)"]);
const hex32 = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;

export function rootReader(client: PublicClient): RootReader {
  return {
    isKnownRoot: (contract, root, block) => client.readContract({ address: contract as Address, abi: isKnownRootAbi, functionName: "isKnownRoot", args: [hex32(root)], blockNumber: block }),
  };
}

export const isSpentReader = (client: PublicClient, pool: Address) => (nullifier: Hex, block: bigint) =>
  client.readContract({ address: pool, abi: isKnownRootAbi, functionName: "isSpent", args: [nullifier], blockNumber: block });

export const nodeFetch: Fetch = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, json: () => res.json() as Promise<unknown> };
};

export const forkClient = (rpc: string): PublicClient => createPublicClient({ transport: http(rpc) }) as PublicClient;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
