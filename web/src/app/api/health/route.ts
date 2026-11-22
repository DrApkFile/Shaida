import { NextResponse } from "next/server";
import { networks } from "@/lib/env";

/**
 * GET /api/health, for the uptime monitor that keeps the free instance awake. It reads only values fixed at
 * build and start: no RPC call, no Redis command, nothing written.
 */
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      commit: process.env.SHAIDA_BUILD_COMMIT ?? null,
      networks: networks.map((n) => ({ key: n.key, chainId: n.chain.id })),
      store: process.env.SHAIDA_STORE?.trim() || (process.env.NODE_ENV === "production" ? "redis" : "file"),
      at: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
