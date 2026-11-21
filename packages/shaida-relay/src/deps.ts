import type { ShaidaError } from "@shaida/proofs";
import type { RelayLimits } from "./limits";
import type { RelayChain, RelayContracts, RelaySigner, RelayStore } from "./types";

/** Everything the relayer needs for one network. */
export interface NetworkDeps {
  readonly chainId: number;
  readonly chain: RelayChain;
  readonly signer: RelaySigner;
  readonly contracts: RelayContracts;
}

export interface RelayDeps {
  readonly store: RelayStore;
  readonly limits: RelayLimits;
  readonly nowMs: () => number;
  readonly newId: () => string;
  /** One line per state change: request id, function, state, hash, nonce, gas. Never bodies or signatures. */
  readonly log: (line: Readonly<Record<string, string | number | boolean | null>>) => void;
  /** The network for a chain id, or why it cannot relay there (NotConfigured, RelayerUnavailable). */
  readonly network: (chainId: number) => NetworkDeps | ShaidaError;
}

export const isNetwork = (n: NetworkDeps | ShaidaError): n is NetworkDeps => "chain" in n;
