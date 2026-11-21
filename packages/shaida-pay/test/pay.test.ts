import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeNotePackage, generateReceiveKey, makeBoundNotePoseidon, sealToReceiveTag } from "@gloamtrade/sdk";
import { stringToHex, type Address, type Hex } from "viem";
import type { CheckedTrees, Memo } from "@shaida/index";
import { TUSD8_ADDRESS } from "@shaida/proofs";
import {
  afterSubmit, emptyVault, incomeKeyFor, storedReceiveKey, openInbox, openVault, preparePay, reconcile, sealVault, seen, startSweep,
  type FlowContext, type Note, type RelayRecord,
} from "../src/index";

const POOL = "0x00000000000000000000000000000000000000a1" as Address;
const ctx: FlowContext = {
  chainId: 440050,
  contracts: { pool: POOL, ledger: "0x00000000000000000000000000000000000000b2", depositor: "0x00000000000000000000000000000000000000d4" },
  provers: { shield: async () => assert.fail("must not prove"), transfer: async () => assert.fail("must not prove") },
  nowSec: () => 1_800_000_000n,
};
const asset = TUSD8_ADDRESS.toLowerCase() as Address;

async function note(amount: bigint): Promise<Note> {
  const n = await makeBoundNotePoseidon(amount, asset);
  return { secret: n.secret.toLowerCase() as Hex, commitment: n.commitment.toLowerCase() as Hex, nullifier: n.nullifier.toLowerCase() as Hex, amountWei: amount.toString(), asset };
}

async function memoFor(n: Note, tag: string, over: Partial<{ commitment: Hex; pool: Address }> = {}): Promise<Memo> {
  const pack = encodeNotePackage({ pool: over.pool ?? POOL, asset, amountWei: n.amountWei, secret: n.secret, commitment: n.commitment, chainId: 440050, note: "Invoice 7 (demo)" });
  return { commitment: over.commitment ?? n.commitment, memo: stringToHex(await sealToReceiveTag(pack, tag)), block: "10", tx: `0x${"ab".repeat(32)}` };
}

describe("config", () => {
  it("P01 refuses the THROWAWAY income key on Aevum 44005 and allows it on the fork", () => {
    const a = incomeKeyFor("throwaway", 44005);
    assert.equal(a.ok ? "ok" : a.error.code, "NotConfigured");
    assert.deepEqual(incomeKeyFor("throwaway", 440050), { ok: true, value: "throwaway" });
    assert.deepEqual(incomeKeyFor(undefined, 44005), { ok: true, value: "final" });
    assert.equal(incomeKeyFor("dev", 440050).ok, false);
  });
});

describe("vault", () => {
  it("P02 round-trips, refuses a wrong passphrase, and never stores a secret in clear", async () => {
    const data = { ...emptyVault(440050), receiveKey: storedReceiveKey(await generateReceiveKey()), payerNotes: [{ note: await note(5_000_000n), spent: false, label: "deposit" }] };
    const blob = await sealVault(data, "correct horse battery");
    const text = JSON.stringify(blob);
    assert.equal(text.includes(data.payerNotes[0]!.note.secret.slice(2)), false);
    assert.equal(text.includes(String(data.receiveKey.privateJwk.d)), false);
    const back = await openVault(JSON.parse(text), "correct horse battery");
    assert.deepEqual(back.ok ? back.data : null, JSON.parse(JSON.stringify(data)));
    assert.deepEqual(await openVault(blob, "wrong passphrase!"), { ok: false, reason: "wrong-passphrase" });
    assert.deepEqual(await openVault({ ...blob, ct: blob.ct.slice(4) }, "correct horse battery"), { ok: false, reason: "wrong-passphrase" });
    assert.deepEqual(await openVault({ hello: 1 }, "x"), { ok: false, reason: "not-a-vault" });
  });
});

describe("inbox", () => {
  it("P03 opens only memos sealed to this key that open the commitment they name", async () => {
    const ada = await generateReceiveKey();
    const other = await generateReceiveKey();
    const [p1, p2, p3, p4] = await Promise.all([note(3_000_000n), note(4_000_000n), note(2_000_000n), note(1_000_000n)]);
    const memos = [
      await memoFor(p1, ada.tag),
      await memoFor(p2, other.tag), // someone else's payment
      await memoFor(p3, ada.tag, { commitment: p1.commitment }), // names another payment's commitment
      await memoFor(p4, ada.tag, { pool: "0x00000000000000000000000000000000000000ff" }), // another pool
      { commitment: p1.commitment, memo: stringToHex("hello"), block: "11", tx: `0x${"cd".repeat(32)}` },
      await memoFor(p1, ada.tag), // repeated
    ];
    const got = await openInbox(memos, ada, ctx);
    assert.equal(got.length, 1);
    assert.equal(got[0]?.note.commitment, p1.commitment);
    assert.equal(got[0]?.note.nullifier, p1.nullifier);
    assert.equal(got[0]?.privateNote, "Invoice 7 (demo)");
  });

  it("P04 refuses a pay to a non-address or above the note, before any proving", async () => {
    const source = await note(5_000_000n);
    const trees = {} as CheckedTrees;
    const a = await preparePay(ctx, trees, { payer: POOL, source, amount: 1n, recipientTag: "0x1234" });
    assert.equal(a.ok ? "ok" : a.error.code, "InputRejected");
    const b = await preparePay(ctx, trees, { payer: POOL, source, amount: 6_000_000n, recipientTag: (await generateReceiveKey()).tag });
    assert.equal(b.ok ? "ok" : b.error.code, "InputRejected");
  });
});

describe("sweep states (PRD §6: seen → sweeping → swept | unknown)", () => {
  const rec = (state: RelayRecord["state"], over: Partial<RelayRecord> = {}): RelayRecord => ({
    requestId: "r1", chainId: 440050, fn: "sweep", key: "k", requestHash: `0x${"22".repeat(32)}`, payer: null, state, nonce: 0, hash: `0x${"11".repeat(32)}`, gas: "1", gasPrice: "1",
    gasUsed: null, block: null, reverted: null, error: null, budgetDay: "2026-11-21", history: [], ...over,
  });

  it("P05 unknown has no resend edge, and only the chain (by nullifier) settles it", async () => {
    const fresh = await note(3_000_000n);
    const sweeping = startSweep(seen("0xc1"), fresh);
    const unknown = afterSubmit(sweeping, { ok: false, error: { code: "TxOutcomeUnknown", message: "no answer" } });
    assert.equal(unknown.state, "unknown");
    assert.throws(() => startSweep(unknown, fresh), /cannot sweep from unknown/);
    assert.equal(reconcile(unknown, { kind: "unspent" }, null).state, "unknown", "no evidence: stays unknown");
    assert.equal(reconcile(unknown, { kind: "swept", sweepCommitment: fresh.commitment as Hex, sweepLeafIndex: 1 }, null).state, "swept");
  });

  it("P05 a refusal or a dropped sweep returns to seen; a sweep by someone else is AlreadySpent", async () => {
    const fresh = await note(3_000_000n);
    const s = startSweep(seen("0xc1"), fresh);
    assert.equal(afterSubmit(s, { ok: false, error: { code: "UnknownRoot", message: "resync" } }).state, "seen");
    const pending = afterSubmit(s, { ok: true, value: rec("pending") });
    assert.equal(pending.state, "sweeping");
    assert.equal(reconcile(pending, { kind: "unspent" }, rec("dropped")).state, "seen");
    const lost = reconcile(pending, { kind: "spent-elsewhere" }, rec("pending"));
    assert.equal(lost.state, "seen");
    assert.equal(lost.lastError?.code, "AlreadySpent");
    const other = await note(1n);
    assert.equal(reconcile(pending, { kind: "swept", sweepCommitment: other.commitment as Hex, sweepLeafIndex: 0 }, rec("mined")).lastError?.code, "AlreadySpent", "an S leaf with someone else's note is not our sweep");
    assert.equal(reconcile(pending, { kind: "unspent" }, rec("mined")).state, "sweeping", "mined but not indexed yet: not swept yet");
  });
});


describe("notes", () => {
  it("P06 keeps a zero-value change note (a pay of a whole note) and refuses a malformed amount", async () => {
    const { toNote } = await import("../src/notes");
    const n = await note(1n);
    assert.equal(toNote({ ...n, amountWei: "0" }).amountWei, "0");
    assert.throws(() => toNote({ ...n, amountWei: "007" }));
    assert.throws(() => toNote({ ...n, amountWei: "-1" }));
  });
});
