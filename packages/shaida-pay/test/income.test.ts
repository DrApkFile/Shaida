// D27, recipient side of an income proof: what counts, the vault's shared links, the final-key pins.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { makeBoundNotePoseidon } from "@gloamtrade/sdk";
import type { Address, Hex } from "viem";
import type { CheckedTrees, Snapshot } from "@shaida/index";
import { LedgerTree, TUSD8_ADDRESS, buildIncomeBundle, sweepLeaf, vouchLeaf } from "@shaida/proofs";
import { endOfDayUtc, suggestedThreshold } from "../src/index";
import {
  INCOME_ARTIFACTS, emptyVault, incomeCandidates, incomeRequestOf, loadIncomeArtifacts, openVault, sealVault, seen, startSweep, timedLeaves,
  type IncomingPayment, type InboxEntry, type Note,
} from "../src/index";

const asset = TUSD8_ADDRESS.toLowerCase() as Address;
const hex = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;
async function note(amount: bigint): Promise<Note> {
  const n = await makeBoundNotePoseidon(amount, asset);
  return { secret: n.secret.toLowerCase() as Hex, commitment: n.commitment.toLowerCase() as Hex, nullifier: n.nullifier.toLowerCase() as Hex, amountWei: amount.toString(), asset };
}
const incoming = (n: Note, privateNote: string): IncomingPayment => ({ note: n, privateNote, memoBlock: 10n, memoTx: `0x${"cd".repeat(32)}` });
const swept = (n: Note, fresh: Note): InboxEntry => ({ ...startSweep(seen(n.commitment), fresh), state: "swept" });

function trees(leaves: Snapshot["ledgerLeaves"]): CheckedTrees {
  const snapshot: Snapshot = {
    v: 1, chainId: 440050, contracts: { pool: `0x${"a1".repeat(20)}`, ledger: `0x${"b2".repeat(20)}`, memo: `0x${"c3".repeat(20)}` },
    startBlock: "1", syncedTo: "99", poolLeaves: [], ledgerLeaves: leaves, memos: [], problems: [], checkedAt: "99",
  };
  return { snapshot, block: 99n, pool: new LedgerTree([]), ledger: new LedgerTree(leaves.map((l) => BigInt(l.leaf))) };
}

describe("income proof inputs (D27)", () => {
  it("P10 counts only my vouched payments swept into my own note; lists unvouched, unswept and clawed-back ones", async () => {
    const [p1, p2, p3, p4, f1, f2, other] = await Promise.all([note(3_000_000n), note(4_000_000n), note(2_000_000n), note(5_000_000n), note(3_000_000n), note(4_000_000n), note(4_000_000n)]);
    const v = (n: Note, index: number, block: string) => ({ kind: "vouch" as const, index, leaf: hex(vouchLeaf(1n, BigInt(n.commitment))), payerId: 1, commitment: n.commitment, block });
    const s = (n: Note, fresh: Note, index: number, block: string) => ({ kind: "sweep" as const, index, leaf: hex(sweepLeaf(BigInt(n.nullifier), BigInt(fresh.commitment))), nullifier: n.nullifier, sweepCommitment: fresh.commitment, block });
    // p1 vouched + swept into f1 (mine); p2 vouched, swept into someone else's note; p3 never vouched; p4 vouched, not swept
    const t = trees([v(p1, 0, "20"), v(p2, 1, "21"), v(p4, 2, "22"), s(p1, f1, 3, "30"), s(p2, other, 4, "31")]);
    const c = incomeCandidates(t, [incoming(p1, "Invoice 1"), incoming(p2, "Invoice 2"), incoming(p3, "self-pay"), incoming(p4, "Invoice 4")], [swept(p1, f1), swept(p2, f2), seen(p4.commitment)]);
    assert.deepEqual(c.countable.map((x) => [x.commitment, x.vouchIndex, x.sweepIndex, x.vouchBlock]), [[p1.commitment, 0, 3, 20n]]);
    assert.deepEqual(c.notCountable.map((x) => [x.commitment, x.reason]), [[p2.commitment, "swept-elsewhere"], [p3.commitment, "not-vouched"], [p4.commitment, "not-swept"]]);
    // the builder accepts the record against this exact tree
    const built = buildIncomeBundle(incomeRequestOf(t, c.countable, { threshold: 3_000_000n, fromIndex: 0n, toIndex: 4n, context: 9n, shareStep: 1_000_000n }));
    assert.equal(built.ok && built.value.count, 1n);
    const times = await timedLeaves(t, async (b) => 1_800_000_000n + b);
    assert.deepEqual(times.map((x) => [x.index, x.time, x.vouch]), [[0, 1_800_000_020n, true], [1, 1_800_000_021n, true], [2, 1_800_000_022n, true], [3, 1_800_000_030n, false], [4, 1_800_000_031n, false]]);
  });

  it("P11 a vault sealed before D27 (no shared field) still opens, with no shared links", async () => {
    const legacy = { ...emptyVault(440050) } as Record<string, unknown>;
    delete legacy.shared;
    const blob = await sealVault(legacy as Parameters<typeof sealVault>[0], "correct horse battery");
    const back = await openVault(blob, "correct horse battery");
    assert.equal(back.ok && back.data.shared.length, 0);
  });

  it("P12 the income pins are the ceremony's final key, and other bytes under its name are refused", async () => {
    const record = JSON.parse(readFileSync(new URL("../../../ceremony/record.json", import.meta.url), "utf8")) as { final: { zkey: { sha256: string }; vkey: { sha256: string } } };
    assert.equal(INCOME_ARTIFACTS.zkey.sha256, record.final.zkey.sha256);
    assert.equal(INCOME_ARTIFACTS.vkey.sha256, record.final.vkey.sha256);
    const wasm = readFileSync(new URL("../../shaida-proofs/build/income_js/income.wasm", import.meta.url));
    const digest = async (b: ArrayBuffer) => { const h = createHash("sha256").update(new Uint8Array(b)).digest(); return h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength); };
    const served = (url: string) => Promise.resolve(url.endsWith(".wasm") ? wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) : new Uint8Array(1024).buffer);
    const r = await loadIncomeArtifacts("/circuits/income", served, digest);
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.error.code, "NotConfigured"); assert.match(r.error.message, /income_final\.zkey is not the ceremony's final file/); }
  });
});

describe("prove form choices (D32 F8, F9)", () => {
  const U = 1_000_000n;
  it("F8 a link expires at 23:59:59 UTC of the chosen day, whatever the browser's time zone", () => {
    assert.equal(endOfDayUtc("2026-12-24"), 1798156799n); // 2026-12-24T23:59:59Z
    assert.equal(new Date(Number(endOfDayUtc("2026-12-24")) * 1000).toISOString(), "2026-12-24T23:59:59.000Z");
    assert.equal(endOfDayUtc("2026-02-30"), null);
    assert.equal(endOfDayUtc("24/12/2026"), null);
  });

  it("F9 the suggested threshold is rounded down to 1, 5 or 10 tUSD8 and is never the exact total", () => {
    const cases: [bigint, bigint, bigint | null][] = [
      [7_450_000n, U, 5n * U], // the fixture's Ada: was 7, the most
      [3n * U, U, 2n * U], // live run 1: was 3, the exact total
      [4_500_000n, U, 4n * U],
      [15n * U, U, 10n * U],
      [12n * U, U, 10n * U],
      [67n * U, U, 60n * U],
      [U, U, null], // live run 2 and the bot: nothing round below 1
      [7_450_000n, 10n * U, null],
      [23n * U, 10n * U, 20n * U],
    ];
    for (const [total, step, want] of cases) {
      const got = suggestedThreshold(total, step);
      assert.equal(got, want, `total ${total} step ${step}`);
      if (got !== null) { assert.ok(got < total); assert.equal(got % step, 0n); }
    }
  });
});
