// What every call does first: refuse an unpinned bundle or an unusable network, then read the chain lazily (a link
// refused on its own content never touches the RPC). A failed read is a ReadFailed, which callers map to
// INCONCLUSIVE ChainUnreachable; a wrong chain is NotConfigured. Nothing else is caught.
import { ledgerAt, WrongChain, type LedgerReader } from "./ledger";
import { networkOf } from "./network";
import { bundledPins } from "./pins";
import { rpcOf, type Rpc } from "./rpc";
import type { NetworkConfig, ReadOptions } from "./types";

export class ReadFailed extends Error {
  constructor(readonly what: string, cause: unknown) {
    super(`${what}: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`);
    this.name = "ReadFailed";
  }
}

/**
 * underwrite's refusal to run at all (a Decision is about a link; this is about the setup): the bundle failed its
 * pins, the network is unknown or invalid, or the RPC serves another chain. code is always NotConfigured.
 */
export class ShaidaConfigError extends Error {
  readonly code = "NotConfigured" as const;
  constructor(message: string) {
    super(message);
    this.name = "ShaidaConfigError";
  }
}

export interface Session {
  readonly net: NetworkConfig;
  readonly rpc: Rpc;
  /** The ledger at the latest block, loaded on first use. Throws ReadFailed or WrongChain. */
  readonly ledger: () => Promise<LedgerReader>;
  /** Runs one chain read; turns any failure into ReadFailed. */
  readonly read: <T>(what: string, f: (l: LedgerReader) => Promise<T>) => Promise<T>;
}

export function sessionOf(o: ReadOptions): { ok: true; value: Session } | { ok: false; why: string } {
  const pins = bundledPins();
  if (!pins.ok) return { ok: false, why: `${pins.why}. The SDK refuses to verify with a key or config it was not built with` };
  const net = networkOf(o.network);
  if (!net.ok) return { ok: false, why: net.why };
  const url = o.rpcUrl ?? net.value.rpcUrl;
  if (url === null) return { ok: false, why: `network ${net.value.name} has no default RPC: pass rpcUrl` };
  if (!/^https?:\/\//.test(url)) return { ok: false, why: `rpcUrl must be an http(s) URL, not ${JSON.stringify(url)}` };
  const rpc = rpcOf(url, o.timeoutMs ?? 15_000);
  let loaded: Promise<LedgerReader> | null = null;
  const ledger = () =>
    (loaded ??= ledgerAt(rpc, net.value).catch((e: unknown) => {
      throw e instanceof WrongChain ? e : new ReadFailed(`reading ${net.value.name} at ${url}`, e);
    }));
  const read = async <T>(what: string, f: (l: LedgerReader) => Promise<T>): Promise<T> => {
    const l = await ledger();
    try {
      return await f(l);
    } catch (e) {
      throw new ReadFailed(what, e);
    }
  };
  return { ok: true, value: { net: net.value, rpc, ledger, read } };
}

export { WrongChain };
