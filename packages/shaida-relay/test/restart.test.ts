// The Redis store across processes and restarts. One memoryKv stands for one Upstash database; each kvStoreOn(kv)
// over it is one server process. A "crash" is a store call that throws after (or before) its write reached the
// database, so the process's request dies at exactly that point.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryKv, type KvClient, type KvScript } from "@shaida/kv";
import { kvRelayStore, status, submit, type RelayDeps, type RelayReply } from "../src/index";
import { kvStoreOn, makeEnv, req } from "./helpers/env";

const recordOf = (r: RelayReply) => {
  if (!r.ok) assert.fail(`${r.error.code}: ${r.error.message}`);
  return r.record;
};

/** A kv whose process dies at `script`: after the script ran ("after") or before it reached the database ("before"). */
function dyingAt(kv: KvClient, script: string, when: "before" | "after"): KvClient {
  return {
    ...kv,
    run: async (s: KvScript, keys, args) => {
      if (s.name !== script) return kv.run(s, keys, args);
      if (when === "before") throw new Error("process died before the write");
      await kv.run(s, keys, args);
      throw new Error("process died after the write");
    },
  };
}

/** A second process on the same database and chain: same deps, its own store object. */
const processOn = (deps: RelayDeps, kv: KvClient): RelayDeps => ({ ...deps, store: kvStoreOn(kv) });

describe("relayer on Redis: restarts never cause a second send", () => {
  it("R23 a restart after the record was persisted but before the send: the retry gets that record, nothing is sent, status settles it by nonce", async () => {
    const kv = memoryKv();
    const env = makeEnv({ kv });
    const body = env.sweepBody();
    const dying = { ...env.deps, store: kvStoreOn(dyingAt(kv, "relay-claim", "after")) };
    await assert.rejects(submit("sweep", req(body), dying), /process died after the write/);
    assert.equal(env.chain.sent.length, 0, "the process died before sendRawTransaction");

    const restarted = processOn(env.deps, kv);
    const again = await submit("sweep", req(body), restarted);
    const rec = recordOf(again);
    assert.equal(again.ok && again.repeated, true, "answered from the persisted record");
    assert.equal(rec.state, "accepted");
    assert.equal(env.chain.sent.length, 0, "never sent by the retry");

    env.tick(31_000);
    assert.equal(recordOf(await status(rec.requestId, restarted)).state, "unknown", "stale accepted → unknown, not resent");
    env.chain.latest = rec.nonce + 1; // another tx took the nonce, so this one can never land
    assert.equal(recordOf(await status(rec.requestId, restarted)).state, "dropped");
    const fresh = recordOf(await submit("sweep", req(body), restarted));
    assert.notEqual(fresh.requestId, rec.requestId, "only a dropped key is submitted again");
    assert.equal(env.chain.sent.length, 1);
  });

  it("R24 a restart after the send but before `pending` was recorded: the retry is answered from the record and the receipt settles it", async () => {
    const kv = memoryKv();
    const env = makeEnv({ kv });
    const body = env.sweepBody();
    const dying = { ...env.deps, store: kvStoreOn(dyingAt(kv, "relay-put", "before")) };
    await assert.rejects(submit("sweep", req(body), dying), /process died before the write/);
    assert.equal(env.chain.sent.length, 1, "the tx reached the node");

    const restarted = processOn(env.deps, kv);
    const again = recordOf(await submit("sweep", req(body), restarted));
    assert.equal(again.state, "accepted");
    assert.equal(env.chain.sent.length, 1, "no second send");
    env.chain.mine(again.hash, "success", 2_640_000n);
    const settled = recordOf(await status(again.requestId, restarted));
    assert.equal(settled.state, "mined");
    assert.equal(settled.gasUsed, "2640000");
    assert.equal(env.chain.sent.length, 1);
  });

  it("R25 two processes get the same request at once: one send, and the other answers with that record", async () => {
    const kv = memoryKv();
    const env = makeEnv({ kv });
    const body = env.sweepBody();
    const [a, b] = await Promise.all([submit("sweep", req(body), processOn(env.deps, kv)), submit("sweep", req(body), processOn(env.deps, kv))]);
    assert.equal(recordOf(a).requestId, recordOf(b).requestId);
    assert.equal(env.chain.sent.length, 1);
  });

  it("R26 two processes get different requests spending one note at once: one is sent, the other is AlreadySpent", async () => {
    const kv = memoryKv();
    const env = makeEnv({ kv });
    const one = env.sweepBody();
    const other = { ...env.sweepBody(), transfer: { ...env.sweepBody().transfer, nullifier: one.transfer.nullifier } };
    env.chain.knownRoots.add(other.transfer.root);
    const replies = await Promise.all([submit("sweep", req(one), processOn(env.deps, kv)), submit("sweep", req(other), processOn(env.deps, kv))]);
    assert.deepEqual(replies.map((r) => (r.ok ? "sent" : r.error.code)).sort(), ["AlreadySpent", "sent"]);
    assert.equal(env.chain.sent.length, 1);
  });

  it("R27 a lock held by another live process refuses as RelayerUnavailable with nothing sent; a dead process's lock expires at its lease", async () => {
    let clock = 0;
    const kv = memoryKv({ nowMs: () => clock });
    const env = makeEnv({ kv });
    await kv.set("shaida:v1:relay:lock:440050", "held-by-a-dead-process", { nx: true, pxMs: 120_000 });
    const waiting = { ...env.deps, store: kvRelayStore(kv, { newToken: () => "b", lockWaitMs: 30, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: () => undefined }) };
    const busy = await submit("sweep", req(env.sweepBody()), waiting);
    assert.equal(busy.ok ? "sent" : busy.error.code, "RelayerUnavailable");
    assert.equal(env.chain.sent.length, 0);
    clock += 120_001;
    recordOf(await submit("sweep", req(env.sweepBody()), waiting));
    assert.equal(env.chain.sent.length, 1);
    assert.equal(await kv.get("shaida:v1:relay:lock:440050"), null, "released after the send");
  });

  it("R28 records survive in the database: a new process reads the budget, the day's records and each record by id", async () => {
    const kv = memoryKv();
    const env = makeEnv({ kv, limits: { dailyGasBudget: 5_000_000n } });
    env.chain.estimate = 2_000_000n;
    const first = recordOf(await submit("sweep", req(env.sweepBody()), env.deps));
    const later = processOn(env.deps, kv);
    assert.equal((await later.store.record(first.requestId))?.hash, first.hash);
    const second = await submit("sweep", req(env.sweepBody()), later);
    assert.equal(second.ok ? "ok" : second.error.code, "RelayerBudgetExceeded", "the first process's 2.6M reservation is seen");
    assert.equal(env.chain.sent.length, 1);
  });
});

describe("relayer on Redis: the claim is a compare-and-set", () => {
  it("R29 two processes that both saw the key free claim it at once: exactly one record is written", async () => {
    const kv = memoryKv();
    const env = makeEnv({ kv });
    const a = recordOf(await submit("sweep", req(env.sweepBody()), env.deps));
    const twin = (id: string) => ({ ...a, requestId: id, key: "440050:nullifier:0xfree" });
    const [one, two] = await Promise.all([kvStoreOn(kv).claim(twin("00000000-0000-4000-8000-0000000000aa"), null), kvStoreOn(kv).claim(twin("00000000-0000-4000-8000-0000000000bb"), null)]);
    assert.deepEqual([one, two].sort(), [false, true]);
    const holder = await kvStoreOn(kv).holder("440050:nullifier:0xfree");
    assert.ok(holder && [twin("00000000-0000-4000-8000-0000000000aa").requestId, twin("00000000-0000-4000-8000-0000000000bb").requestId].includes(holder.requestId));
  });

  it("R29 a claim retried by the HTTP client after it already landed answers true again and writes nothing new", async () => {
    const kv = memoryKv();
    const env = makeEnv({ kv });
    const a = recordOf(await submit("sweep", req(env.sweepBody()), env.deps));
    const store = kvStoreOn(kv);
    const fresh = { ...a, requestId: "00000000-0000-4000-8000-0000000000cc", key: "440050:nullifier:0xretry" };
    assert.equal(await store.claim(fresh, null), true);
    assert.equal(await store.claim(fresh, null), true, "same id already holds the key: the first run landed");
    assert.equal(await store.claim({ ...fresh, requestId: "00000000-0000-4000-8000-0000000000dd" }, null), false);
  });

  it("R29 put never creates a record that was not claimed", async () => {
    const env = makeEnv({ kv: memoryKv() });
    const a = recordOf(await submit("sweep", req(env.sweepBody()), env.deps));
    await assert.rejects(env.deps.store.put({ ...a, requestId: "00000000-0000-4000-8000-0000000000ee" }), /no record/);
  });
});
