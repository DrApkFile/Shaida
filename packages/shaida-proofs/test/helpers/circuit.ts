// Runs income.circom's compiled wasm (build/, from `pnpm compile`) on a circuit input. The wasm evaluates every
// `===` as it computes the witness, so a refused input names the template and line that failed.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CircuitInput } from "../../src/index.js";

export const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const BUILD = join(PKG, "build");
const WASM = join(BUILD, "income_js/income.wasm");
const CIRCUIT_SOURCE = join(PKG, "circuits/income.circom");

interface WitnessCalculator {
  calculateWitness(input: CircuitInput, sanityCheck: boolean): Promise<bigint[]>;
  calculateWTNSBin(input: CircuitInput, sanityCheck: boolean): Promise<Uint8Array>;
}
type Builder = (code: Buffer) => Promise<WitnessCalculator>;

let wasm: Buffer | undefined;
/** A fresh instance per run: the generated calculator keeps an error buffer across calls on one instance. */
function load(): Promise<WitnessCalculator> {
  if (!existsSync(WASM)) throw new Error(`${WASM} is missing: run \`pnpm --filter @shaida/proofs compile\` first`);
  const builder = createRequire(import.meta.url)(join(BUILD, "income_js/witness_calculator.js")) as Builder;
  wasm ??= readFileSync(WASM);
  return builder(wasm);
}

export interface Frame {
  readonly template: string;
  readonly line: number;
}

export type Verdict =
  | { readonly accepted: true; readonly witness: bigint[] }
  | {
      readonly accepted: false;
      /** Innermost first, as circom reports them. */
      readonly frames: readonly Frame[];
      /** The line of income.circom (template Income) where the refusal surfaced. */
      readonly incomeLine: number;
      readonly message: string;
    };

export async function runCircuit(input: CircuitInput): Promise<Verdict> {
  const wc = await load();
  try {
    return { accepted: true, witness: await wc.calculateWitness(input, true) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!message.includes("Assert Failed.")) throw e; // bad input shape: a test bug, not a refusal
    const frames = [...message.matchAll(/Error in template (\w+) line: (\d+)/g)].map((m) => ({
      template: m[1]!,
      line: Number(m[2]),
    }));
    const income = frames.find((f) => f.template.startsWith("Income_"));
    if (!income) throw new Error(`refusal outside template Income: ${message}`);
    return { accepted: false, frames, incomeLine: income.line, message };
  }
}

export async function witnessBin(input: CircuitInput): Promise<Uint8Array> {
  return (await load()).calculateWTNSBin(input, true);
}

/** 1-based line in income.circom of the only line containing `snippet` (so tests name constraints, not numbers). */
export function lineOf(snippet: string): number {
  const lines = readFileSync(CIRCUIT_SOURCE, "utf8").split("\n");
  const hits = lines.flatMap((l, i) => (l.includes(snippet) ? [i + 1] : []));
  if (hits.length !== 1) throw new Error(`"${snippet}" is on ${hits.length} lines of income.circom, want exactly 1`);
  return hits[0]!;
}

/** The constraints the cheat tests expect to fire, by their source text. */
export const CONSTRAINT = {
  thresholdBits: () => lineOf("thresholdBits.in <== threshold;"),
  fromBits: () => lineOf("fromBits.in <== fromIndex;"),
  toBits: () => lineOf("toBits.in <== toIndex;"),
  vouchRoot: () => lineOf("used[i] * (vTree[i].root - ledgerRoot) === 0;"),
  sweepRoot: () => lineOf("used[i] * (sTree[i].root - ledgerRoot) === 0;"),
  fromBound: () => lineOf("used[i] * (1 - atOrAfterFrom[i].out) === 0;"),
  toBound: () => lineOf("used[i] * (1 - atOrBeforeTo[i].out) === 0;"),
  increasing: () => lineOf("used[i] * (1 - increasing[i].out) === 0;"),
  noGap: () => lineOf("used[i] * (1 - used[i - 1]) === 0;"),
  count: () => lineOf("count === usedSum;"),
  atLeastOne: () => lineOf("used[0] === 1;"),
  threshold: () => lineOf("enough.out === 1;"),
  secretSNonZero: () => lineOf("used[i] * secretSIsZero[i].out === 0;"),
} as const;

const quiet = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

/** Checks a witness against every R1CS constraint (snarkjs wtns check), not only the wasm's asserts. */
export async function r1csHolds(input: CircuitInput): Promise<boolean> {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const snarkjs = await import("snarkjs");
  const dir = mkdtempSync(join(tmpdir(), "shaida-wtns-"));
  try {
    const file = join(dir, "income.wtns");
    writeFileSync(file, await witnessBin(input));
    return await snarkjs.wtns.check(join(BUILD, "income.r1cs"), file, quiet);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** snarkjs keeps worker threads for its curve; end them so `node --test` can exit. */
export async function endSnarkjs(): Promise<void> {
  const g = globalThis as { curve_bn128?: { terminate(): Promise<void> } };
  await g.curve_bn128?.terminate();
}
