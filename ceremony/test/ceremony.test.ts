// Pure parts of the ceremony scripts. The snarkjs steps themselves are exercised by a dry run (briefing/CEREMONY.md).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { beaconReadiness, cannotAnnounce, pickBeaconBlock } from "../src/beacon-rules.js";
import { ceremonyPaths } from "../src/config.js";
import { readEntropy } from "../src/entropy.js";
import { parseArgs } from "../src/main.js";
import type { Announcement, CeremonyRecord, Contribution } from "../src/record.js";
import { recordSchema } from "../src/record.js";
import { renderTranscript } from "../src/transcript.js";
import { parseVerifyLog } from "../src/verify-log.js";

/** snarkjs misc.formatHash: a title line, then 4 lines of 4 eight-hex-digit words. */
const formatHash = (hex: string, title: string) =>
  `${title}\n${hex.match(/.{32}/g)!.map((row) => `\t\t${row.match(/.{8}/g)!.join(" ")}`).join("\n")}`;
const H = (c: string) => c.repeat(128);

function verifyLog(contribs: readonly { name: string; hash: string; beacon?: string }[], ok = true): string[] {
  const lines = [`[INFO] ${formatHash(H("c"), "Circuit Hash: ")}`];
  // snarkjs 0.7.6 lists the newest contribution first (zkey_verify_frominit.js)
  [...contribs.entries()].reverse().forEach(([i, c]) => {
    lines.push("[INFO] -------------------------", `[INFO] ${formatHash(c.hash, `contribution #${i + 1} ${c.name}:`)}`);
    if (c.beacon) lines.push(`[INFO] Beacon generator: ${c.beacon}`, "[INFO] Beacon iterations Exp: 10");
  });
  lines.push("[INFO] -------------------------", "[DEBUG] Same ratio check L: 0/10");
  if (ok) lines.push("[INFO] ZKey Ok!");
  return lines;
}

const sha = "a".repeat(64);
const file = { path: "ceremony/work/x.zkey", sha256: sha };
const contribution = (n: number, beacon: Contribution["beacon"] = null): Contribution => ({ n, name: `c${n}`, hash: H(String(n)), beacon });

function record(contributions: Contribution[], announcement: Announcement | null = null): CeremonyRecord {
  return recordSchema.parse({
    v: 1,
    dryRun: true,
    snarkjs: "0.7.6",
    circuit: { r1cs: "packages/shaida-proofs/build/income.r1cs", r1csSha256: sha },
    ptau: { name: "p.ptau", blake2b: H("b") },
    setup: { zkey: file, at: "2026-11-21T10:00:00.000Z" },
    verified: contributions.length ? [{ zkey: file, circuitHash: H("c"), contributions, log: "logs/v.txt", at: "2026-11-21T10:00:00.000Z" }] : [],
    beaconAnnouncement: announcement,
    beacon: null,
    final: null,
  });
}

const announcement: Announcement = {
  chainId: 44005,
  blockNumber: 1_007_115,
  forZkey: file,
  headAtAnnouncement: 1_000_000,
  headTimestamp: 1_800_000_000,
  blockSeconds: 1.012,
  expectedTimestamp: 1_800_007_200,
  at: "2026-11-21T10:00:00.000Z",
};

describe("ceremony: zkey verify log", () => {
  it("reads the circuit hash and every contribution, with names and the beacon", () => {
    const r = parseVerifyLog(verifyLog([{ name: "builder", hash: H("1") }, { name: "Jane: a friend", hash: H("2") }, { name: "Aevum 44005 block 9", hash: H("3"), beacon: "ab12" }]));
    if (!r.ok) assert.fail(r.why);
    assert.equal(r.value.circuitHash, H("c"));
    assert.deepEqual(r.value.contributions, [
      { n: 1, name: "builder", hash: H("1"), beacon: null },
      { n: 2, name: "Jane: a friend", hash: H("2"), beacon: null },
      { n: 3, name: "Aevum 44005 block 9", hash: H("3"), beacon: { value: "ab12", iterationsExp: 10 } },
    ]);
  });

  it("refuses a log with a contribution number missing", () => {
    const lines = verifyLog([{ name: "a", hash: H("1") }, { name: "b", hash: H("2") }]).map((l) => l.replace("contribution #1 ", "contribution #3 "));
    assert.equal(parseVerifyLog(lines).ok, false);
  });

  it('refuses a log without "ZKey Ok!" and a log with a cut hash', () => {
    assert.equal(parseVerifyLog(verifyLog([{ name: "a", hash: H("1") }], false)).ok, false);
    const cut = verifyLog([{ name: "a", hash: H("1") }]).map((l) => (l.includes("contribution #1") ? l.split("\n").slice(0, 3).join("\n") : l));
    assert.equal(parseVerifyLog(cut).ok, false);
  });
});

describe("ceremony: beacon rules", () => {
  it("picks the block ~2 h ahead at 1.012 s per block", () => {
    assert.deepEqual(pickBeaconBlock({ number: 1_000_000, timestamp: 1_800_000_000 }), { blockNumber: 1_007_115, expectedTimestamp: 1_800_007_200 });
  });

  it("announces only after two verified contributions, never twice, never after a beacon", () => {
    assert.match(cannotAnnounce(record([]))!, /no verified zkey/);
    assert.match(cannotAnnounce(record([contribution(1)]))!, /needs 2/);
    assert.equal(cannotAnnounce(record([contribution(1), contribution(2)])), null);
    assert.match(cannotAnnounce(record([contribution(1), contribution(2)], announcement))!, /already announced/);
    assert.match(cannotAnnounce(record([contribution(1), contribution(2), contribution(3, { value: "ab", iterationsExp: 10 })]))!, /already has a beacon/);
  });

  it("waits for the block and its confirmations, and refuses an announcement committed after the block", () => {
    const at = (head: number) => ({ number: head, timestamp: 0 });
    const block = { timestamp: 1_800_007_300 };
    assert.equal(beaconReadiness(announcement, at(1_007_000), null, 1_800_000_100).kind, "wait");
    assert.equal(beaconReadiness(announcement, at(1_007_115 + 10), block, 1_800_000_100).kind, "wait");
    assert.equal(beaconReadiness(announcement, at(1_007_115 + 64), block, 1_800_000_100).kind, "ready");
    assert.equal(beaconReadiness(announcement, at(1_007_115 + 64), block, 1_800_007_300).kind, "refuse");
    assert.equal(beaconReadiness(announcement, at(1_007_115 + 64), block, null).kind, "ready", "dry run: no commit");
  });
});

describe("ceremony: entropy, paths and arguments", () => {
  it("allows test entropy only in a dry run", async () => {
    const real = ceremonyPaths({});
    const dry = ceremonyPaths({ CEREMONY_DIR: "/tmp/shaida-dry" });
    assert.equal(real.dryRun, false);
    assert.equal(dry.dryRun, true);
    await assert.rejects(readEntropy(real, { CEREMONY_TEST_ENTROPY: "x" }), /only allowed in a dry run/);
    assert.equal(await readEntropy(dry, { CEREMONY_TEST_ENTROPY: "x" }), "x");
  });

  it("refuses unknown options", () => {
    assert.deepEqual([...parseArgs(["--in", "a", "--name=Jo Do"], ["in", "name"])], [["in", "a"], ["name", "Jo Do"]]);
    assert.throws(() => parseArgs(["--entropy", "x"], ["in"]), /unknown option --entropy/);
    assert.deepEqual([...parseArgs(["--in-sha256", "ab", "--sha256=cd"], ["in-sha256", "sha256"])], [["in-sha256", "ab"], ["sha256", "cd"]]);
  });

  it("labels a dry-run transcript and shows every contribution hash", () => {
    const text = renderTranscript(record([contribution(1), contribution(2)], announcement));
    assert.match(text, /DRY RUN/);
    assert.match(text, /block \*\*1007115\*\*/);
    assert.ok(text.includes(H("2").slice(0, 32)));
  });
});
