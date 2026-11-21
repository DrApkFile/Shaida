"use client";
// Who signs as the payer: the connected wallet, or (make fork only) a demo key kept in the vault, labelled as demo.
import { useMemo } from "react";
import type { Address, Hex, TypedDataDefinition } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useAccount, useConfig } from "wagmi";
import { signTypedData } from "wagmi/actions";
import { useNetwork } from "./network";
import { useVault } from "./vault";

/** The only chain a browser-held demo payer key may sign for (D21). */
export const DEMO_CHAIN_ID = 440050;
export const DEMO_PAYER_NAME = "Acme Studio (demo)";

export interface PayerSigner {
  readonly kind: "wallet" | "demo";
  readonly address: Address;
  readonly label: string;
  sign(td: TypedDataDefinition): Promise<Hex>;
}

export function usePayer(prefer: "wallet" | "demo"): PayerSigner | null {
  const { net } = useNetwork();
  const vault = useVault();
  const config = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const demoKey = vault.data?.demoPayerKey ?? null;
  return useMemo(() => {
    if (prefer === "demo") {
      if (net.chain.id !== DEMO_CHAIN_ID || !demoKey) return null;
      const acct = privateKeyToAccount(demoKey as Hex);
      return { kind: "demo", address: acct.address, label: DEMO_PAYER_NAME, sign: (td) => acct.signTypedData(td as never) };
    }
    if (!isConnected || !address || chainId !== net.chain.id) return null;
    return { kind: "wallet", address, label: "Your wallet", sign: (td) => signTypedData(config, td as never) };
  }, [prefer, net.chain.id, demoKey, isConnected, address, chainId, config]);
}
