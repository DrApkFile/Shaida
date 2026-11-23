import "server-only";
import { randomUUID } from "node:crypto";
import { BaseError, RpcRequestError, TransactionReceiptNotFoundError, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkSnapshot, type RootReader } from "@shaida/index";
import { memoryKv } from "@shaida/kv";
import { shaidaError } from "@shaida/proofs";
import {
  botSettingsFromEnv, CHECK_GAS, kvLock, kvRecordStore, ledgerNotReadable, PRESETS, SendRefused, UNDERWRITE_LIMITS,
  type BotSettings, type HandleDeps, type RecorderChain, type RecorderDeps, type UnderwriteDeps,
} from "@shaida/underwrite";
import { ledgerViewOf, nodeUnderwriteDeps } from "@shaida/underwrite/node";
import { defaultNetwork, type Network } from "@/lib/env";
import { revertOf } from "@/lib/income/chain";
import { shaidaSetup, type ShaidaContracts } from "@/lib/shaida";
import { publicClientFor } from "./chain";
import { syncFor } from "./indexer";
import { serialized } from "./json-file";
import { relayStore, sharedKv } from "./state-store";

/**
 * The underwriting bot's server wiring (D30). It reads the chain the app is deployed on (the first network in
 * NEXT_PUBLIC_NETWORKS), from the server's own index, checked like any client checks it (every leaf recomputed, both
 * roots on chain). It never logs a link; it keeps a hash of each proof it records and the rate-limit windows.
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hex32 = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const rootsAbi = [{ type: "function", name: "isKnownRoot", stateMutability: "view", inputs: [{ name: "root", type: "bytes32" }], outputs: [{ type: "bool" }] }] as const;

/** Index reads per decision at most (10,000 blocks each) before the bot answers INCONCLUSIVE. */
const MAX_SYNC_ROUNDS = 12;

let settings: BotSettings | undefined;
/** UNDERWRITE_* settings, parsed once; startup.node.ts parses them first so a bad value stops the server. */
export const botSettings = (): BotSettings => (settings ??= botSettingsFromEnv(process.env));

export function botAddress(): Address | null {
  const key = botSettings().botKey;
  return key ? privateKeyToAccount(key).address : null;
}

export interface BotNetwork {
  readonly net: Network;
  readonly contracts: ShaidaContracts;
}
export function botNetwork(): BotNetwork | null {
  const setup = shaidaSetup(defaultNetwork.key);
  return setup.ok ? { net: defaultNetwork, contracts: setup.contracts } : null;
}

const blockTimes = new Map<bigint, bigint>();

function engineFor(b: BotNetwork): UnderwriteDeps {
  const client = publicClientFor(b.net);
  const reader: RootReader = {
    isKnownRoot: (c, root, block) => client.readContract({ address: c as Address, abi: rootsAbi, functionName: "isKnownRoot", args: [hex32(root)], blockNumber: block }),
  };
  return nodeUnderwriteDeps({
    client,
    ledger: b.contracts.ledger,
    now: () => BigInt(Math.floor(Date.now() / 1000)),
    view: async () => {
      for (let round = 0; round < MAX_SYNC_ROUNDS; round++) {
        const reply = await syncFor(b.net, b.contracts);
        if (reply.pageError) throw new Error(`index page failed: ${reply.pageError}`);
        if (reply.behind !== "0" && !reply.complete) continue;
        const checked = await checkSnapshot(reply.snapshot, b.net.chain.id, reader);
        if (!checked.ok) throw ledgerNotReadable("UnknownRoot", `The bot's index failed its own check (${checked.error.message}). Nothing was decided.`);
        return ledgerViewOf(checked.value, async (block) => {
          const known = blockTimes.get(block);
          if (known !== undefined) return known;
          const t = (await client.getBlock({ blockNumber: block })).timestamp;
          blockTimes.set(block, t);
          return t;
        });
      }
      throw ledgerNotReadable("RangeUnresolvable", "The bot's index is still catching up with the chain. Nothing was decided; try again shortly.");
    },
  });
}

function recorderChain(b: BotNetwork): RecorderChain {
  const client = publicClientFor(b.net);
  return {
    chainId: b.net.chain.id,
    incomeVerifier: b.contracts.incomeVerifier,
    check: async (data) => {
      try {
        const r = await client.call({ to: b.contracts.incomeVerifier, data, gas: CHECK_GAS });
        return r.data === hex32(1n) ? null : shaidaError("ProofInvalid", `IncomeVerifier.check returned ${r.data ?? "nothing"}, not true. Nothing was recorded.`);
      } catch (e) {
        return revertOf(e);
      }
    },
    balance: (address) => client.getBalance({ address }),
    gasPrice: () => client.getGasPrice(),
    pendingNonce: (address) => client.getTransactionCount({ address, blockTag: "pending" }),
    sendRaw: async (raw) => {
      try {
        await client.sendRawTransaction({ serializedTransaction: raw });
      } catch (e) {
        // The node answered with an error: not taken. Anything else: no answer (the record stays "unknown").
        if (e instanceof BaseError && e.walk((x) => x instanceof RpcRequestError)) throw new SendRefused(e.shortMessage);
        throw e;
      }
    },
    receipt: async (hash) => {
      try {
        const r = await client.getTransactionReceipt({ hash });
        return { status: r.status, gasUsed: r.gasUsed, blockNumber: r.blockNumber };
      } catch (e) {
        if (e instanceof TransactionReceiptNotFoundError) return null;
        throw e;
      }
    },
  };
}

let recorder: RecorderDeps | undefined;
function recorderDeps(): RecorderDeps {
  if (recorder) return recorder;
  const s = botSettings();
  const b = botNetwork();
  // Dev without Redis keeps records in memory (a restart forgets them); production always has Redis (D29).
  const kv = sharedKv() ?? memoryKv();
  const account = s.botKey ? privateKeyToAccount(s.botKey) : null;
  const crossProcess = kvLock(kv, { key: "shaida:v1:underwrite:lock", leaseMs: 180_000, waitMs: 30_000, newToken: randomUUID, sleep });
  recorder = {
    config: s.recorder,
    chain: b ? recorderChain(b) : null,
    signer: account ? { address: account.address, signTransaction: (tx) => account.signTransaction(tx) } : null,
    store: kvRecordStore(kv),
    withLock: (task) => serialized("underwrite-record", () => crossProcess(task)),
    nowMs: () => Date.now(),
    newId: randomUUID,
    sleep,
    receiptWaitMs: 30_000,
    log: (line) => console.info(`[underwrite] ${JSON.stringify(line)}`),
  };
  return recorder;
}

export function handleDeps(): HandleDeps | null {
  const b = botNetwork();
  if (!b) return null;
  return {
    policies: PRESETS,
    limits: UNDERWRITE_LIMITS,
    hit: (bucket, max, nowMs) => relayStore().hit(bucket, max, nowMs),
    nowMs: () => Date.now(),
    engine: () => engineFor(b),
    recorder: recorderDeps(),
    log: (line) => console.info(`[underwrite] ${JSON.stringify(line)}`),
  };
}
