// The same checks on the in-memory fake (always) and on a real Redis behind Upstash's REST API (when
// SHAIDA_KV_TEST_URL and SHAIDA_KV_TEST_TOKEN are set; `pnpm --filter @shaida/relay test:redis` with a local Redis +
// serverless-redis-http, evidence/kv-redis.md). The real run executes the Lua; the fake runs each script's emulation.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { memoryKv, upstashKv, type KvClient } from "@shaida/kv";
import { kvRelayStore, type RequestRecord } from "../src/index";

const url = process.env.SHAIDA_KV_TEST_URL;
const token = process.env.SHAIDA_KV_TEST_TOKEN;
const targets: { name: string; kv: () => KvClient }[] = [{ name: "in-memory fake", kv: () => memoryKv() }];
if (url && token) targets.push({ name: `Redis via REST at ${new URL(url).host}`, kv: () => upstashKv({ url, token }, { allowHttp: true }) });

const rec = (over: Partial<RequestRecord> & Pick<RequestRecord, "requestId" | "key">): RequestRecord => ({
  chainId: 440050, fn: "sweep", requestHash: `0x${"ab".repeat(32)}`, payer: null, state: "accepted", nonce: 0,
  hash: `0x${"cd".repeat(32)}`, gas: "1000", gasPrice: "1000000000", gasUsed: null, block: null, reverted: null, error: null,
  budgetDay: "2026-11-22", history: [{ state: "accepted", at: "2026-11-22T00:00:00.000Z" }], ...over,
});

for (const target of targets) {
  describe(`RS store conformance on ${target.name}`, () => {
    let kv: KvClient = target.kv();
    let prefix = "";
    const on = () => kvRelayStore(kv, { prefix, newToken: randomUUID, log: () => undefined });
    /** A store under a new prefix (a real database is shared between runs); on() is a second process on it. */
    const fresh = () => {
      kv = target.kv();
      prefix = `shaida:test:${randomUUID()}`;
      return on();
    };

    it("RS01 claim writes a record and its key only while the key's holder is the expected one", async () => {
      const s = fresh();
      const a = rec({ requestId: randomUUID(), key: "440050:nullifier:0x01" });
      assert.equal(await s.claim(a, null), true);
      assert.equal(await s.claim(a, null), true, "the same claim run twice (an HTTP retry) answers true");
      const b = rec({ requestId: randomUUID(), key: a.key });
      assert.equal(await s.claim(b, null), false, "the key is held: nothing written");
      assert.equal(await s.record(b.requestId), null);
      assert.equal((await s.holder(a.key))?.requestId, a.requestId);
      assert.equal(await s.claim(b, a.requestId), true, "with the holder named (it was dead), the key moves");
      assert.equal((await s.holder(a.key))?.requestId, b.requestId);
    });

    it("RS02 put replaces an existing record and refuses to create one", async () => {
      const s = fresh();
      const a = rec({ requestId: randomUUID(), key: "440050:vouch:0x02" });
      await s.claim(a, null);
      await s.put({ ...a, state: "mined", gasUsed: "900", block: "7", reverted: false });
      assert.equal((await s.record(a.requestId))?.state, "mined");
      await assert.rejects(s.put(rec({ requestId: randomUUID(), key: "x" })), /no record/);
    });

    it("RS03 the day's committed gas sums the day's records (limit while in flight, gasUsed once mined)", async () => {
      const s = fresh();
      const a = rec({ requestId: randomUUID(), key: "k:1", gas: "3000" });
      const b = rec({ requestId: randomUUID(), key: "k:2", gas: "5000" });
      const other = rec({ requestId: randomUUID(), key: "k:3", gas: "7000", budgetDay: "2026-11-23" });
      for (const r of [a, b, other]) await s.claim(r, null);
      await s.put({ ...b, state: "mined", gasUsed: "4000" });
      assert.equal(await s.gasCommitted("2026-11-22"), 7000n);
      assert.equal(await s.gasCommitted("2026-11-24"), 0n);
    });

    it("RS04 hit counts a sliding one-minute window per bucket", async () => {
      const s = fresh();
      const t0 = 1_800_000_000_000;
      assert.equal(await s.hit("ip:a", 2, t0), false);
      assert.equal(await s.hit("ip:a", 2, t0 + 10), false);
      assert.equal(await s.hit("ip:a", 2, t0 + 20), true, "third in a minute");
      assert.equal(await s.hit("ip:b", 2, t0 + 20), false, "buckets are separate");
      assert.equal(await s.hit("ip:a", 2, t0 + 60_011), false, "the first two fell out of the window");
    });

    it("RS05 the chain lock serializes two processes' tasks and is released after each, also after a failure", async () => {
      const s = fresh();
      const other = on();
      const order: string[] = [];
      const task = (name: string, fail = false) => (fail ? s : other).withChainLock(1, async () => {
        order.push(`${name}+`);
        await new Promise((r) => setTimeout(r, 20));
        order.push(`${name}-`);
        if (fail) throw new Error("task failed");
        return name;
      });
      const results = await Promise.allSettled([task("a", true), task("b")]);
      assert.deepEqual(order, ["a+", "a-", "b+", "b-"]);
      assert.equal(results[0]?.status, "rejected");
      assert.equal(await s.withChainLock(1, async () => "c"), "c", "free again");
    });
  });
}

if (!url || !token) {
  describe("RS store conformance on a real Redis", () => {
    it("RS00 not run: SHAIDA_KV_TEST_URL / SHAIDA_KV_TEST_TOKEN unset (the Lua was not executed in this run)", { skip: "INCONCLUSIVE: no Redis configured" }, () => undefined);
  });
}
