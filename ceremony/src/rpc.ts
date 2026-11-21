// Minimal JSON-RPC reads over HTTPS (Aevum has no WebSocket): chain id, head, one block. Every reply is
// checked against a strict schema; transport errors are retried with backoff, then thrown.
import { z } from "zod";

const quantity = z.string().regex(/^0x[0-9a-f]+$/i).transform((h) => Number.parseInt(h, 16));
const blockSchema = z.object({
  number: quantity,
  hash: z.string().regex(/^0x[0-9a-f]{64}$/),
  timestamp: quantity,
});
export type Block = z.infer<typeof blockSchema>;

const replySchema = z.union([
  z.object({ jsonrpc: z.literal("2.0"), id: z.number(), result: z.unknown() }),
  z.object({ jsonrpc: z.literal("2.0"), id: z.number(), error: z.object({ code: z.number(), message: z.string() }) }),
]);

export class Rpc {
  private id = 0;
  constructor(readonly url: string, private readonly attempts = 4) {}

  private async call(method: string, params: unknown[]): Promise<unknown> {
    let last: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const res = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const reply = replySchema.parse(await res.json());
        if ("error" in reply) throw new Error(`${method}: RPC error ${reply.error.code} ${reply.error.message}`);
        return reply.result;
      } catch (e) {
        last = e;
        if (attempt < this.attempts) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    throw new Error(`${method} on ${this.url} failed ${this.attempts} times: ${last instanceof Error ? last.message : String(last)}`);
  }

  async chainId(): Promise<number> {
    return quantity.parse(await this.call("eth_chainId", []));
  }

  async head(): Promise<Block> {
    return blockSchema.parse(await this.call("eth_getBlockByNumber", ["latest", false]));
  }

  /** null if the block is not mined yet. */
  async block(n: number): Promise<Block | null> {
    const result = await this.call("eth_getBlockByNumber", [`0x${n.toString(16)}`, false]);
    if (result === null) return null;
    const block = blockSchema.parse(result);
    if (block.number !== n) throw new Error(`asked for block ${n}, the RPC returned ${block.number}`);
    return block;
  }
}
