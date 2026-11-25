// A minimal JSON-RPC client over fetch: the only network the SDK touches is the URL the caller passes (or the bundled
// public Aevum RPC). No retries hidden here: a failed call is thrown, and the caller turns it into INCONCLUSIVE.
export interface Rpc {
  readonly url: string;
  call<T>(method: string, params: readonly unknown[]): Promise<T>;
}

export class RpcError extends Error {
  constructor(message: string, readonly revertData: string | null = null) {
    super(message);
    this.name = "RpcError";
  }
}

let nextId = 1;

export function rpcOf(url: string, timeoutMs: number): Rpc {
  return {
    url,
    async call<T>(method: string, params: readonly unknown[]): Promise<T> {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new RpcError(`${method}: HTTP ${res.status} from ${url}`);
      const body = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
      if (body.error) throw new RpcError(`${method}: ${body.error.message} (${body.error.code})`, typeof body.error.data === "string" ? body.error.data : null);
      if (!("result" in body)) throw new RpcError(`${method}: no result from ${url}`);
      return body.result as T;
    },
  };
}

export const hexOf = (n: bigint): string => `0x${n.toString(16)}`;
export const word = (n: bigint): string => n.toString(16).padStart(64, "0");
