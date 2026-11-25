import type { Chain } from "viem";
import { aevumFork, aevumTestnet, localAnvil } from "@aevum-kit/aevum";
import { parseNetworkKeys, WebConfigError, type NetworkKey } from "./web-config";

export type { NetworkKey };

export interface Network {
  key: NetworkKey;
  /** Short name for the network switcher. */
  label: string;
  chain: Chain;
  /** Explorer links only make sense on the real testnet. */
  hasExplorer: boolean;
}


// NEXT_PUBLIC_* values must be written out in full so Next.js can inline them into the browser bundle.
const all: Record<NetworkKey, Network> = {
  aevum: {
    key: "aevum",
    label: "Aevum testnet",
    chain: aevumTestnet,
    hasExplorer: true,
  },
  fork: {
    key: "fork",
    label: "Local fork",
    chain: aevumFork,
    hasExplorer: false,
  },
  local: {
    key: "local",
    label: "Local anvil",
    chain: localAnvil,
    hasExplorer: false,
  },
};

// Required and checked: an unset, unknown or repeated key is a named refusal (WebConfigError), never a fallback to
// production. The build (next.config.ts) and the server start (startup.node.ts) refuse the same config first.
const requested = parseNetworkKeys(process.env.NEXT_PUBLIC_NETWORKS);
if (!requested.ok) throw new WebConfigError([requested.problem]);

/** The networks the app offers, in the order of NEXT_PUBLIC_NETWORKS. The first one is the default. */
export const networks: [Network, ...Network[]] = [all[requested.value[0]], ...requested.value.slice(1).map((k) => all[k])];

export const defaultNetwork = networks[0];

export function networkByChainId(chainId: number | undefined): Network | undefined {
  return networks.find((n) => n.chain.id === chainId);
}

export function networkByKey(key: string | null | undefined): Network | undefined {
  return networks.find((n) => n.key === key);
}

export const walletConnectProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || undefined;

/** Where the "Source" links and the clone command on the Docs page point. Override it for a fork or a preview deploy. */
export const repoUrl = (process.env.NEXT_PUBLIC_REPO_URL?.trim() || "https://github.com/DrApkFile/Shaida").replace(/\.git$|\/+$/g, "");
