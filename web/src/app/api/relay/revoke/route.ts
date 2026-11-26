import type { NextRequest } from "next/server";
import { relayPost } from "@/server/relay-route";

/** POST /api/relay/revoke: relays exactly Revocations.revoke (D35). Rails: packages/shaida-relay/src/functions.ts. */
export const runtime = "nodejs";

export const POST = (req: NextRequest) => relayPost("revoke", req);
