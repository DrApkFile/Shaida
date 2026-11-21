// verifyIncomeLink (PRD §5) on bundles of proofs (D12). Groth16 is the witness-backed stand-in (helpers/link.ts);
// income.groth16.test.ts repeats the bundle cases with real proofs locally.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIncomeBundle,
  type IncomeBundleWitness,
  type IncomeVerification,
  LedgerTree,
  TUSD8_FIELD,
  verifyIncomeBundle,
  verifyIncomeLink,
} from "../src/index";
import { contextFor, depsFor, fragment, type LinkProof, type Opening, WitnessBackedProver } from "./helpers/link";
import { buildSingleProof, honestRequest, makeScenario, Rng, type Scenario, showableThreshold } from "./helpers/scenario";

const READER = 0x5eade5n;
const OTHER_READER = 0xb0ba5n;
const opening: Opening = { readerIdHash: READER, expiry: 1_900_000_000n, salt: 42n };

async function setup(seed: number, payments: number) {
  const rng = new Rng(seed);
  const s = makeScenario(rng, { payments, noise: 2 });
  const prover = new WitnessBackedProver();
  /** The largest threshold the bundle can show (D13: shares in whole tUSD8). */
  const total = showableThreshold(honestRequest(s, new Rng(seed)));
  const request = (o: Opening, extra: Record<string, unknown> = {}) =>
    honestRequest(s, new Rng(seed), { threshold: total, context: contextFor(o), ...extra });
  const bundle = async (o: Opening, extra: Record<string, unknown> = {}) => {
    const r = buildIncomeBundle(request(o, extra));
    if (!r.ok) assert.fail(`builder refused: ${r.error.code}`);
    return { b: r.value, proofs: await Promise.all(r.value.proofs.map((p) => prover.prove(p))) };
  };
  return { s, prover, total, request, bundle, deps: depsFor(prover.verify, READER, [s.tree.root]) };
}

const code = (v: IncomeVerification) => (v.status === "VALID" ? "VALID" : `${v.status}(${v.error.code})`);

function assertValidFor(v: IncomeVerification, b: IncomeBundleWitness, s: Scenario, threshold: bigint) {
  if (v.status !== "VALID") assert.fail(`${v.status}: ${v.error.code}: ${v.error.message}`);
  assert.equal(v.proofs, b.proofs.length);
  assert.equal(v.threshold, threshold);
  assert.equal(v.count, BigInt(s.payments.length));
  assert.equal(v.fromIndex, b.proofs[0]!.publicSignals.fromIndex);
  assert.equal(v.toIndex, b.proofs.at(-1)!.publicSignals.toIndex);
  assert.equal(v.expiry, opening.expiry);
}

describe("verifyIncomeLink: honest bundles (D12, C2)", () => {
  it("accepts an honest 2-proof bundle: total = Σ thresholds, count = Σ counts", async () => {
    const t = await setup(21, 6);
    const { b, proofs } = await t.bundle(opening);
    assert.equal(proofs.length, 2);
    assertValidFor(await verifyIncomeLink(fragment(proofs, opening), t.deps), b, t.s, t.total);
  });

  it("accepts an honest 3-proof bundle, in any order", async () => {
    const t = await setup(31, 10);
    const { b, proofs } = await t.bundle(opening);
    assert.equal(proofs.length, 3);
    assertValidFor(await verifyIncomeLink(`#${fragment(proofs, opening)}`, t.deps), b, t.s, t.total);
    const shuffled = [proofs[2]!, proofs[0]!, proofs[1]!];
    assertValidFor(await verifyIncomeLink(fragment(shuffled, opening), t.deps), b, t.s, t.total);
  });

  it("accepts a single proof as a bundle of one", async () => {
    const t = await setup(11, 3);
    const { b, proofs } = await t.bundle(opening);
    assertValidFor(await verifyIncomeLink(fragment(proofs, opening), t.deps), b, t.s, t.total);
  });
});

describe("verifyIncomeLink: bundle refusals (D12, C1)", () => {
  it("X14 RangesOverlap: refuses two proofs whose leaf ranges share an index", async () => {
    const t = await setup(41, 6);
    const { b, proofs } = await t.bundle(opening);
    const [first, second] = b.proofs.map((p) => p.publicSignals);
    // a proof over the second chunk, but starting one leaf inside the first proof's range
    const r = buildSingleProof(t.request(opening, { fromIndex: first!.toIndex, toIndex: second!.toIndex, threshold: 0n }));
    if (!r.ok) assert.fail(r.error.code);
    const overlapping: LinkProof = await t.prover.prove(r.value);
    assert.equal(code(await verifyIncomeLink(fragment([proofs[0]!, overlapping], opening), t.deps)), "INVALID(RangesOverlap)");
  });

  it("X15 RangesOverlap: refuses the same proof included twice", async () => {
    const t = await setup(51, 6);
    const { proofs } = await t.bundle(opening);
    for (const dup of [[proofs[0]!, proofs[0]!], [proofs[0]!, proofs[1]!, proofs[1]!]]) {
      assert.equal(code(await verifyIncomeLink(fragment(dup, opening), t.deps)), "INVALID(RangesOverlap)");
    }
  });

  it("X16 MixedContexts: refuses a bundle that joins proofs made for two readers", async () => {
    const t = await setup(61, 6);
    const mine = await t.bundle(opening);
    const theirs = await t.bundle({ ...opening, readerIdHash: OTHER_READER });
    const mixed = [mine.proofs[0]!, theirs.proofs[1]!];
    assert.equal(code(await verifyIncomeLink(fragment(mixed, opening), t.deps)), "INVALID(MixedContexts)");
  });

  it("X17 MixedContexts: refuses a bundle that joins proofs with two expiries", async () => {
    const t = await setup(71, 6);
    const mine = await t.bundle(opening);
    const later = await t.bundle({ ...opening, expiry: opening.expiry + 86_400n });
    const mixed = [later.proofs[0]!, mine.proofs[1]!];
    assert.equal(code(await verifyIncomeLink(fragment(mixed, opening), t.deps)), "INVALID(MixedContexts)");
  });

  it("X18 MixedRoots: refuses a bundle that joins proofs made against two known ledger roots (D13)", async () => {
    const t = await setup(75, 6);
    const now = await t.bundle(opening);
    // the same period built again after one more leaf of someone else: same ranges, another (also known) root
    const grown = [...t.s.leaves, 0x1234n];
    const laterRoot = new LedgerTree(grown).root;
    const later = await t.bundle(opening, { ledgerLeaves: grown, ledgerRoot: laterRoot });
    const deps = depsFor(t.prover.verify, READER, [t.s.tree.root, laterRoot]);
    assert.equal(code(await verifyIncomeLink(fragment(now.proofs, opening), deps)), "VALID", "each build alone");
    assert.equal(code(await verifyIncomeLink(fragment(later.proofs, opening), deps)), "VALID");
    const mixed = [now.proofs[0]!, later.proofs[1]!];
    assert.equal(code(await verifyIncomeLink(fragment(mixed, opening), deps)), "INVALID(MixedRoots)");
  });

  it("ProofInvalid: one tampered proof in an otherwise honest bundle fails the whole bundle", async () => {
    const t = await setup(81, 6);
    const { proofs } = await t.bundle(opening);
    const signals = [...proofs[1]!.publicSignals];
    signals[2] = (BigInt(signals[2]!) + 1n).toString(); // threshold + 1
    const tampered = [proofs[0]!, { ...proofs[1]!, publicSignals: signals }];
    assert.equal(code(await verifyIncomeLink(fragment(tampered, opening), t.deps)), "INVALID(ProofInvalid)");
  });
});

describe("verifyIncomeLink: PRD §5 steps on a bundle", () => {
  it("returns the first failing step's code", async () => {
    const t = await setup(91, 5);
    const { proofs } = await t.bundle(opening);
    const run = (f: string, deps = t.deps) => verifyIncomeLink(f, deps).then(code);
    const link = fragment(proofs, opening);

    assert.equal(await run("not base64!"), "INVALID(ProofInvalid)", "1 malformed fragment");
    const nine = { v: 1, proofs: Array(9).fill(proofs[0]!), readerIdHash: `${READER}`, expiry: `${opening.expiry}`, salt: "42" };
    assert.equal(code(await verifyIncomeBundle(nine, t.deps)), "INVALID(ProofInvalid)", "1 more than 8 proofs");
    assert.equal(code(await verifyIncomeBundle({ ...nine, proofs: [proofs[0]!], extra: 1 }, t.deps)), "INVALID(ProofInvalid)", "1 unknown key");
    const foreign = proofs.map((p) => ({ ...p, publicSignals: p.publicSignals.map((x, i) => (i === 1 ? (TUSD8_FIELD + 1n).toString() : x)) }));
    assert.equal(await run(fragment(foreign, opening)), "INVALID(AssetMismatch)", "2 asset");
    assert.equal(await run(fragment(proofs, { ...opening, salt: 43n })), "INVALID(ContextMismatch)", "3 context opening");
    assert.equal(await run(link, depsFor(t.prover.verify, OTHER_READER, [t.s.tree.root])), "INVALID(WrongReader)", "4 reader");
    assert.equal(await run(link, depsFor(t.prover.verify, READER, [t.s.tree.root], opening.expiry + 1n)), "INVALID(ProofExpired)", "5 expiry");
    assert.equal(await run(link, depsFor(t.prover.verify, READER, [])), "INCONCLUSIVE(UnknownRoot)", "6 root");
    assert.equal(await run(link, { ...t.deps, resolveRange: async () => null }), "INCONCLUSIVE(RangeUnresolvable)", "8 dates");
    assert.equal(await run(link), "VALID", "9 all steps pass");
  });
});
