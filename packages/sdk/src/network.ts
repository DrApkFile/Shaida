// The one production network the SDK knows, bundled and pinned (src/pins.ts checks its hash before any read).
// Source: deployments/aevum.json (ShaidaLedger, IncomeVerifier, ledgerDeployBlock, revocations), chain 44005, tUSD8.
import type { CustomNetwork, NetworkConfig } from "./types";
import { z } from "zod";

export const AEVUM_TESTNET: NetworkConfig = Object.freeze({
  name: "aevum-testnet",
  chainId: 44005,
  rpcUrl: "https://rpc-test.qday.info",
  asset: "0x456569838f1d43009a91eba4263147afd7233483",
  ledger: "0x677659b068278103f83eff413080cb53be3388ed",
  incomeVerifier: "0xc9844a8f058be2d658c972d1d2276b13f308e1c8",
  fromBlock: 3810988n,
  revocations: null,
});

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "not a 20-byte hex address").transform((a) => a.toLowerCase());
const customSchema = z
  .object({
    name: z.string().min(1).max(40),
    chainId: z.number().int().positive().refine((id) => id !== AEVUM_TESTNET.chainId, "chain 44005 is only reachable as \"aevum-testnet\" (bundled and pinned)"),
    ledger: address,
    incomeVerifier: address,
    fromBlock: z.bigint().nonnegative(),
    revocations: address.optional(),
  })
  .strict();

/** "aevum-testnet" → the bundled config; a custom object (local forks and test chains only) is validated strictly. */
export function networkOf(network: "aevum-testnet" | CustomNetwork): { ok: true; value: NetworkConfig } | { ok: false; why: string } {
  if (network === "aevum-testnet") return { ok: true, value: AEVUM_TESTNET };
  if (typeof network === "string") return { ok: false, why: `unknown network ${JSON.stringify(network)}: the SDK knows "aevum-testnet", or pass a custom local network object` };
  const r = customSchema.safeParse(network);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, why: `custom network: ${issue?.path.join(".") || "value"}: ${issue?.message ?? "invalid"}` };
  }
  return { ok: true, value: { ...r.data, revocations: r.data.revocations ?? null, rpcUrl: null, asset: AEVUM_TESTNET.asset } };
}
