// "Record decision" (D30): attest only for an APPROVE, off by default, an attest-only call, the daily caps, once per
// proof, persisted before the send, and an unclear send never resent.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shaidaError } from "@shaida/proofs";
import { ATTEST_GAS, ATTEST_SELECTOR, RECORDER_DEFAULTS, recordDecision, underwrite } from "../src/index";
import { CREDIT, depsOf, ledgerSpanning, linkOf, RENT, recorderFake, StandIn, TUSD8 } from "./helpers";

/** An approved rent link (salt varies the proof, so each call is a new proof). */
async function approved(salt = 1n, proofs = 1) {
  const { ledger, toIndex } = ledgerSpanning(2, 1);
  const prover = new StandIn();
  const specs = proofs === 1
    ? [{ threshold: 3n * TUSD8, count: 3n, fromIndex: 0n, toIndex }]
    : [{ threshold: 2n * TUSD8, count: 2n, fromIndex: 0n, toIndex: 0n }, { threshold: 1n * TUSD8, count: 1n, fromIndex: 1n, toIndex }];
  const link = linkOf({ salt, proofs: specs }, prover);
  const decision = await underwrite(link, RENT, depsOf(prover, ledger));
  assert.equal(decision.kind, "APPROVE");
  return { link, decision, prover, ledger };
}

describe("record: who and what (D30)", () => {
  it("U21 recording is off by default: NotConfigured, nothing signed", async () => {
    assert.equal(RECORDER_DEFAULTS.enabled, false);
    const f = recorderFake({ enabled: false });
    const { link, decision } = await approved();
    const r = await recordDecision(decision, link, f.deps);
    assert.equal(r.ok ? "ok" : r.error.code, "NotConfigured");
    assert.equal(f.signed.length, 0);
  });

  it("U21b only an APPROVE is recorded: a DECLINE is refused with InputRejected, nothing signed", async () => {
    const f = recorderFake();
    const { link, prover, ledger } = await approved();
    const declined = await underwrite(link, CREDIT, depsOf(prover, ledger));
    assert.equal(declined.kind, "DECLINE");
    const r = await recordDecision(declined, link, f.deps);
    assert.equal(r.ok ? "ok" : r.error.code, "InputRejected");
    assert.equal(f.signed.length, 0);
  });

  it("U21c the bot's key signs only IncomeVerifier.attest (legacy, explicit 420k gas), one tx per proof of a bundle", async () => {
    const f = recorderFake();
    const { link, decision } = await approved(5n, 2);
    const r = await recordDecision(decision, link, f.deps);
    assert.ok(r.ok, r.ok ? "" : r.error.message);
    assert.equal(f.signed.length, 2);
    for (const tx of f.signed) {
      assert.equal(tx.to, f.deps.chain!.incomeVerifier);
      assert.equal(tx.data.slice(0, 10), ATTEST_SELECTOR);
      assert.equal(tx.gas, ATTEST_GAS);
    }
    assert.deepEqual(r.records.map((x) => x.state), ["mined", "mined"]);
  });

  it("U21d a proof IncomeVerifier.check refuses is not claimed or signed", async () => {
    const f = recorderFake({ check: async () => shaidaError("UnknownRoot", "not known") });
    const { link, decision } = await approved();
    const r = await recordDecision(decision, link, f.deps);
    assert.equal(r.ok ? "ok" : r.error.code, "UnknownRoot");
    assert.equal(f.signed.length, 0);
    assert.equal((await f.store.usage("2027-01-15")).count, 0);
  });

  it("U21e an unfunded bot key refuses with RecorderUnavailable before claiming", async () => {
    const f = recorderFake({ balance: ATTEST_GAS * 1_000_000_000n - 1n });
    const { link, decision } = await approved();
    const r = await recordDecision(decision, link, f.deps);
    assert.equal(r.ok ? "ok" : r.error.code, "RecorderUnavailable");
    assert.equal((await f.store.usage("2027-01-15")).count, 0);
  });
});

describe("record: idempotent and capped (D30)", () => {
  it("U14 the same proof again gives back its record, with no second attest; also under another policy version", async () => {
    const f = recorderFake();
    const { link, decision } = await approved();
    const first = await recordDecision(decision, link, f.deps);
    assert.ok(first.ok && !first.repeated);
    const again = await recordDecision(decision, link, f.deps);
    assert.ok(again.ok && again.repeated);
    assert.deepEqual(again.records.map((x) => x.hash), first.records.map((x) => x.hash));
    const bumped = { ...decision, decisionId: "f".repeat(64), policy: { ...decision.policy, version: decision.policy.version + 1 } };
    const other = await recordDecision(bumped, link, f.deps);
    assert.ok(other.ok && other.repeated);
    assert.equal(f.signed.length, 1);
    assert.equal(f.sent.length, 1);
    assert.deepEqual(f.storedBeforeSend, [true]);
  });

  it("U15 refuses beyond the daily record cap with AttestCapReached, and allows again the next UTC day", async () => {
    const f = recorderFake({ dailyCount: 2, dailyGas: 10n * ATTEST_GAS });
    for (const salt of [11n, 12n]) {
      const a = await approved(salt);
      assert.ok((await recordDecision(a.decision, a.link, f.deps)).ok);
    }
    const third = await approved(13n);
    const r = await recordDecision(third.decision, third.link, f.deps);
    assert.equal(r.ok ? "ok" : r.error.code, "AttestCapReached");
    assert.equal(f.signed.length, 2);
    f.advanceDays(1);
    assert.ok((await recordDecision(third.decision, third.link, f.deps)).ok);
    assert.equal(f.signed.length, 3);
  });

  it("U15b refuses beyond the daily gas cap, and a bundle that would cross the count cap is refused whole", async () => {
    const g = recorderFake({ dailyCount: 10, dailyGas: ATTEST_GAS + 1n });
    const a = await approved(21n);
    assert.ok((await recordDecision(a.decision, a.link, g.deps)).ok);
    const b = await approved(22n);
    const r = await recordDecision(b.decision, b.link, g.deps);
    assert.equal(r.ok ? "ok" : r.error.code, "AttestCapReached");
    const c = recorderFake({ dailyCount: 1 });
    const bundle = await approved(23n, 2);
    const rb = await recordDecision(bundle.decision, bundle.link, c.deps);
    assert.equal(rb.ok ? "ok" : rb.error.code, "AttestCapReached");
    assert.equal(c.signed.length, 0);
  });
});

describe("record: never resent (D30)", () => {
  it("U22 the signed record (hash, nonce) is stored before the send; a send with no answer is TxOutcomeUnknown and never sent again", async () => {
    const f = recorderFake({ send: "no-answer" });
    const { link, decision } = await approved();
    const r = await recordDecision(decision, link, f.deps);
    assert.equal(r.ok ? "ok" : r.error.code, "TxOutcomeUnknown");
    assert.equal(r.records[0]!.state, "unknown");
    assert.match(r.records[0]!.hash ?? "", /^0x[0-9a-f]{64}$/);
    assert.deepEqual(f.storedBeforeSend, [true]);
    const again = await recordDecision(decision, link, f.deps);
    assert.ok(again.ok && again.repeated);
    assert.equal(f.signed.length, 1);
  });

  it("U22b a send the node refuses is dropped and not retried for that proof", async () => {
    const f = recorderFake({ send: "refused" });
    const { link, decision } = await approved();
    const r = await recordDecision(decision, link, f.deps);
    assert.equal(r.ok ? "ok" : r.error.code, "TxRejected");
    assert.equal(r.records[0]!.state, "dropped");
    await recordDecision(decision, link, f.deps);
    assert.equal(f.signed.length, 1);
  });
});
