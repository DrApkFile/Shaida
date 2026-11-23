// U16: over random policies and random proofs, the bot approves exactly when every rule holds, and the DECLINE lists
// exactly the failing rules in RULES order. The rules are recomputed here from their definitions (D30), not by
// calling rules.ts, so a wrong comparison in the engine shows up as a mismatch.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DAY, policyOf, RULE_CODES, underwrite, type Policy, type RuleCode } from "../src/index";
import { depsOf, linkOf, NOW, RENT, StandIn } from "./helpers";

class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number { this.s = (Math.imul(this.s ^ (this.s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; return this.s; }
  int(n: number): number { return this.next() % n; }
  big(n: bigint): bigint { return BigInt(this.next()) % n; }
}

function randomPolicy(r: Rng, i: number): Policy {
  const minPeriodDays = 1 + r.int(60);
  return policyOf({
    id: `prop-${i}`, version: 1 + r.int(3), title: "property", audience: "lender", readerName: RENT.readerName,
    minThreshold: (r.big(40n) * 500_000n).toString(), minPayments: 1 + r.int(12), minPeriodDays,
    maxPeriodDays: minPeriodDays + r.int(120), maxProofAgeDays: r.int(40), minDaysLeft: r.int(40),
  });
}

describe("underwrite: property (D30)", () => {
  it("U16 never APPROVE when any rule fails; APPROVE when all hold; reasons = the failing rules in order (2,000 random cases)", async () => {
    const r = new Rng(20261123);
    let approvals = 0;
    const seen = new Set<RuleCode>();
    for (let i = 0; i < 2_000; i++) {
      const p = randomPolicy(r, i);
      const threshold = r.big(40n) * 500_000n;
      const count = 1n + r.big(14n);
      const days = 1n + r.big(200n);
      const ageSec = r.big(45n * DAY);
      const leftSec = 1n + r.big(45n * DAY);
      // vouch leaves 0 and toIndex, `days` UTC calendar days apart, the last at NOW − ageSec
      const end = NOW - ageSec;
      const start = (end / DAY - (days - 1n)) * DAY + r.big(days === 1n ? (end % DAY) + 1n : DAY); // never after `end`
      const ledger = { start, spacing: end - start, rootTime: end };
      const prover = new StandIn();
      const link = linkOf({ expiry: NOW + leftSec, proofs: [{ threshold, count, fromIndex: 0n, toIndex: 2n }] }, prover);
      const deps = depsOf(prover, { ...ledger, spacing: (end - start) / 2n });
      const toDate = start + 2n * ((end - start) / 2n);
      const periodDays = toDate / DAY - start / DAY + 1n;
      const expected: RuleCode[] = [];
      if (threshold < p.minThreshold) expected.push("BelowMinThreshold");
      if (count < BigInt(p.minPayments)) expected.push("TooFewPayments");
      if (periodDays < BigInt(p.minPeriodDays)) expected.push("PeriodTooShort");
      if (periodDays > BigInt(p.maxPeriodDays)) expected.push("PeriodTooLong");
      if (ageSec > BigInt(p.maxProofAgeDays) * DAY) expected.push("ProofTooOld");
      if (leftSec < BigInt(p.minDaysLeft) * DAY) expected.push("ExpiresTooSoon");

      const d = await underwrite(link, p, deps);
      if (expected.length === 0) {
        assert.equal(d.kind, "APPROVE", `case ${i}: ${JSON.stringify(d)}`);
        approvals++;
      } else {
        assert.equal(d.kind, "DECLINE", `case ${i}: expected ${expected.join(",")}`);
        if (d.kind === "DECLINE") assert.deepEqual(d.reasons.map((x) => x.code), expected, `case ${i}`);
        expected.forEach((c) => seen.add(c));
      }
    }
    // the generator exercises both outcomes and every rule
    assert.ok(approvals > 50, `only ${approvals} approvals`);
    assert.deepEqual([...seen].sort(), [...RULE_CODES].sort());
  });
});
