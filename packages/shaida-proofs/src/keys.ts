// The income circuit's verification key from the ceremony's FINAL zkey (ceremony/record.json final.vkey, sha256
// 2635a810…; checked by tools/check-artifacts.mjs). The only vkey the app verifies with.
import vkey from "../keys/income_final_vkey.json";

export const INCOME_FINAL_VKEY: Readonly<Record<string, unknown>> = vkey;
