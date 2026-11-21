import "server-only";
import {
  BaseError, ContractFunctionRevertedError, HttpRequestError, RpcRequestError, TimeoutError, TransactionReceiptNotFoundError,
  decodeErrorResult, type Address, type Hex,
} from "viem";
import { ReadReverted, SendError, ledgerAbi, readsAbi, relayErrorsAbi, type RelayChain, type Simulation } from "@shaida/relay";
import type { Network } from "@/lib/env";
import { publicClientFor } from "./chain";

const readAbi = [...readsAbi, ...ledgerAbi, ...relayErrorsAbi];

/** The revert data of a failed call, wherever viem nested it. */
function revertData(e: unknown): Hex | null {
  if (!(e instanceof BaseError)) return null;
  let found: Hex | null = null;
  e.walk((inner) => {
    const data = (inner as { data?: unknown }).data;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) found = data as Hex;
    else if (data && typeof data === "object" && typeof (data as { data?: unknown }).data === "string") found = (data as { data: Hex }).data;
    return false;
  });
  return found;
}

function decodeRevert(e: unknown): { errorName: string | null; reason: string } {
  const reason = e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e);
  if (e instanceof BaseError) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) {
      return { errorName: reverted.data.errorName === "Error" ? null : reverted.data.errorName, reason: reverted.reason ?? reason };
    }
  }
  const data = revertData(e);
  if (data) {
    try {
      const d = decodeErrorResult({ abi: [...relayErrorsAbi, { type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }], data });
      if (d.errorName === "Error") return { errorName: null, reason: String(d.args[0]) };
      return { errorName: d.errorName, reason };
    } catch (decodeFailure) {
      return { errorName: null, reason: `${reason} (revert data ${data.slice(0, 10)} not in the known errors: ${decodeFailure instanceof Error ? decodeFailure.name : "?"})` };
    }
  }
  return { errorName: null, reason };
}

/** A revert is the chain answering; anything else (timeout, HTTP failure) is not a revert and is rethrown. */
const isRevert = (e: unknown) =>
  e instanceof BaseError && !e.walk((x) => x instanceof HttpRequestError || x instanceof TimeoutError) && Boolean(e.walk((x) => x instanceof ContractFunctionRevertedError) || revertData(e) || /revert/i.test(e.message));

export function relayChainFor(net: Network): RelayChain {
  const client = publicClientFor(net);
  return {
    chainId: () => client.getChainId(),
    blockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    read: async (to, fn, args, block) => {
      try {
        return await client.readContract({ address: to, abi: readAbi, functionName: fn as never, args: args as never, blockNumber: block });
      } catch (e) {
        if (isRevert(e)) {
          const d = decodeRevert(e);
          throw new ReadReverted(d.errorName, d.reason);
        }
        throw e;
      }
    },
    simulate: async (from, call): Promise<Simulation> => {
      try {
        await client.call({ account: from, to: call.to, data: call.data, blockTag: "latest" });
        return { ok: true };
      } catch (e) {
        if (!isRevert(e)) throw e;
        return { ok: false, ...decodeRevert(e) };
      }
    },
    estimateGas: (from, call) => client.estimateGas({ account: from, to: call.to, data: call.data }),
    gasPrice: () => client.getGasPrice(),
    balance: (address: Address) => client.getBalance({ address }),
    nonce: (address, tag) => client.getTransactionCount({ address, blockTag: tag }),
    sendRaw: async (raw) => {
      try {
        return await client.sendRawTransaction({ serializedTransaction: raw });
      } catch (e) {
        // The node answered with a JSON-RPC error: not taken. Anything else: we cannot tell (unknown).
        if (e instanceof BaseError && e.walk((x) => x instanceof RpcRequestError)) throw new SendError("rejected", e.shortMessage);
        throw new SendError("transport", e instanceof Error ? e.message.split("\n")[0] ?? "no answer" : String(e));
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
