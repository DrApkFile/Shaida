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

/**
 * The underwriting bot's presets and settings (D30). Loading @shaida/underwrite parses config/underwrite-policies.json
 * (a bad file throws PolicyConfigError while loading, so the import sits inside the try); a bad UNDERWRITE_* value
 * stops the server rather than recording with the wrong key or without a cap.
 */
export async function checkBotAtStartup(): Promise<void> {
  try {
    const { botSettingsFromEnv, PRESETS } = await import("@shaida/underwrite");
    const s = botSettingsFromEnv(process.env);
    console.info(`[startup] underwriting bot: presets ${PRESETS.map((p) => `${p.id}@${p.version}`).join(", ")}; recording ${s.recorder.enabled ? `on (${s.recorder.dailyCount}/day, ${s.recorder.dailyGas} gas/day)` : "off"}`);
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name !== "UnderwriteConfigError" && name !== "PolicyConfigError") throw e;
    console.error(`[startup] ${(e as Error).message}`);
    process.exit(78); // EX_CONFIG
  }
}
