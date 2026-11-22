/**
 * Runs once when the server starts, before it serves a request. In production a server with no usable Redis store
 * refuses to start (StoreNotConfigured) and the process exits: it never runs with request records it would lose on
 * restart. Measured: a throw here alone leaves `next start` up and answering 500 on every route, which a host would
 * count as a live deploy, so the process exits instead (D29).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { chooseStore, StoreNotConfigured } = await import("@shaida/kv");
  try {
    const choice = chooseStore(process.env);
    console.info(`[startup] state store: ${choice.kind}${choice.kind === "redis" ? ` (${new URL(choice.env.url).host})` : ""}; build ${process.env.SHAIDA_BUILD_COMMIT ?? "—"}`);
  } catch (e) {
    if (!(e instanceof StoreNotConfigured)) throw e;
    console.error(`[startup] ${e.message}`);
    process.exit(78); // EX_CONFIG
  }
}
