import "server-only";
import { PRESETS, UNDERWRITE_LIMITS, type CardInput } from "@shaida/underwrite";
import { repoUrl } from "@/lib/env";
import { botAddress, botNetwork, botSettings } from "./underwrite";

/** What the bot page, the agent card and llms.txt say about this deployment: all from the running config. */
export function cardInput(origin: string): CardInput {
  return {
    origin,
    chainId: botNetwork()?.net.chain.id ?? null,
    policies: PRESETS,
    limits: UNDERWRITE_LIMITS,
    recorder: botSettings().recorder,
    botAddress: botAddress(),
    repoUrl,
  };
}

/** The public origin of a request (Render sets x-forwarded-host / -proto; else the URL's own). */
export function originOf(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
