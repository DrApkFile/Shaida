// The decision engine (D30): APPROVE per preset, each DECLINE reason on its own, verification refusals, INCONCLUSIVE
// on an unreadable chain, idempotency, and that removing any one rule lets its decline case through (U17).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chainUnreachable, DAY, RULE_CODES, RULES, underwrite, type Decision, type RuleCode } from "../src/index";
import { CREDIT, depsOf, ledgerSpanning, linkOf, NOW, otherReader, RENT, ROOT, StandIn, TUSD8, type LinkSpec } from "./helpers";

const kindOf = (d: Decision) => (d.kind === "DECLINE" ? `DECLINE(${d.reasons.map((r) => r.code).join(",")})` : d.kind === "INCONCLUSIVE" ? `INCONCLUSIVE(${d.error.code})` : "APPROVE");

/** Rent: ≥ 3 tUSD8 in 3 payments over 2 days, built 1 day ago, 30 days left. */
function rentCase(patch: Partial<LinkSpec> = {}) {
  const { ledger, toIndex } = ledgerSpanning(2, 1);
  const prover = new StandIn();
  const link = linkOf({ proofs: [{ threshold: 3n * TUSD8, count: 3n, fromIndex: 0n, toIndex }], ...patch }, prover);
  return { link, deps: depsOf(prover, ledger) };
}

/** Credit: a 2-proof bundle, ≥ 12 tUSD8 in 8 payments over 60 days, built 3 days ago, 30 days left. */
function creditCase(o: { threshold?: bigint; count?: bigint; days?: number; ageDays?: number; expiry?: bigint } = {}) {
  const { ledger, toIndex } = ledgerSpanning(o.days ?? 60, o.ageDays ?? 3);
  const mid = toIndex / 2n - (toIndex / 2n) % 2n;
  const t = o.threshold ?? 12n * TUSD8;
  const c = o.count ?? 8n;
  const prover = new StandIn();
  const link = linkOf({
    ...(o.expiry !== undefined ? { expiry: o.expiry } : {}),
    proofs: [
      { threshold: t / 2n, count: c / 2n, fromIndex: 0n, toIndex: mid },
      { threshold: t - t / 2n, count: c - c / 2n, fromIndex: mid + 1n, toIndex },
    ],
  }, prover);
  return { link, deps: depsOf(prover, ledger) };
}

describe("underwrite: approvals (D30)", () => {
  it("U01 APPROVE under rent-check for a link that meets every rule", async () => {
    const { link, deps } = rentCase();
    const d = await underwrite(link, RENT, deps);
    assert.equal(kindOf(d), "APPROVE");
    if (d.kind !== "APPROVE") return;
    assert.equal(d.facts.threshold, (3n * TUSD8).toString());
    assert.equal(d.facts.count, "3");
    assert.equal(d.facts.periodDays, "2");
    assert.equal(d.policy.id, "rent-check");
  });

  it("U02 APPROVE under revenue-credit for a 2-proof bundle that meets every rule", async () => {
    const { link, deps } = creditCase();
    const d = await underwrite(link, CREDIT, deps);
    assert.equal(kindOf(d), "APPROVE");
    if (d.kind === "APPROVE") assert.equal(d.facts.proofs, 2);
  });

  it("U02b the same rent link is DECLINED by the stricter revenue-credit preset, every failing rule listed in order", async () => {
    const { link, deps } = rentCase();
    assert.equal(kindOf(await underwrite(link, CREDIT, deps)), "DECLINE(BelowMinThreshold,TooFewPayments,PeriodTooShort)");
  });
});

describe("underwrite: each DECLINE reason on its own (revenue-credit, D30)", () => {
  const declinesAlone = async (code: RuleCode, o: Parameters<typeof creditCase>[0]) => {
    const { link, deps } = creditCase(o);
    const d = await underwrite(link, CREDIT, deps);
    assert.equal(kindOf(d), `DECLINE(${code})`);
    if (d.kind === "DECLINE") assert.match(d.reasons[0]!.message, /this policy/);
  };
  it("U03 DECLINE(BelowMinThreshold) alone when only the threshold is below the policy's minimum", () => declinesAlone("BelowMinThreshold", { threshold: 9n * TUSD8 }));
  it("U04 DECLINE(TooFewPayments) alone when only the payment count is too low", () => declinesAlone("TooFewPayments", { count: 5n }));
  it("U05 DECLINE(PeriodTooShort) alone when only the period is too short", () => declinesAlone("PeriodTooShort", { days: 20 }));
  it("U06 DECLINE(PeriodTooLong) alone when only the period is too long", () => declinesAlone("PeriodTooLong", { days: 200 }));
  it("U07 DECLINE(ProofTooOld) alone when only the ledger state is too old", () => declinesAlone("ProofTooOld", { ageDays: 20 }));
  it("U08 DECLINE(ExpiresTooSoon) alone when only the link expires too soon", () => declinesAlone("ExpiresTooSoon", { expiry: NOW + 5n * DAY }));
  it("U05b a period of exactly minPeriodDays and maxPeriodDays is allowed (UTC calendar days, inclusive)", async () => {
    for (const days of [CREDIT.minPeriodDays, CREDIT.maxPeriodDays]) {
      const { link, deps } = creditCase({ days });
      assert.equal(kindOf(await underwrite(link, CREDIT, deps)), "APPROVE", `${days} days`);
    }
  });
});

describe("underwrite: verification refusals are DECLINEs (PRD §5)", () => {
  it("U09 DECLINE(WrongReader) for a link made out to Landlord Bola, sent to the bot", async () => {
    const { link, deps } = rentCase({ reader: otherReader("Landlord Bola") });
    assert.equal(kindOf(await underwrite(link, RENT, deps)), "DECLINE(WrongReader)");
  });
  it("U10 DECLINE(ProofExpired) for a link past its expiry", async () => {
    const { link, deps } = rentCase({ expiry: NOW - 1n });
    assert.equal(kindOf(await underwrite(link, RENT, deps)), "DECLINE(ProofExpired)");
  });
  it("U11 DECLINE(ProofInvalid) for a tampered link: a raised threshold, a cut fragment, junk", async () => {
    const { link, deps } = rentCase();
    const json = JSON.parse(Buffer.from(link, "base64url").toString("utf8")) as { proofs: { publicSignals: string[] }[] };
    json.proofs[0]!.publicSignals[2] = (300n * TUSD8).toString();
    const raised = Buffer.from(JSON.stringify(json)).toString("base64url");
    for (const bad of [raised, link.slice(0, -12), "not-a-link!"]) {
      assert.equal(kindOf(await underwrite(bad, RENT, deps)), "DECLINE(ProofInvalid)");
    }
  });
});

describe("underwrite: INCONCLUSIVE, never an approval", () => {
  it("U12 INCONCLUSIVE(ChainUnreachable) when the RPC is down", async () => {
    const { link, deps } = rentCase();
    const down = { ...deps, isKnownRoot: async () => { throw chainUnreachable("ShaidaLedger.isKnownRoot", new Error("fetch failed")); } };
    assert.equal(kindOf(await underwrite(link, RENT, down)), "INCONCLUSIVE(ChainUnreachable)");
  });
  it("U12b INCONCLUSIVE(UnknownRoot) for a root the chain does not know, and (RangeUnresolvable) when the bot's ledger cannot date it", async () => {
    const { link, deps } = rentCase({ root: ROOT + 1n });
    assert.equal(kindOf(await underwrite(link, RENT, deps)), "INCONCLUSIVE(UnknownRoot)");
    const r = rentCase();
    assert.equal(kindOf(await underwrite(r.link, RENT, { ...r.deps, rootTime: async () => null })), "INCONCLUSIVE(RangeUnresolvable)");
  });
  it("U12c a bug in a dependency is thrown, not turned into a decision", async () => {
    const { link, deps } = rentCase();
    await assert.rejects(underwrite(link, RENT, { ...deps, isKnownRoot: async () => { throw new TypeError("boom"); } }), /boom/);
  });
});

describe("underwrite: idempotent (D30)", () => {
  it("U13 the same link and policy version give the same decision and decisionId; another version gives another id", async () => {
    const { link, deps } = rentCase();
    const a = await underwrite(link, RENT, deps);
    const b = await underwrite(link, RENT, deps);
    assert.deepEqual(b, a);
    const bumped = await underwrite(link, { ...RENT, version: RENT.version + 1 }, deps);
    assert.equal(bumped.kind, a.kind);
    assert.notEqual(bumped.decisionId, a.decisionId);
    const declined = await underwrite(link, CREDIT, deps);
    assert.notEqual(declined.decisionId, a.decisionId);
    assert.equal(declined.proofId, a.proofId);
  });
});

describe("underwrite: every rule is load-bearing (U17)", () => {
  const cases: [RuleCode, Parameters<typeof creditCase>[0]][] = [
    ["BelowMinThreshold", { threshold: 9n * TUSD8 }], ["TooFewPayments", { count: 5n }], ["PeriodTooShort", { days: 20 }],
    ["PeriodTooLong", { days: 200 }], ["ProofTooOld", { ageDays: 20 }], ["ExpiresTooSoon", { expiry: NOW + 5n * DAY }],
  ];
  it("U17 removing any single rule check turns that rule's DECLINE test into an APPROVE (so its test would fail)", async () => {
    assert.deepEqual(RULES.map((r) => r.code), [...RULE_CODES]);
    for (const [code, o] of cases) {
      const { link, deps } = creditCase(o);
      assert.equal(kindOf(await underwrite(link, CREDIT, deps)), `DECLINE(${code})`);
      const without = RULES.filter((r) => r.code !== code);
      assert.equal(kindOf(await underwrite(link, CREDIT, deps, without)), "APPROVE", `without ${code}`);
    }
  });
});
