// The bot's settings and its recording lock (D30).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryKv } from "@shaida/kv";
import { ATTEST_GAS, botSettingsFromEnv, kvLock, LockBusy, UnderwriteConfigError } from "../src/index";

const K1 = `0x${"11".repeat(32)}`;
const K2 = `0x${"22".repeat(32)}`;

describe("bot settings (D30)", () => {
  it("U24 recording is off unless UNDERWRITE_RECORD=on; off needs no key and holds none", () => {
    for (const env of [{}, { UNDERWRITE_RECORD: "off" }, { UNDERWRITE_RECORD: "off", UNDERWRITE_BOT_PRIVATE_KEY: K1 }]) {
      const s = botSettingsFromEnv(env);
      assert.equal(s.recorder.enabled, false);
      assert.equal(s.botKey, null);
    }
    const on = botSettingsFromEnv({ UNDERWRITE_RECORD: "on", UNDERWRITE_BOT_PRIVATE_KEY: K1.slice(2), RELAYER_PRIVATE_KEY: K2 });
    assert.equal(on.recorder.enabled, true);
    assert.equal(on.botKey, K1);
    assert.equal(on.recorder.dailyCount, 3);
    assert.equal(on.recorder.dailyGas, 3n * ATTEST_GAS);
  });
  it("U24b refuses to start: a bad switch, on without a key, a malformed key, the relayer's own key, caps out of range", () => {
    for (const env of [
      { UNDERWRITE_RECORD: "yes" },
      { UNDERWRITE_RECORD: "on" },
      { UNDERWRITE_RECORD: "on", UNDERWRITE_BOT_PRIVATE_KEY: "0x1234" },
      { UNDERWRITE_RECORD: "on", UNDERWRITE_BOT_PRIVATE_KEY: K1, RELAYER_PRIVATE_KEY: K1.slice(2).toUpperCase() },
      { UNDERWRITE_DAILY_RECORDS: "0" }, { UNDERWRITE_DAILY_RECORDS: "51" }, { UNDERWRITE_DAILY_GAS: "1000" }, { UNDERWRITE_DAILY_RECORDS: "2.5" },
    ]) assert.throws(() => botSettingsFromEnv(env), UnderwriteConfigError, JSON.stringify(env));
  });
});

describe("recording lock (D30)", () => {
  it("U25 one holder at a time; released after the task, also when it throws; a stuck holder gives LockBusy", async () => {
    const kv = memoryKv();
    let n = 0;
    const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms / 50)); // 250 ms of waiting = 5 ms here
    const lock = kvLock(kv, { key: "lock", leaseMs: 60_000, waitMs: 60_000, newToken: () => `t${n++}`, sleep: tick });
    let inside = 0;
    let most = 0;
    await Promise.all([1, 2, 3].map(() => lock(async () => { inside++; most = Math.max(most, inside); await new Promise((r) => setTimeout(r, 5)); inside--; })));
    assert.equal(most, 1);
    await assert.rejects(lock(async () => { throw new Error("task failed"); }), /task failed/);
    assert.equal(await lock(async () => "free again"), "free again");
    await kv.set("lock", "someone-else", { pxMs: 60_000 });
    const impatient = kvLock(kv, { key: "lock", leaseMs: 60_000, waitMs: 500, newToken: () => "late", sleep: tick });
    await assert.rejects(impatient(async () => "never"), LockBusy);
  });
});
