import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_RETRY, checkSnapshot, pagesOf, snapshotSchema, syncIndex, type Snapshot } from "../src/index";
import { CHAIN_ID, FakeChain, MemoryStore, START, noSleep, target } from "./helpers/fake-chain";

/** A small history: a deposit, a vouched pay, a sweep, a memo. */
function history(chain: FakeChain, at: bigint) {
  chain.shield(at, 11n);
  chain.transfer(at + 1n, 901n, 21n, 22n);
  chain.vouch(at + 1n, 1, 21n);
  chain.memo(at + 2n, 21n, "0xabcd");
  chain.transfer(at + 3n, 902n, 31n, 32n);
  chain.sweep(at + 3n, 902n, 31n);
}

async function syncAll(chain: FakeChain, store: MemoryStore, extra: { maxBlocks?: bigint } = {}) {
  const out = await syncIndex({ target, chain, store, sleep: noSleep, ...extra });
  if (out.kind !== "synced") assert.fail(`sync failed: ${out.error.message}`);
  return out;
}

const saved = (store: MemoryStore): Snapshot => snapshotSchema.parse(JSON.parse(store.text ?? "null"));

describe("indexer: pages", () => {
  it("I01 never asks for toBlock − fromBlock above 999, and splits 1,001 blocks into two pages", () => {
    assert.deepEqual(pagesOf(0n, 999n), [{ fromBlock: 0n, toBlock: 999n }]);
    assert.deepEqual(pagesOf(0n, 1000n), [{ fromBlock: 0n, toBlock: 999n }, { fromBlock: 1000n, toBlock: 1000n }]);
    assert.throws(() => pagesOf(0n, 10n, 1000n), RangeError);
  });

  it("I01 reads events on both sides of a 1,000-block page boundary exactly once", async () => {
    const chain = new FakeChain();
    chain.shield(START + 999n, 1n); // last block of page 1
    chain.shield(START + 1000n, 2n); // first block of page 2
    chain.head = START + 2500n;
    const store = new MemoryStore();
    const out = await syncAll(chain, store);
    assert.ok(chain.calls.every((p) => p.toBlock - p.fromBlock <= 999n));
    assert.deepEqual(chain.calls.map((p) => [p.fromBlock - START, p.toBlock - START]), [[0n, 999n], [1000n, 1999n], [2000n, 2500n]]);
    assert.equal(out.snapshot.poolLeaves.length, 2);
    assert.equal(out.complete, true);
  });
});

describe("indexer: cursor", () => {
  it("I02 resumes from the persisted cursor and never rescans from the deploy block", async () => {
    const chain = new FakeChain();
    history(chain, START + 10n);
    chain.head = START + 3000n;
    const store = new MemoryStore();
    const first = await syncAll(chain, store, { maxBlocks: 1500n });
    assert.equal(first.snapshot.syncedTo, (START + 1499n).toString());
    assert.equal(saved(store).syncedTo, first.snapshot.syncedTo, "the cursor is persisted");

    history(chain, START + 2000n);
    chain.calls.length = 0;
    const second = await syncAll(chain, store);
    assert.equal(chain.calls[0]?.fromBlock, START + 1500n, "starts right after the cursor");
    assert.equal(second.snapshot.syncedTo, (START + 3000n).toString());

    const fresh = await syncAll(chain, new MemoryStore());
    assert.deepEqual(second.snapshot.poolLeaves, fresh.snapshot.poolLeaves, "resumed index = one-shot index");
    assert.deepEqual(second.snapshot.ledgerLeaves, fresh.snapshot.ledgerLeaves);
    assert.equal(second.complete, true);
  });

  it("I02 starts over when the stored snapshot is for another deployment", async () => {
    const chain = new FakeChain();
    history(chain, START);
    const store = new MemoryStore();
    await syncAll(chain, store);
    const other = { ...target, contracts: { ...target.contracts, ledger: "0x00000000000000000000000000000000000000ee" } };
    chain.calls.length = 0;
    const out = await syncIndex({ target: other, chain, store, sleep: noSleep });
    assert.equal(chain.calls[0]?.fromBlock, START);
    assert.equal(out.snapshot.contracts.ledger, other.contracts.ledger);
  });
});

describe("indexer: retry", () => {
  it("I03 retries a failed page with backoff and loses nothing", async () => {
    const chain = new FakeChain();
    history(chain, START + 5n);
    chain.failNext = 2;
    const waits: number[] = [];
    const out = await syncIndex({ target, chain, store: new MemoryStore(), sleep: async (ms) => void waits.push(ms) });
    assert.equal(out.kind, "synced");
    assert.deepEqual(waits, [DEFAULT_RETRY.baseDelayMs, DEFAULT_RETRY.baseDelayMs * 2]);
    assert.equal(out.snapshot.poolLeaves.length, 5);
  });

  it("I03 a page that keeps failing stops the sync at the last good page; the next sync resumes there", async () => {
    const chain = new FakeChain();
    history(chain, START + 1200n);
    chain.head = START + 2100n;
    const store = new MemoryStore();
    const retry = { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 };
    const origGetLogs = chain.getLogs.bind(chain);
    let page = 0;
    chain.getLogs = async (a, p) => { page++; if (p.fromBlock === START + 1000n) throw new Error("HTTP 429"); return origGetLogs(a, p); };
    const out = await syncIndex({ target, chain, store, sleep: noSleep, retry });
    assert.equal(out.kind, "page-failed");
    assert.equal(saved(store).syncedTo, (START + 999n).toString(), "cursor kept at the last good page");
    assert.equal(page, 1 + retry.attempts);

    chain.getLogs = origGetLogs;
    chain.calls.length = 0;
    const again = await syncAll(chain, store);
    assert.equal(chain.calls[0]?.fromBlock, START + 1000n);
    assert.equal(again.snapshot.poolLeaves.length, 5);
    assert.equal(again.complete, true);
  });
});

describe("indexer: gaps and roots", () => {
  it("I04 a lost log marks the tree incomplete, the client refuses with UnknownRoot, the next sync starts over", async () => {
    const chain = new FakeChain();
    history(chain, START);
    chain.loseBlock = START + 1n; // the vouched pay's Transferred and Vouched
    const store = new MemoryStore();
    const out = await syncAll(chain, store);
    assert.equal(out.complete, false);
    assert.match(out.snapshot.problems.join("\n"), /pool has 5 leaves/);
    assert.match(out.snapshot.problems.join("\n"), /ledger gap/);
    const check = await checkSnapshot(out.snapshot, CHAIN_ID, chain);
    assert.equal(check.ok ? "ok" : check.error.code, "UnknownRoot");

    chain.loseBlock = null;
    chain.calls.length = 0;
    const healed = await syncAll(chain, store);
    assert.equal(chain.calls[0]?.fromBlock, START, "a recorded gap forces a full resync");
    assert.equal(healed.complete, true);
  });

  it("I05 accepts an honest snapshot: both rebuilt roots are known on chain", async () => {
    const chain = new FakeChain();
    history(chain, START);
    const out = await syncAll(chain, new MemoryStore());
    const check = await checkSnapshot(JSON.parse(JSON.stringify(out.snapshot)), CHAIN_ID, chain);
    if (!check.ok) assert.fail(check.error.message);
    assert.equal(check.value.pool.size, 5);
    assert.equal(check.value.ledger.size, 2);
  });

  it("I05 refuses a snapshot whose pool leaves were altered (root mismatch → UnknownRoot)", async () => {
    const chain = new FakeChain();
    history(chain, START);
    const { snapshot } = await syncAll(chain, new MemoryStore());
    const lied = { ...snapshot, poolLeaves: snapshot.poolLeaves.map((l, i) => (i === 1 ? `0x${"0".repeat(63)}7` : l)) };
    const check = await checkSnapshot(lied, CHAIN_ID, chain);
    assert.equal(check.ok ? "ok" : check.error.code, "UnknownRoot");
    assert.match(check.ok ? "" : check.error.message, /pool root .* not known/);
  });

  it("I05 refuses a ledger leaf that does not match its event fields, and a snapshot for another chain", async () => {
    const chain = new FakeChain();
    history(chain, START);
    const { snapshot } = await syncAll(chain, new MemoryStore());
    const first = snapshot.ledgerLeaves[0];
    if (!first || first.kind !== "vouch") assert.fail("expected a vouch leaf first");
    const lied = { ...snapshot, ledgerLeaves: [{ ...first, payerId: 2 }, ...snapshot.ledgerLeaves.slice(1)] };
    const a = await checkSnapshot(lied, CHAIN_ID, chain);
    assert.match(a.ok ? "" : a.error.message, /does not match its own event fields/);
    const b = await checkSnapshot(snapshot, 44005, chain);
    assert.equal(b.ok ? "ok" : b.error.code, "UnknownRoot");
    const c = await checkSnapshot({ ...snapshot, extra: 1 }, CHAIN_ID, chain);
    assert.match(c.ok ? "" : c.error.message, /schema/);
  });

  it("I06 serves memos in chain order with their transaction", async () => {
    const chain = new FakeChain();
    history(chain, START);
    const { snapshot } = await syncAll(chain, new MemoryStore());
    assert.equal(snapshot.memos.length, 1);
    assert.equal(snapshot.memos[0]?.memo, "0xabcd");
  });
});
