// The Node half of instrumentation.ts (kept apart so the Edge build never sees process.exit). A production server with
// no usable Redis store exits here (StoreNotConfigured): measured, a throw alone left `next start` up and answering
// 500 on every route, which a host counts as a live deploy (D29).
import { chooseStore, StoreNotConfigured } from "@shaida/kv";

export function checkStoreAtStartup(): void {
  try {
    const choice = chooseStore(process.env);
    console.info(`[startup] state store: ${choice.kind}${choice.kind === "redis" ? ` (${new URL(choice.env.url).host})` : ""}; build ${process.env.SHAIDA_BUILD_COMMIT ?? "—"}`);
  } catch (e) {
    if (!(e instanceof StoreNotConfigured)) throw e;
    console.error(`[startup] ${e.message}`);
    process.exit(78); // EX_CONFIG
  }
}
