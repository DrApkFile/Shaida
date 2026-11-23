// The bot's server settings (D30), checked once at startup: a bad value stops the server instead of running a bot
// that records with the wrong key or no cap. Recording is off unless UNDERWRITE_RECORD=on.
import { ATTEST_GAS } from "./calldata";
import { RECORDER_DEFAULTS, type RecorderConfig } from "./record";

export class UnderwriteConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnderwriteConfigError";
  }
}

export interface BotSettings {
  readonly recorder: RecorderConfig;
  /** The bot's own key (0x + 64 hex), present only when recording is on. Never logged. */
  readonly botKey: `0x${string}` | null;
}

const KEY = /^0x[0-9a-fA-F]{64}$/;
const withPrefix = (raw: string) => (raw.startsWith("0x") ? raw : `0x${raw}`);

function whole(env: Readonly<Record<string, string | undefined>>, name: string, fallback: bigint, min: bigint, max: bigint): bigint {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new UnderwriteConfigError(`${name} must be a whole number`);
  const n = BigInt(raw);
  if (n < min || n > max) throw new UnderwriteConfigError(`${name} must be between ${min} and ${max}`);
  return n;
}

export function botSettingsFromEnv(env: Readonly<Record<string, string | undefined>>): BotSettings {
  const switchRaw = env.UNDERWRITE_RECORD?.trim().toLowerCase() ?? "off";
  if (switchRaw !== "on" && switchRaw !== "off" && switchRaw !== "") throw new UnderwriteConfigError("UNDERWRITE_RECORD must be on or off");
  const dailyCount = Number(whole(env, "UNDERWRITE_DAILY_RECORDS", BigInt(RECORDER_DEFAULTS.dailyCount), 1n, 50n));
  const dailyGas = whole(env, "UNDERWRITE_DAILY_GAS", RECORDER_DEFAULTS.dailyGas, ATTEST_GAS, 50n * ATTEST_GAS);
  if (switchRaw !== "on") return { recorder: { enabled: false, dailyCount, dailyGas }, botKey: null };

  const raw = env.UNDERWRITE_BOT_PRIVATE_KEY?.trim();
  if (!raw) throw new UnderwriteConfigError("UNDERWRITE_RECORD=on needs UNDERWRITE_BOT_PRIVATE_KEY (the bot's own key)");
  const key = withPrefix(raw);
  if (!KEY.test(key)) throw new UnderwriteConfigError("UNDERWRITE_BOT_PRIVATE_KEY is not a 32-byte hex key");
  const relayer = env.RELAYER_PRIVATE_KEY?.trim();
  if (relayer && withPrefix(relayer).toLowerCase() === key.toLowerCase()) {
    throw new UnderwriteConfigError("UNDERWRITE_BOT_PRIVATE_KEY must not be the relayer's key (least privilege, D30)");
  }
  return { recorder: { enabled: true, dailyCount, dailyGas }, botKey: key as `0x${string}` };
}
