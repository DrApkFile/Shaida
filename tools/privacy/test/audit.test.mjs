// The observer and reader tools against dumps with a known ground truth, offline (no RPC):
//   fork fixture  tools/privacy/fixtures/fork-{dump,truth}.json, made by packages/shaida-pay/scripts/privacy-fixture.ts
//                 on `make fork`: 2 payers, 2 recipients, 8 interleaved payments, out-of-order sweeps, a 2-proof
//                 bundle attested on chain, an unattested link, one withdrawal that is forwarded.
//   fixes         tools/privacy/fixtures/fork-{dump,truth}-fixes.json: the same plan with D32's applied fixes
//                 (privacy-fixture.ts --fixes): no attest, split sweeps, UTC expiry, suggested threshold.
//   live 44005    evidence/privacy-audit/{dump,truth}-44005.json: the deployment as read on 2026-11-24 (runs 1, 2,
//                 the bot), so the numbers in evidence/privacy-audit.md stay reproducible.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { actionsOf } from "../src/decode.mjs";
import { analyse } from "../src/observer.mjs";
import { analyseLinks, linkFromAttest, linkFromUrl, scoreLink } from "../src/reader.mjs";

const REPO = new URL("../../../", import.meta.url);
const load = (p) => JSON.parse(readFileSync(new URL(p, REPO), "utf8"));
const fork = { dump: load("tools/privacy/fixtures/fork-dump.json"), truth: load("tools/privacy/fixtures/fork-truth.json") };
const live = { dump: load("evidence/privacy-audit/dump-44005.json"), truth: load("evidence/privacy-audit/truth-44005.json") };
const fixes = { dump: load("tools/privacy/fixtures/fork-dump-fixes.json"), truth: load("tools/privacy/fixtures/fork-truth-fixes.json") };

async function readerOf({ dump, truth }) {
  const actions = await actionsOf(dump);
  const inputs = truth.links.map((l) => ({
    name: l.name,
    link: l.from.url ? linkFromUrl(l.from.url) : l.from.attest ? linkFromAttest(actions, l.from.attest) : linkFromUrl(l.from.key.split(".").reduce((o, k) => o[k], load(l.from.file))),
  }));
  const names = [...new Set(truth.links.map((l) => l.reader))];
  return (await analyseLinks(dump, inputs, { readerNames: names })).map((r) => ({ ...r, score: scoreLink(r, truth.links.find((l) => l.name === r.name), truth) }));
}

const forkObs = await analyse(fork.dump, fork.truth);
const liveObs = await analyse(live.dump, live.truth);
const forkRead = await readerOf(fork);
const liveRead = await readerOf(live);
const fixesObs = await analyse(fixes.dump, fixes.truth);
const fixesRead = await readerOf(fixes);

test("O-classes every public field the fixture's transactions carry has a class (plain, opaque, metadata)", () => {
  assert.ok(forkObs.counts.vouchedPay === 8 && forkObs.counts.sweep === 8 && forkObs.counts.attest === 2 && forkObs.counts.unshield === 1);
});

test("O-A5 the observer names the payer of every payment: calldata, the EIP-712 signer and the registry agree", () => {
  for (const o of [forkObs, liveObs]) {
    assert.equal(o.score.A5.verdict, "succeeds");
    assert.ok(o.score.A5.allThreeAgree);
  }
});

test("O-A3 first-in-first-out timing pairs every live sweep, and fails on the fixture's out-of-order sweeps", () => {
  assert.equal(liveObs.score.A3.verdict, "succeeds");
  assert.equal(forkObs.score.A3.verdict, "partly");
  assert.ok(forkObs.score.A3.right < forkObs.score.A3.total);
});

test("O-A1 amount bounds always contain the true amount (the deposit-budget assumption holds in both datasets)", () => {
  assert.ok(forkObs.score.A1.boundsContainTruth, `unsound: ${forkObs.score.A1.unsound}`);
  assert.ok(liveObs.score.A1.boundsContainTruth, `unsound: ${liveObs.score.A1.unsound}`);
  assert.equal(liveObs.score.A1.wrong, 0);
  assert.equal(liveObs.score.A1.right, 3); // run 1's three payments, from the public withdrawals
  // Fixture: Chidi withdraws P2's note, but Ada's P1 was the oldest swept payment, so the FIFO match names the wrong one.
  assert.equal(forkObs.score.A1.right, 0);
  assert.equal(forkObs.score.A1.wrong, 1);
});

test("O-A4 live: deposits and the three attests pin Ada's total from Acme to exactly 4 tUSD8", () => {
  assert.equal(liveObs.score.A4.verdict, "succeeds");
  assert.equal(liveObs.a4[0].lo, 4_000_000n);
  assert.equal(liveObs.a4[0].hi, 4_000_000n);
});

test("O-A4 fixture: bounds contain the truth; other people's vouches inside the range keep the total from being pinned", () => {
  assert.ok(forkObs.score.A4.sound);
  const ada = forkObs.a4.find((g) => g.pays.length > 6);
  assert.ok(ada && !ada.onlyHolders);
});

test("O-A6 every deposit and withdrawal amount is read exactly, and the withdrawal is followed one hop", () => {
  assert.equal(forkObs.score.A6.verdict, "succeeds");
  assert.equal(liveObs.score.A6.verdict, "succeeds");
  assert.deepEqual(liveObs.a6.sameEntity, ["0x5f8066e6e18f6381a0ff593bb6b1a036c5a69698"]); // deployer: funded the payer, received the withdrawal
  assert.equal(forkObs.a6.forwarded.length, 1);
});

test("O-memo sealed memos share only the constant P-256 header and one padded length", () => {
  for (const o of [forkObs, liveObs]) {
    assert.equal(o.memo.commonPrefixBytes, o.memo.constantHeaderBytes);
    assert.equal(o.memo.distinctEphemeralKeys, o.memo.count);
    assert.equal(o.memo.lengths.length, 1);
  }
});

test("R-direct the reader gets threshold, count, range, root and expiry; the context matches the reader's name", () => {
  for (const r of [...forkRead, ...liveRead].filter((x) => x.readerIdHash !== null)) {
    assert.equal(r.contextMatches, true);
    assert.equal(r.readerNameMatches.length, 1);
    assert.ok(r.proofs.every((p) => p.rootIsKnown));
  }
});

test("R-chain live: each link's total is pinned exactly by the link, the deposits and the other link's attest", () => {
  for (const r of liveRead) assert.ok(r.score.total.exact, r.name);
  const run2 = liveRead.find((r) => r.name === "run2");
  assert.equal(run2.proofs[0].totalWithoutChainAttests.lo, 1_000_000n);
  assert.ok(run2.proofs[0].totalWithoutChainAttests.hi > 1_000_000n, "without run 1's attest, run 2's total is not pinned");
});

test("R-chain the payer ids in a link's range are the payers who paid the holder when the range holds only the holder's payments", () => {
  for (const r of [...forkRead, ...liveRead]) {
    if (r.proofs.every((p) => p.onlyHoldersInRange)) assert.ok(r.score.payersRight, r.name);
    assert.ok(r.score.boundsContainTruth, r.name);
    assert.ok(r.score.total.contains, r.name);
  }
});

test("R-D13 a capped share in the fixture's bundle shows its proof's sum only to a 1 tUSD8 window, which holds the truth", () => {
  const ada = forkRead.find((r) => r.name === "ada");
  assert.equal(ada.proofs.length, 2);
  const capped = ada.proofs.filter((p) => p.shareWindow);
  assert.ok(capped.length >= 1);
  const T = new Map(fork.truth.pays.map((p) => [p.hash, BigInt(p.amount)]));
  const held = new Set(fork.truth.links.find((l) => l.name === "ada").pays);
  for (const p of capped) {
    const sum = p.vouchLeaves.filter((v) => held.has(v.pay)).reduce((s, v) => s + T.get(v.pay), 0n);
    assert.equal(p.shareWindow.hiExclusive - p.shareWindow.lo, 1_000_000n);
    assert.ok(sum >= p.shareWindow.lo && sum < p.shareWindow.hiExclusive, `sum ${sum} outside [${p.shareWindow.lo}, ${p.shareWindow.hiExclusive})`);
  }
});

test("F3 with recording opt-in and nobody recording, the observer has no attested range to total (before: [7, 16] over 8 payments)", () => {
  assert.equal(forkObs.counts.attest, 2);
  assert.equal(forkObs.a4.length, 1);
  assert.equal(fixesObs.counts.attest ?? 0, 0);
  assert.equal(fixesObs.a4.length, 0);
});

test("F4 a split sweep's withdrawn note is a part of the payment, not its amount (before: 1 of 1 withdrawals equal to their payment)", () => {
  assert.equal(forkObs.score.A1.withdrawalsEqualToTheirPayment, 1);
  assert.equal(liveObs.score.A1.withdrawalsEqualToTheirPayment, 3);
  assert.equal(fixesObs.score.A1.withdrawals, 1);
  assert.equal(fixesObs.score.A1.withdrawalsEqualToTheirPayment, 0);
  assert.ok(fixesObs.score.A1.boundsContainTruth);
});

test("F8 links end at 23:59:59 UTC, which names no time zone (the live bot link named UTC+1)", () => {
  assert.match(liveRead.find((r) => r.name === "bot").expiryHint, /UTC\+1/);
  for (const r of fixesRead) assert.match(r.expiryHint, /default since D32 F8/, r.name);
});

test("F9 the suggested threshold is below the total: Ada's shown floor drops from 7 to 5 (truth 7.45); bounds and D13 windows still hold the truth", () => {
  const before = forkRead.find((r) => r.name === "ada"), after = fixesRead.find((r) => r.name === "ada");
  assert.equal(before.holderTotal.lo, 7_000_000n);
  assert.equal(after.holderTotal.lo, 5_000_000n);
  for (const r of fixesRead) { assert.ok(r.score.total.contains, r.name); assert.ok(r.score.boundsContainTruth, r.name); }
  const T = new Map(fixes.truth.pays.map((p) => [p.hash, BigInt(p.amount)]));
  const held = new Set(fixes.truth.links.find((l) => l.name === "ada").pays);
  for (const p of after.proofs.filter((x) => x.shareWindow)) {
    const sum = p.vouchLeaves.filter((v) => held.has(v.pay)).reduce((a, v) => a + T.get(v.pay), 0n);
    assert.ok(sum >= p.shareWindow.lo && sum < p.shareWindow.hiExclusive);
  }
});

test("F-unchanged the fixes do not touch who paid (A5), deposits and withdrawals being public (A6), or sweep timing (A3)", () => {
  assert.equal(fixesObs.score.A5.verdict, "succeeds");
  assert.equal(fixesObs.score.A6.verdict, "succeeds");
  assert.equal(fixesObs.score.A3.right, forkObs.score.A3.right);
});
