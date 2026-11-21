import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { submit, type RelayFn, type RelayReply } from "@shaida/relay";
import { relayDeps } from "./relayer";

/** The real client IP for rate limits (kit rule: a trusted host header first, else the last X-Forwarded-For hop). */
export function clientIp(req: NextRequest): string {
  const trusted = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (trusted) return req.headers.get(trusted)?.split(",")[0]?.trim() || "unknown";
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",").at(-1)?.trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Body limit: a deposit or transfer body is under 2 KB, a memo under 5 KB. */
const MAX_BODY_BYTES = 16_384;

export const json = (reply: RelayReply) =>
  NextResponse.json(reply.ok ? { record: reply.record, repeated: reply.repeated } : { error: reply.error }, { status: reply.status, headers: { "cache-control": "no-store" } });

/** The whole route for one relayed function. The function is fixed by the file the route lives in. */
export async function relayPost(fn: RelayFn, req: NextRequest) {
  const reply = await submit(fn, {
    ip: clientIp(req),
    readBody: async () => {
      const text = await req.text();
      if (text.length > MAX_BODY_BYTES) throw new RangeError("body too large");
      return JSON.parse(text) as unknown;
    },
  }, relayDeps);
  return json(reply);
}
