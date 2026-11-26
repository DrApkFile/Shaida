// The bot and revocation (D35) and reader codes (D36): a revoked link is declined, an unreadable registry is never an
// approval, and the bot stays name-only (its reader name is public by design, so a code-protected link isn't for it).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codeBoundReaderIdHash, revokeSaltOf } from "@shaida/proofs";
import { underwrite, type Decision } from "../src/index";
import { BOT_READER, depsOf, ledgerSpanning, linkOf, RENT, StandIn, TUSD8, type LinkSpec } from "./helpers";

const kindOf = (d: Decision) => (d.kind === "DECLINE" ? `DECLINE(${d.reasons.map((r) => r.code).join(",")})` : d.kind === "INCONCLUSIVE" ? `INCONCLUSIVE(${d.error.code})` : "APPROVE");
const SALT = revokeSaltOf(0xabcdefn);

function rentCase(patch: Partial<LinkSpec>, revoked?: ReadonlyMap<bigint, bigint> | "unreadable") {
  const { ledger, toIndex } = ledgerSpanning(2, 1);
  const prover = new StandIn();
  const link = linkOf({ proofs: [{ threshold: 3n * TUSD8, count: 3n, fromIndex: 0n, toIndex }], ...patch }, prover);
  return { link, deps: depsOf(prover, { ...ledger, ...(revoked ? { revoked } : {}) }) };
}

describe("underwrite: revocation (D35) and reader codes (D36)", () => {
  it("U30 a revoked link is DECLINE(ProofRevoked); the same link before the revoke is APPROVE", async () => {
    const before = rentCase({ v2: "name", salt: SALT });
    assert.equal(kindOf(await underwrite(before.link, RENT, before.deps)), "APPROVE");
    const after = rentCase({ v2: "name", salt: SALT }, new Map([[SALT, 4_100_000n]]));
    const d = await underwrite(after.link, RENT, after.deps);
    assert.equal(kindOf(d), "DECLINE(ProofRevoked)");
    assert.equal(d.kind === "DECLINE" && d.facts, null, "no facts from a revoked link");
  });

  it("U31 an unreadable revocation registry is INCONCLUSIVE(ChainUnreachable), never an approval, for v1 and v2 links", async () => {
    for (const patch of [{}, { v2: "name" as const, salt: SALT }]) {
      const c = rentCase(patch, "unreadable");
      assert.equal(kindOf(await underwrite(c.link, RENT, c.deps)), "INCONCLUSIVE(ChainUnreachable)");
    }
  });

  it("U32 the bot is name-only: a code-protected link is DECLINE(WrongReader), even one bound to the bot's own name", async () => {
    const c = rentCase({ v2: "code", salt: SALT, reader: codeBoundReaderIdHash(BOT_READER, 12345n) });
    assert.equal(kindOf(await underwrite(c.link, RENT, c.deps)), "DECLINE(WrongReader)");
  });

  it("U33 a revocable name-only link made out to the bot is APPROVEd like an old one", async () => {
    const v2 = rentCase({ v2: "name", salt: SALT });
    const v1 = rentCase({});
    assert.equal(kindOf(await underwrite(v2.link, RENT, v2.deps)), "APPROVE");
    assert.equal(kindOf(await underwrite(v1.link, RENT, v1.deps)), "APPROVE");
  });
});
