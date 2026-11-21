// Property test for the threshold split (D13, EVAL C3): over random chunk sums, steps and thresholds, every share is a
// multiple of the step, no share ever equals an unrounded chunk sum, shares stay within their sums and add up to the
// threshold. Pure arithmetic: thousands of cases in well under a second. SPLIT_SEED (default: random) reproduces.
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { describe, it } from "node:test";
import { MAX_BUNDLE_PROOFS, SHARE_STEP, showableTotal, splitThreshold } from "../src/index";
import { Rng } from "./helpers/scenario";

const SEED = process.env.SPLIT_SEED === undefined ? randomInt(2 ** 31) : Number(process.env.SPLIT_SEED);
const CASES = 5_000;

/** A chunk sum with a non-zero part below `step`, so a share equal to it would reveal it exactly. */
function offStepSum(rng: Rng, step: bigint): bigint {
  const whole = rng.int(4) === 0 ? 0n : BigInt(rng.int(200));
  return whole * step + 1n + (rng.next64() % (step - 1n));
}

describe("threshold split: shares rounded to the step (D13)", () => {
  it(`C3 no share ever equals an unrounded chunk sum (${CASES} cases, SPLIT_SEED=${SEED})`, () => {
    const rng = new Rng(SEED);
    const failures: string[] = [];
    for (let n = 0; n < CASES; n++) {
      const step = SHARE_STEP * BigInt(rng.pick([1, 1, 1, 2, 5, 10]));
      const sums = Array.from({ length: 1 + rng.int(MAX_BUNDLE_PROOFS) }, () => offStepSum(rng, step));
      const showable = showableTotal(sums, step);
      const units = showable / step;
      const threshold = rng.pick([0n, units, units === 0n ? 0n : BigInt(rng.next64() % (units + 1n))]) * step;
      const shares = splitThreshold(sums, threshold, step);
      const where = `case ${n}: step ${step}, sums [${sums.join(", ")}], threshold ${threshold} → [${shares.join(", ")}]`;
      if (shares.reduce((a, b) => a + b, 0n) !== threshold) failures.push(`Σ shares ≠ threshold, ${where}`);
      shares.forEach((share, k) => {
        if (share % step !== 0n) failures.push(`share ${k} off the step, ${where}`);
        if (share > sums[k]!) failures.push(`share ${k} above its sum, ${where}`);
        if (sums.includes(share)) failures.push(`share ${k} equals an unrounded chunk sum, ${where}`);
      });
      // water-filling: shares below their rounded cap differ by at most one step
      const uncapped = shares.filter((share, k) => share < (sums[k]! / step) * step);
      if (uncapped.length > 1) {
        const spread = uncapped.reduce((a, b) => (a > b ? a : b)) - uncapped.reduce((a, b) => (a < b ? a : b));
        if (spread > step) failures.push(`uncapped shares spread ${spread}, ${where}`);
      }
    }
    assert.deepEqual(failures.slice(0, 5), []);
  });

  it("refuses a threshold off the step, or above what the rounded sums show", () => {
    assert.throws(() => splitThreshold([5_500_000n], 5_500_000n), RangeError);
    assert.throws(() => splitThreshold([5_500_000n, 2_500_000n], 8_000_000n), RangeError, "only 5 + 2 can be shown");
    assert.deepEqual(splitThreshold([5_500_000n, 2_500_000n], 7_000_000n), [5_000_000n, 2_000_000n]);
    assert.throws(() => splitThreshold([5_500_000n], 0n, 0n), RangeError);
  });
});
