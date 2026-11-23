import { llmsTxt } from "@shaida/underwrite";
import { cardInput, originOf } from "@/server/underwrite-info";

/** /llms.txt: what Shaida is and how an agent uses the underwriting bot. Built from the running config. */
export const runtime = "nodejs";

export function GET(req: Request) {
  return new Response(llmsTxt(cardInput(originOf(req))), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}
