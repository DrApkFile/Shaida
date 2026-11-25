// Unit tests of the audit's pure parts: the amount bounds (A1, A4), the expiry hint (reader) and the memo shape.
import assert from "node:assert/strict";
import { test } from "node:test";
import { amountModel, matchWithdrawals } from "../src/amounts.mjs";
import { memoShape } from "../src/memo.mjs";
import { expiryHint } from "../src/reader.mjs";

const U = 1_000_000n;
const pay = (hash, payer, block, leafIndex) => ({ hash, payer, block, leafIndex: BigInt(leafIndex) });
const attest = (fromIndex, toIndex, threshold, count) => ({ signals: { fromIndex: BigInt(fromIndex), toIndex: BigInt(toIndex), threshold, count: BigInt(count) } });

test("A4 a deposit and an attest over the same payments pin their total exactly", () => {
  const pays = [pay("p1", "acme", 10, 0), pay("p2", "acme", 11, 1), pay("p3", "acme", 12, 2)];
  const m = amountModel(pays, [{ payer: "acme", amount: 3n * U, block: 5 }], [attest(0, 2, 3n * U, 3)]);
  assert.deepEqual(m.total(["p1", "p2", "p3"]), { lo: 3n * U, hi: 3n * U });
  assert.deepEqual(m.bounds.get("p1"), { lo: 1n, hi: 3n * U - 2n });
});

test("A4 an earlier proof that used up a deposit caps the next run's payments by the next deposit", () => {
  const pays = [pay("a", "acme", 10, 0), pay("b", "acme", 11, 1), pay("c", "acme", 30, 4), pay("d", "acme", 31, 5)];
  const deposits = [{ payer: "acme", amount: 3n * U, block: 5 }, { payer: "acme", amount: U, block: 25 }];
  const withFirst = amountModel(pays, deposits, [attest(0, 3, 3n * U, 2), attest(4, 5, U, 2)]);
  assert.deepEqual(withFirst.total(["c", "d"]), { lo: U, hi: U });
  const withoutFirst = amountModel(pays, deposits, [attest(4, 5, U, 2)]);
  assert.deepEqual(withoutFirst.total(["c", "d"]), { lo: U, hi: 4n * U - 2n });
});

test("A1 bounds are unbounded above for a payer with no deposit seen", () => {
  const m = amountModel([pay("x", "nobody", 10, 0)], [], []);
  assert.deepEqual(m.bounds.get("x"), { lo: 1n, hi: null });
});

test("A1 a withdrawal is matched first in first out, and refused when it does not fit the bounds", () => {
  const bounds = new Map([["p1", { lo: 1n, hi: 2n * U }], ["p2", { lo: 1n, hi: U }]]);
  const out = matchWithdrawals([{ hash: "u1", block: 50, amount: 2n * U }, { hash: "u2", block: 51, amount: 2n * U }], [{ pay: "p1", sweepBlock: 20 }, { pay: "p2", sweepBlock: 21 }], bounds);
  assert.equal(out[0].pay, "p1");
  assert.equal(out[1].pay, null);
});

test("R reader: an expiry at 23:59:59 local time names the maker's UTC offset; 23:59:59 UTC (F8) and an exact time do not", () => {
  assert.match(expiryHint(1798153199n), /UTC\+1/); // 2026-12-24 22:59:59 UTC, the bot link
  assert.match(expiryHint(1797936718n), /not an end of day/); // run 1's script-made link
  assert.match(expiryHint(1798156799n), /default since D32 F8/); // 2026-12-24 23:59:59 UTC: no time zone
});

test("memo: tickets share only the constant P-256 header, never a per-recipient part", async () => {
  const { generateReceiveKey, sealToReceiveTag } = await import("@gloamtrade/sdk");
  const k = await generateReceiveKey();
  const memos = [];
  for (const text of ["gloam1.short", `gloam1.${"x".repeat(300)}`]) memos.push({ hash: text, memo: `0x${Buffer.from(await sealToReceiveTag(text, k.tag)).toString("hex")}`, memoLength: 0 });
  const s = memoShape(memos.map((m) => ({ ...m, memoLength: (m.memo.length - 2) / 2 })));
  assert.equal(s.commonPrefixBytes, s.constantHeaderBytes);
  assert.equal(s.distinctEphemeralKeys, 2);
  assert.equal(s.lengths.length, 1, "both plaintexts fall in the same 512-byte padding step");
});
