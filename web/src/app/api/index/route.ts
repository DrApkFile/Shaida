import { NextResponse, type NextRequest } from "next/server";
import { shaidaError } from "@shaida/proofs";
import { networkByChainId } from "@/lib/env";
import { shaidaSetup } from "@/lib/shaida";
import { syncFor } from "@/server/indexer";

/**
 * GET /api/index?chainId=… — leaf snapshot of the Gloam pool tree, the Shaida ledger tree and the pay-memo board,
 * synced from a persisted cursor in ≤1,000-block pages before answering. Public data only. The client rebuilds
 * both roots and checks isKnownRoot on chain before using any leaf (PRD §8 A7).
 */
export const runtime = "nodejs";

const fail = (status: number, code: "NotConfigured" | "UnknownRoot", message: string) =>
  NextResponse.json({ error: shaidaError(code, message) }, { status, headers: { "cache-control": "no-store" } });

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("chainId");
  const net = raw && /^\d{1,10}$/.test(raw) ? networkByChainId(Number(raw)) : undefined;
  if (!net) return fail(400, "NotConfigured", "This network isn't enabled in the app. Nothing was read.");
  const setup = shaidaSetup(net.key);
  if (!setup.ok) {
    console.error("[index] not configured:", setup.problem);
    return fail(503, "NotConfigured", process.env.NODE_ENV === "production" ? "The index isn't set up for this network." : setup.problem);
  }
  try {
    const reply = await syncFor(net, setup.contracts);
    return NextResponse.json(reply, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[index] sync failed", net.chain.id, e);
    return fail(502, "UnknownRoot", "The index could not read the chain. Nothing changed; try again shortly.");
  }
}
