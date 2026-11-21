import type { NextRequest } from "next/server";
import { status } from "@shaida/relay";
import { json } from "@/server/relay-route";
import { relayDeps } from "@/server/relayer";

/** GET /api/relay/status?id=…: a relayed request's record, settled by its hash. Never resends. */
export const runtime = "nodejs";

export const GET = async (req: NextRequest) => json(await status(req.nextUrl.searchParams.get("id") ?? "", relayDeps));
