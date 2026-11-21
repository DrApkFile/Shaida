import { NextResponse, type NextRequest } from "next/server";
import { RELAY_FNS, isNetwork } from "@shaida/relay";
import { networkByChainId } from "@/lib/env";
import { relayDeps } from "@/server/relayer";

/**
 * GET /api/relay?chainId=…: whether gasless mode works on this network, and the relayer's address.
 * The relayer has one POST route per contract function (deposit, vouched-pay, late-vouch, sweep, memo) and never
 * forwards arbitrary calldata. Based on the Aevum Starter Kit's relay route (MIT, (c) 2026 PQA Labs), hardened per
 * briefing/AEVUM_INTEGRATION.md §4 (DECISIONS D19).
 */
export const runtime = "nodejs";

export function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("chainId");
  const chainId = raw && /^\d{1,10}$/.test(raw) ? Number(raw) : NaN;
  const net = Number.isFinite(chainId) ? networkByChainId(chainId) : undefined;
  const deps = net ? relayDeps.network(chainId) : null;
  const enabled = deps !== null && isNetwork(deps);
  return NextResponse.json(
    { enabled, relayer: enabled ? deps.signer.address : null, functions: RELAY_FNS, reason: deps && !isNetwork(deps) ? deps : null },
    { headers: { "cache-control": "no-store" } },
  );
}
