import { NextResponse, type NextRequest } from "next/server";
import { shaidaError } from "@shaida/proofs";
import { handleUnderwrite, MAX_BODY_BYTES } from "@shaida/underwrite";
import { clientIp } from "@/server/relay-route";
import { handleDeps } from "@/server/underwrite";
import { cardInput, originOf } from "@/server/underwrite-info";

/**
 * The underwriting bot (D30). GET: presets, limits and whether recording is on. POST {link, preset, record?}:
 * the decision (APPROVE / DECLINE with reasons / INCONCLUSIVE) and, when asked and allowed, the on-chain record.
 * The link is used for this one decision and never logged or kept; recorded proofs are kept as a hash.
 */
export const runtime = "nodejs";
const noStore = { "cache-control": "no-store" };

export function GET(req: NextRequest) {
  const c = cardInput(originOf(req));
  return NextResponse.json({
    chainId: c.chainId,
    presets: c.policies.map((p) => ({
      id: p.id, version: p.version, hash: p.hash, title: p.title, audience: p.audience, readerName: p.readerName,
      minThreshold: p.minThreshold.toString(), minPayments: p.minPayments, minPeriodDays: p.minPeriodDays, maxPeriodDays: p.maxPeriodDays,
      maxProofAgeDays: p.maxProofAgeDays, minDaysLeft: p.minDaysLeft,
    })),
    limits: c.limits,
    recording: { enabled: c.recorder.enabled, dailyCount: c.recorder.dailyCount, dailyGas: c.recorder.dailyGas.toString(), botAddress: c.botAddress },
  }, { headers: noStore });
}

export async function POST(req: NextRequest) {
  const deps = handleDeps();
  if (!deps) return NextResponse.json({ error: shaidaError("NotConfigured", "The bot isn't set up for this network. Nothing was decided.") }, { status: 503, headers: noStore });
  const reply = await handleUnderwrite({
    ip: clientIp(req),
    readText: async () => {
      const declared = Number(req.headers.get("content-length") ?? "0");
      if (declared > MAX_BODY_BYTES) throw new RangeError("body too large");
      return req.text();
    },
  }, deps);
  return NextResponse.json(reply.body, { status: reply.status, headers: noStore });
}
