// D27: reader id, period → leaf range, dates for the reader, threshold suggestions. The X11 case runs the real
// income.wasm through the witness-backed stand-in (helpers/link.ts) to show the name hash is what binds the reader.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIncomeBundle,
  datesForRange,
  leafRangeForPeriod,
  nearestValidThresholds,
  normalizeReaderName,
  READER_NAME_MAX_BYTES,
  readerIdHashOf,
  type TimedLeaf,
  verifyIncomeLink,
} from "../src/index";
import { contextFor, depsFor, fragment, WitnessBackedProver } from "./helpers/link";
import { honestRequest, makeScenario, Rng, showableThreshold } from "./helpers/scenario";

const hashOf = (name: string) => {
  const r = readerIdHashOf(name);
  if (!r.ok) assert.fail(`${name}: ${r.error.code}`);
  return r.value;
};

describe("reader id (D27)", () => {
  it("W01 one reader however the name is spaced, cased or composed", () => {
    assert.equal(normalizeReaderName("  Landlord \t  BOLA "), "landlord bola");
    assert.equal(hashOf("Landlord Bola"), hashOf("  landlord   BOLA "));
    // "é" precomposed and as e + combining acute are one name after NFC
    assert.equal(hashOf("Adé"), hashOf("Adé"));
  });

  it("W02 refuses an empty name and one longer than 96 bytes with InputRejected", () => {
    for (const bad of ["", "   ", "x".repeat(READER_NAME_MAX_BYTES + 1), "é".repeat(49)]) {
      const r = readerIdHashOf(bad);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error.code, "InputRejected");
    }
    assert.equal(readerIdHashOf("x".repeat(READER_NAME_MAX_BYTES)).ok, true);
  });

  it("W03 different names give different ids (incl. names differing in one byte, a leading NUL, or the last chunk)", () => {
    const names = ["landlord bola", "landlord bolu", "\u0000landlord bola", "a", "b", "ab", "x".repeat(31), "x".repeat(32), "x".repeat(96), `${"x".repeat(95)}y`];
    const ids = new Set(names.map(hashOf));
    assert.equal(ids.size, names.length);
  });

  it("X11 a link made for Landlord Bola verifies for that name in any spacing and is WrongReader for another", async () => {
    const rng = new Rng(11);
    const s = makeScenario(rng, { payments: 3, noise: 2 });
    const prover = new WitnessBackedProver();
    const opening = { readerIdHash: hashOf("Landlord Bola"), expiry: 1_900_000_000n, salt: 7n };
    const total = showableThreshold(honestRequest(s, new Rng(11)));
    const r = buildIncomeBundle(honestRequest(s, new Rng(11), { threshold: total, context: contextFor(opening) }));
    if (!r.ok) assert.fail(r.error.code);
    const link = fragment(await Promise.all(r.value.proofs.map((p) => prover.prove(p))), opening);
    const as = (name: string) => verifyIncomeLink(link, depsFor(prover.verify, hashOf(name), [s.tree.root]));
    assert.equal((await as(" landlord  bola")).status, "VALID");
    const other = await as("Landlord Bolu");
    assert.equal(other.status === "INVALID" && other.error.code, "WrongReader");
  });
});

const leaf = (index: number, time: number, vouch: boolean): TimedLeaf => ({ index, time: BigInt(time), vouch });
// V0 S1 at t=100; V2 at 200; S3 at 250; V4 S5 at 300 (S leaves follow their sweep, later than the V leaf)
const LEAVES = [leaf(0, 100, true), leaf(1, 100, false), leaf(2, 200, true), leaf(3, 250, false), leaf(4, 300, true), leaf(5, 300, false)];

describe("period ↔ leaf range (D27)", () => {
  it("W04 a period maps to the first leaf at or after its start and the last at or before its end", () => {
    const range = (a: number, b: number, leaves = LEAVES) => {
      const r = leafRangeForPeriod(leaves, BigInt(a), BigInt(b));
      return r.ok ? [Number(r.value.fromIndex), Number(r.value.toIndex)] : r.error.code;
    };
    assert.deepEqual(range(0, 1000), [0, 5]);
    assert.deepEqual(range(100, 100), [0, 1]);
    assert.deepEqual(range(101, 299), [2, 3]);
    assert.deepEqual(range(200, 300), [2, 5]);
    assert.deepEqual(range(250, 250), [3, 3]);
    assert.deepEqual(range(101, 299, [...LEAVES].reverse()), [2, 3]); // order of the input does not matter
  });

  it("W05 a period with no leaf is NoSweptPayments; a reversed one is InputRejected", () => {
    const empty = leafRangeForPeriod(LEAVES, 301n, 400n);
    assert.equal(!empty.ok && empty.error.code, "NoSweptPayments");
    const reversed = leafRangeForPeriod(LEAVES, 300n, 100n);
    assert.equal(!reversed.ok && reversed.error.code, "InputRejected");
  });

  it("W06 the reader's dates are the first and last V leaf inside the range; none is null (RangeUnresolvable)", () => {
    assert.deepEqual(datesForRange(LEAVES, 0n, 5n), { fromDate: 100n, toDate: 300n });
    assert.deepEqual(datesForRange(LEAVES, 1n, 3n), { fromDate: 200n, toDate: 200n });
    assert.equal(datesForRange(LEAVES, 3n, 3n), null);
    assert.equal(datesForRange([], 0n, 9n), null);
  });
});

describe("threshold suggestions (D13, D27)", () => {
  const T = 1_000_000n;
  it("W07 an off-step amount gets the nearest multiples below and above; a multiple is valid", () => {
    assert.deepEqual(nearestValidThresholds(9n * T, T), { valid: true, below: 9n * T, above: 9n * T });
    assert.deepEqual(nearestValidThresholds(9_500_000n, T), { valid: false, below: 9n * T, above: 10n * T });
    assert.deepEqual(nearestValidThresholds(12n * T, 5n * T), { valid: false, below: 10n * T, above: 15n * T });
    assert.deepEqual(nearestValidThresholds(300_000n, T), { valid: false, below: null, above: T });
    assert.deepEqual(nearestValidThresholds(0n, T), { valid: false, below: null, above: T });
  });

  it("W08 every suggestion is a positive multiple of the step, within one step of the amount", () => {
    const rng = new Rng(8);
    for (let i = 0; i < 2000; i++) {
      const step = T * BigInt(1 + rng.int(10));
      const amount = BigInt(rng.int(100_000_000));
      const s = nearestValidThresholds(amount, step);
      for (const v of [s.below, s.above]) {
        if (v === null) continue;
        assert.ok(v > 0n && v % step === 0n);
        assert.ok(v - amount < step && amount - v < step);
      }
      assert.equal(s.valid, amount > 0n && amount % step === 0n);
    }
  });
});
