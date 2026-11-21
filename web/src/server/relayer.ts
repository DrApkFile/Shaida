import "server-only";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { isHex, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { TUSD8_ADDRESS } from "@aevum-kit/aevum";
import { shaidaError } from "@shaida/proofs";
import { DEFAULT_LIMITS, emptyState, parseRelayState, serializedStore, signerAllowedOn, type RelayDeps, type RelayLimits } from "@shaida/relay";
import { networkByChainId } from "@/lib/env";
import { shaidaSetup } from "@/lib/shaida";
import { dataDir, readJson, writeJsonAtomic } from "./json-file";
import { relayChainFor } from "./relay-chain";

const isDev = process.env.NODE_ENV !== "production";

let cachedAccount: PrivateKeyAccount | null | undefined;
/** RELAYER_PRIVATE_KEY, parsed once. Never logged; only its address leaves the server. */
export function relayerAccount(): PrivateKeyAccount | null {
  if (cachedAccount !== undefined) return cachedAccount;
  const raw = process.env.RELAYER_PRIVATE_KEY?.trim();
  const key = (raw?.startsWith("0x") ? raw : `0x${raw ?? ""}`) as Hex;
  cachedAccount = raw && isHex(key) && key.length === 66 ? privateKeyToAccount(key) : null;
  return cachedAccount;
}

function limits(): RelayLimits {
  const budget = process.env.RELAYER_DAILY_GAS_BUDGET?.trim();
  if (budget && !/^[1-9][0-9]*$/.test(budget)) throw new Error("RELAYER_DAILY_GAS_BUDGET must be a whole number of gas units");
  return budget ? { ...DEFAULT_LIMITS, dailyGasBudget: BigInt(budget) } : DEFAULT_LIMITS;
}

const statePath = () => join(dataDir(), "relay-state.json");
const store = serializedStore(
  async () => {
    const raw = await readJson(statePath());
    return raw === null ? emptyState() : parseRelayState(raw);
  },
  (s) => writeJsonAtomic(statePath(), s),
);

export const relayDeps: RelayDeps = {
  store,
  limits: limits(),
  nowMs: () => Date.now(),
  newId: () => randomUUID(),
  log: (line) => console.info(`[relay] ${JSON.stringify(line)}`),
  network: (chainId) => {
    const net = networkByChainId(chainId);
    if (!net) return shaidaError("NotConfigured", "This network isn't enabled in the app. Nothing was sent.");
    const setup = shaidaSetup(net.key);
    if (!setup.ok) return shaidaError("NotConfigured", isDev ? setup.problem : "Gasless mode isn't set up for this network. Nothing was sent.");
    const account = relayerAccount();
    if (!account || !signerAllowedOn(account.address, chainId)) {
      return shaidaError("RelayerUnavailable", isDev ? "Set RELAYER_PRIVATE_KEY (a fresh key; anvil keys only on local chains)." : "Gasless mode isn't available right now. Nothing was sent.");
    }
    const c = setup.contracts;
    return {
      chainId,
      chain: relayChainFor(net),
      contracts: { token: TUSD8_ADDRESS.toLowerCase() as Hex, pool: c.pool, ledger: c.ledger, depositor: c.depositor, registry: c.registry, memo: c.memo },
      signer: { address: account.address, signTransaction: (tx) => account.signTransaction(tx) },
    };
  },
};
