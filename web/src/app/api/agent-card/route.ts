import { NextResponse } from "next/server";
import { agentCard } from "@shaida/underwrite";
import { cardInput, originOf } from "@/server/underwrite-info";

/** The bot's agent card, served at /.well-known/agent.json (rewrite in next.config.ts). Built from the running config. */
export const runtime = "nodejs";

export function GET(req: Request) {
  return NextResponse.json(agentCard(cardInput(originOf(req))), { headers: { "cache-control": "public, max-age=300" } });
}
