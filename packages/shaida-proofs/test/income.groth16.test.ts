// Full Groth16 proofs with a THROWAWAY local key (scripts/throwaway.ts). Local only: needs PTAU_PATH pointing at
// the Hermez 2^17 ptau (hash-checked, briefing/CEREMONY.md). Without it these tests are skipped as INCONCLUSIVE,
// never passed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import * as snarkjs from "snarkjs";
import {
  buildIncomeBundle,
  encodeIncomeLink,
  FIELD_ORDER,
  type Groth16Proof,
  type IncomeVerification,
  PUBLIC_SIGNAL_ORDER,
  SHARE_STEP,
  verifyIncomeLink,
} from "../src/index";
import { ensureThrowawayKey, type ThrowawayKey } from "../scripts/throwaway";
import { BUILD, endSnarkjs } from "./helpers/circuit";
import { contextFor, depsFor, type LinkProof, type Opening } from "./helpers/link";
import { buildSingleProof, honestRequest, makeScenario, Rng, type SingleProof, showableThreshold } from "./helpers/scenario";

const PTAU = process.env.PTAU_PATH;
const SKIP = PTAU ? false : "INCONCLUSIVE: PTAU_PATH unset; Groth16 proving tests not run (see briefing/CEREMONY.md)";
if (SKIP) console.log(SKIP);

const WASM = join(BUILD, "income_js/income.wasm");
const at = (name: (typeof PUBLIC_SIGNAL_ORDER)[number]) => PUBLIC_SIGNAL_ORDER.indexOf(name);

describe("income circuit: Groth16 with a throwaway key (local)", { skip: SKIP }, () => {
  let key: ThrowawayKey;
  let vkey: snarkjs.VerificationKey;
  let w: SingleProof;
  let proof: snarkjs.Groth16Proof;
  let signals: string[];

  before(async () => {
    key = await ensureThrowawayKey(PTAU!);
    vkey = JSON.parse(readFileSync(key.vkey, "utf8")) as snarkjs.VerificationKey;
    const rng = new Rng(16);
    const s = makeScenario(rng, { payments: 3 });
    const r = buildSingleProof(honestRequest(s, rng, { threshold: SHARE_STEP }));
    if (!r.ok) throw new Error(r.error.code);
    w = r.value;
    ({ proof, publicSignals: signals } = await snarkjs.groth16.fullProve(w.input, WASM, key.zkey));
  });
  after(endSnarkjs);

  it("H1 an honest proof verifies, with public signals in the frozen order", async () => {
    assert.deepEqual(signals, PUBLIC_SIGNAL_ORDER.map((k) => w.publicSignals[k].toString()));
    assert.equal(await snarkjs.groth16.verify(vkey, signals, proof), true);
  });

  const tamper = (name: (typeof PUBLIC_SIGNAL_ORDER)[number], value: (v: bigint) => bigint) => {
    const t = [...signals];
    t[at(name)] = (value(BigInt(t[at(name)]!)) % FIELD_ORDER).toString();
    return t;
  };

  it("X12 refuses the proof replayed for another threshold", async () => {
    assert.equal(await snarkjs.groth16.verify(vkey, tamper("threshold", (v) => v + 1n), proof), false);
    assert.equal(await snarkjs.groth16.verify(vkey, tamper("threshold", (v) => v - 1n), proof), false);
  });

  it("refuses the proof replayed for another context (another reader or expiry)", async () => {
    assert.equal(await snarkjs.groth16.verify(vkey, tamper("context", (v) => v + 1n), proof), false);
  });

  it("refuses an edited count, range, root or asset", async () => {
    for (const name of ["count", "fromIndex", "toIndex", "ledgerRoot", "asset"] as const) {
      assert.equal(await snarkjs.groth16.verify(vkey, tamper(name, (v) => v + 1n), proof), false, name);
    }
  });
});

describe("verifyIncomeLink with real Groth16 proofs: a 2-proof bundle (D12, local)", { skip: SKIP }, () => {
  const opening: Opening = { readerIdHash: 0x5eade5n, expiry: 1_900_000_000n, salt: 9n };
  let proofs: LinkProof[];
  let total: bigint;
  let deps: ReturnType<typeof depsFor>;
  const link = (ps: LinkProof[]) =>
    encodeIncomeLink({ v: 1, proofs: ps, readerIdHash: `${opening.readerIdHash}`, expiry: `${opening.expiry}`, salt: `${opening.salt}` });
  const code = (v: IncomeVerification) => (v.status === "VALID" ? "VALID" : `${v.status}(${v.error.code})`);

  before(async () => {
    const key = await ensureThrowawayKey(PTAU!);
    const vkey = JSON.parse(readFileSync(key.vkey, "utf8")) as snarkjs.VerificationKey;
    const rng = new Rng(26);
    const s = makeScenario(rng, { payments: 6 });
    const base = honestRequest(s, rng, { context: contextFor(opening) });
    total = showableThreshold(base);
    const r = buildIncomeBundle({ ...base, threshold: total });
    if (!r.ok) throw new Error(r.error.code);
    proofs = [];
    for (const p of r.value.proofs) {
      const out = await snarkjs.groth16.fullProve(p.input, WASM, key.zkey);
      proofs.push({ proof: out.proof as unknown as Groth16Proof, publicSignals: out.publicSignals });
    }
    const verify = (signals: readonly string[], proof: Groth16Proof) =>
      snarkjs.groth16.verify(vkey, [...signals], proof as unknown as snarkjs.Groth16Proof);
    deps = depsFor(verify, opening.readerIdHash, [s.tree.root]);
  });
  after(endSnarkjs);

  it("accepts the honest bundle: 6 payments in 2 proofs, total = Σ thresholds", async () => {
    assert.equal(proofs.length, 2);
    const v = await verifyIncomeLink(link(proofs), deps);
    if (v.status !== "VALID") assert.fail(`${v.status}: ${v.error.message}`);
    assert.equal(v.threshold, total);
    assert.equal(v.count, 6n);
  });

  it("X15 refuses a real proof included twice (RangesOverlap)", async () => {
    assert.equal(code(await verifyIncomeLink(link([proofs[0]!, proofs[0]!]), deps)), "INVALID(RangesOverlap)");
  });

  it("refuses one proof's threshold raised by 1 (ProofInvalid)", async () => {
    const signals = [...proofs[1]!.publicSignals];
    signals[at("threshold")] = (BigInt(signals[at("threshold")]!) + 1n).toString();
    assert.equal(code(await verifyIncomeLink(link([proofs[0]!, { ...proofs[1]!, publicSignals: signals }]), deps)), "INVALID(ProofInvalid)");
  });
});
