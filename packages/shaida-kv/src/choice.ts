// Which store the server keeps its state in. Chosen from the environment once, at startup, and refused by name when
// it is not usable. There is no fallback: a production server without Redis does not start.
import { upstashEnv, type UpstashEnv } from "./upstash";

export type StoreChoice =
  | { readonly kind: "redis"; readonly env: UpstashEnv }
  | { readonly kind: "file" };

/** The named startup refusal. Its message lists what to set; it never contains a secret value. */
export class StoreNotConfigured extends Error {
  constructor(reason: string) {
    super(`StoreNotConfigured: ${reason}`);
    this.name = "StoreNotConfigured";
  }
}

/**
 * SHAIDA_STORE = "redis" | "file", or unset: unset means redis under NODE_ENV=production and file otherwise.
 * "file" is for local dev and tests; it is refused on Render (RENDER is set there), whose disk is wiped on every
 * deploy, restart and spin-down.
 */
export function chooseStore(env: Readonly<Record<string, string | undefined>>): StoreChoice {
  const asked = env.SHAIDA_STORE?.trim() ?? "";
  if (asked !== "" && asked !== "redis" && asked !== "file") throw new StoreNotConfigured(`SHAIDA_STORE must be "redis" or "file", not "${asked.slice(0, 20)}"`);
  const kind = asked === "" ? (env.NODE_ENV === "production" ? "redis" : "file") : asked;
  if (kind === "file") {
    if (env.RENDER) throw new StoreNotConfigured("SHAIDA_STORE=file on Render: its disk is wiped on deploy, restart and spin-down, so request records would be lost. Use Redis.");
    return { kind: "file" };
  }
  const up = upstashEnv(env);
  if ("missing" in up) throw new StoreNotConfigured(`the relayer and index store is Redis${asked ? "" : " (production)"}, but ${up.missing.join(" and ")} ${up.missing.length > 1 ? "are" : "is"} not set. Nothing was started.`);
  return { kind: "redis", env: up };
}
