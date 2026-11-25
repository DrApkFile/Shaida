// The holder's revoke state (D35): revocable → sending → pending → revoked | unknown, never a second send; revoked
// only when Revocations says so; old links have nothing to revoke with; the vault still opens old shared links.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { revokeSaltOf } from "@shaida/proofs";
import { afterRevokePost, reconcileRevocation, revokeRequest, revokeViewOf, saltOfLink, sendingRevocation, sharedLinkSchema, type RelayRecord, type Revocation } from "../src/index";

const record = (patch: Partial<RelayRecord>): RelayRecord => ({
  requestId: "r1", chainId: 44005, fn: "revoke", key: "44005:revoke:1", requestHash: `0x${"a".repeat(64)}`, payer: null, state: "pending", nonce: 0, hash: `0x${"b".repeat(64)}`,
  gas: "200000", gasPrice: "1000000000", gasUsed: null, block: null, reverted: null, error: null, budgetDay: "2026-11-25", history: [], ...patch,
});
const link = (patch: { revokeSecret?: string; revocation?: Revocation } = {}) => ({ revokeSecret: "12345", ...patch });

describe("revoking a shared link (D35)", () => {
  it("RV20 an old link (no secret) is not revocable and no request can be built for it", () => {
    assert.equal(revokeViewOf({}).kind, "not-revocable");
    assert.throws(() => revokeRequest({}, 44005), /not-revocable/);
  });

  it("RV21 a request is built only from revocable, and carries the secret whose salt the link uses", () => {
    assert.deepEqual(revokeRequest(link(), 44005), { chainId: 44005, secret: "12345" });
    assert.equal(saltOfLink({ revokeSecret: "12345" }), revokeSaltOf(12345n));
    for (const state of ["sending", "pending", "unknown", "revoked"] as const) {
      const r: Revocation = { ...sendingRevocation(), state };
      assert.throws(() => revokeRequest(link({ revocation: r }), 44005), new RegExp(state));
    }
  });

  it("RV22 a lost answer is unknown (no resend edge); a refusal before sending is revocable again; AlreadyRevoked waits for the chain", () => {
    assert.equal(afterRevokePost({ ok: false, error: { code: "TxOutcomeUnknown", message: "x" } })?.state, "unknown");
    assert.equal(afterRevokePost({ ok: false, error: { code: "RelayerBudgetExceeded", message: "x" } }), undefined);
    assert.equal(afterRevokePost({ ok: false, error: { code: "AlreadyRevoked", message: "x" } })?.state, "pending");
    assert.equal(afterRevokePost({ ok: true, value: record({ state: "unknown" }) })?.state, "unknown");
    assert.equal(afterRevokePost({ ok: true, value: record({ state: "dropped" }) }), undefined);
    assert.equal(afterRevokePost({ ok: true, value: record({}) })?.hash, `0x${"b".repeat(64)}`);
  });

  it("RV23 revoked only when Revocations.revokedAt says so: a mined receipt alone is not enough, unreadable changes nothing", () => {
    const pending = afterRevokePost({ ok: true, value: record({}) })!;
    assert.equal(reconcileRevocation(pending, 0n, record({ state: "mined", reverted: false }))?.state, "pending");
    assert.equal(reconcileRevocation(pending, "unreadable", null)?.state, "pending");
    const done = reconcileRevocation(pending, 4_100_000n, null)!;
    assert.equal(done.state, "revoked");
    assert.equal(revokeViewOf(link({ revocation: done })).kind, "revoked");
    // an unknown is resolved by the chain too, never by sending
    const unknown: Revocation = { ...sendingRevocation(), state: "unknown" };
    assert.equal(reconcileRevocation(unknown, 0n, null)?.state, "unknown");
    assert.equal(reconcileRevocation(unknown, 7n, null)?.state, "revoked");
    // a page that died mid-send is unknown, not revocable
    assert.equal(reconcileRevocation(sendingRevocation(), 0n, null)?.state, "unknown");
    // a revert or drop that the record shows: nothing landed, revocable again
    assert.equal(reconcileRevocation(pending, 0n, record({ state: "mined", reverted: true })), undefined);
  });

  it("RV24 a vault's shared links made before D35 still parse; the reader's code is not a field the vault can hold", () => {
    const old = { fragment: "x", reader: "Landlord Bola", expiry: 1_800_000_000, threshold: "1", count: 3, fromDate: 1_790_000_000, toDate: 1_790_086_400, proofs: 1, createdAt: 1_789_000_000 };
    assert.equal(sharedLinkSchema.safeParse(old).success, true);
    assert.equal(sharedLinkSchema.safeParse({ ...old, revokeSecret: "9", readerMode: "code" }).success, true);
    assert.equal(sharedLinkSchema.safeParse({ ...old, readerCode: "ABCD-EFGH-JKMN-PQRS" }).success, false);
  });
});
