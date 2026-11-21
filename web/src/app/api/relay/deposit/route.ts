import type { NextRequest } from "next/server";
import { relayPost } from "@/server/relay-route";

/** POST /api/relay/deposit: relays exactly one contract function. Rails: packages/shaida-relay/src/functions.ts. */
export const runtime = "nodejs";

export const POST = (req: NextRequest) => relayPost("deposit", req);
