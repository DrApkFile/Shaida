// Superseding a verified zkey (a contribution made under the wrong name): kept on record, taken off the chain.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { cannotAnnounce } from "../src/beacon-rules.js";
import { type CeremonyRecord, latestZkeySha, lastVerified, recordSchema, type Verified } from "../src/record.js";
import { cannotContributeTo, cannotSupersede } from "../src/supersede-rules.js";
import { renderTranscript } from "../src/transcript.js";

const sha = (c: string) => c.repeat(64);
const H = (c: string) => c.repeat(128);
const AT = "2026-11-21T14:00:00.000Z";
const SETUP = sha("0");

function entry(zkeySha: string, names: string[], superseded: Verified["superseded"] = null): Verified {
  return {
    zkey: { path: "ceremony/work/income_0001.zkey", sha256: zkeySha },
    circuitHash: H("c"),
    contributions: names.map((name, i) => ({ n: i + 1, name, hash: H(String(i + 1)), beacon: null })),
    log: `ceremony/logs/verify-${zkeySha.slice(0, 16)}.txt`,
    at: AT,
    superseded,
  };
}

function record(verified: Verified[], announced = false): CeremonyRecord {
  return recordSchema.parse({
    v: 1,
    dryRun: false,
    snarkjs: "0.7.6",
    circuit: { r1cs: "packages/shaida-proofs/build/income.r1cs", r1csSha256: sha("d") },
    ptau: { name: "p.ptau", blake2b: H("b") },
    setup: { zkey: { path: "ceremony/work/income_0000.zkey", sha256: SETUP }, at: AT },
    verified,
    beaconAnnouncement: announced
      ? { chainId: 44005, blockNumber: 9, forZkey: verified.at(-1)!.zkey, headAtAnnouncement: 1, headTimestamp: 1, blockSeconds: 1.012, expectedTimestamp: 2, at: AT }
      : null,
    beacon: null,
    final: null,
  });
}

const wrongName = { reason: 'Contribution #1 was made under the placeholder name "Your Real Name".', movedTo: null, at: AT };

describe("ceremony: superseding a verified zkey", () => {
  it("reads the record written before supersede existed: no entry is superseded", () => {
    const committed = recordSchema.parse(JSON.parse(readFileSync(new URL("../record.json", import.meta.url), "utf8")));
    assert.ok(committed.verified.length >= 1);
    assert.ok(committed.verified.every((v) => v.superseded === null || typeof v.superseded.reason === "string"));
  });

  it("allows only the latest active zkey, and only before the beacon is announced", () => {
    const one = record([entry(sha("1"), ["Your Real Name"])]);
    assert.equal(cannotSupersede(one, sha("1")), null);
    assert.match(cannotSupersede(one, sha("9"))!, /no verified zkey/);
    const two = record([entry(sha("1"), ["a"]), entry(sha("2"), ["a", "b"])]);
    assert.match(cannotSupersede(two, sha("1"))!, /not the latest active/);
    assert.match(cannotSupersede(record([entry(sha("1"), ["a"]), entry(sha("2"), ["a", "b"])], true), sha("2"))!, /beacon is announced/);
    assert.match(cannotSupersede(record([entry(sha("1"), ["a"], wrongName)]), sha("1"))!, /already superseded/);
  });

  it("after superseding contribution 1, the redo starts from the setup and the old zkey is refused as input", () => {
    const r = record([entry(sha("1"), ["Your Real Name"], wrongName)]);
    assert.equal(lastVerified(r), null);
    assert.equal(latestZkeySha(r), SETUP);
    assert.equal(cannotContributeTo(r, SETUP), null);
    assert.match(cannotContributeTo(r, sha("1"))!, /superseded/);
    assert.match(cannotAnnounce(r)!, /no verified zkey/);
  });

  it("the redone chain counts only active zkeys: superseded #1, new #1, then #2 can be announced", () => {
    const r = record([entry(sha("1"), ["Your Real Name"], wrongName), entry(sha("3"), ["Real Builder"]), entry(sha("4"), ["Real Builder", "Outside"])]);
    assert.equal(latestZkeySha(r), sha("4"));
    assert.equal(cannotAnnounce(r), null);
    assert.match(cannotContributeTo(r, sha("3"))!, /not the latest/);
  });

  it("the transcript keeps the superseded entry, its log and the reason", () => {
    const text = renderTranscript(record([entry(sha("1"), ["Your Real Name"], wrongName), entry(sha("3"), ["Real Builder"])]));
    assert.match(text, /income_0001\.zkey` \(SUPERSEDED\)/);
    assert.ok(text.includes(wrongName.reason));
    assert.ok(text.includes(`verify-${sha("1").slice(0, 16)}.txt`));
    assert.equal(text.match(/\(SUPERSEDED\)/g)!.length, 1);
  });
});
