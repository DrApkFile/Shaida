"use client";
// Who sends "Record check" (attest): the connected wallet on the app's network, or on `make fork` only a demo signer
// (a fresh key made in this tab, funded with fork ETH by anvil_setBalance), labelled as demo. Legacy txs (CLAUDE.md).
import { useMemo, useState } from "react";
import { createWalletClient, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useAccount, useConfig } from "wagmi";
import { sendTransaction } from "wagmi/actions";
import { useNetwork } from "../network";
import { DEMO_CHAIN_ID } from "../payer";

export interface TxSender {
  readonly kind: "wallet" | "demo";
  readonly address: Address;
  readonly label: string;
  send(tx: { to: Hex; data: Hex; gas: bigint }): Promise<Hex>;
}

const ONE_ETH = "0xde0b6b3a7640000";

export function useAttestSender(prefer: "wallet" | "demo"): TxSender | null {
  const { net } = useNetwork();
  const config = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const [demoKey] = useState<Hex>(() => generatePrivateKey());
  return useMemo(() => {
    if (prefer === "demo") {
      if (net.chain.id !== DEMO_CHAIN_ID) return null;
      const rpc = net.chain.rpcUrls.default.http[0];
      if (!rpc) return null;
      const account = privateKeyToAccount(demoKey);
      const wallet = createWalletClient({ account, chain: net.chain, transport: http(rpc) });
      return {
        kind: "demo",
        address: account.address,
        label: "Demo signer (fork only)",
        send: async (tx) => {
          const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [account.address, ONE_ETH] }) });
          const body = (await res.json()) as { error?: { message?: string } };
          if (body.error) throw new Error(`could not fund the demo signer on the fork: ${body.error.message ?? "error"}`);
          return wallet.sendTransaction({ ...tx, type: "legacy", chain: net.chain });
        },
      };
    }
    if (!isConnected || !address || chainId !== net.chain.id) return null;
    return { kind: "wallet", address, label: "Your wallet", send: (tx) => sendTransaction(config, { ...tx, type: "legacy", chainId: net.chain.id }) };
  }, [prefer, net.chain, demoKey, isConnected, address, chainId, config]);
}
