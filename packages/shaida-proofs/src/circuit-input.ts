// income.circom's input layout: public signals in their frozen order, then 8 slots (unused ones padded).
import { INCOME_SLOTS, TREE_DEPTH } from "./field.js";
import type { MerklePath } from "./tree.js";

export interface IncomePublicSignals {
  readonly ledgerRoot: bigint;
  readonly asset: bigint;
  readonly threshold: bigint;
  readonly count: bigint;
  readonly fromIndex: bigint;
  readonly toIndex: bigint;
  readonly context: bigint;
}

/** Public signal order of income.circom (BUILD_CONTRACT: frozen). */
export const PUBLIC_SIGNAL_ORDER = [
  "ledgerRoot",
  "asset",
  "threshold",
  "count",
  "fromIndex",
  "toIndex",
  "context",
] as const satisfies readonly (keyof IncomePublicSignals)[];

export interface CircuitSlot {
  readonly used: 0 | 1;
  readonly secretP: bigint;
  readonly amount: bigint;
  readonly payerId: bigint;
  readonly vPath: MerklePath;
  readonly secretS: bigint;
  readonly amountS: bigint;
  readonly sPath: MerklePath;
}

/** income.circom input, as decimal strings (the form snarkjs and the circom wasm take). */
export type CircuitInput = Record<string, string | string[] | string[][]>;

const EMPTY_PATH: MerklePath = {
  pathElements: Array<bigint>(TREE_DEPTH).fill(0n),
  pathIndices: Array<0 | 1>(TREE_DEPTH).fill(0),
};

export const UNUSED_SLOT: CircuitSlot = {
  used: 0,
  secretP: 0n,
  amount: 0n,
  payerId: 0n,
  vPath: EMPTY_PATH,
  secretS: 0n,
  amountS: 0n,
  sPath: EMPTY_PATH,
};

/** Lays out public signals and up to 8 slots (unused ones padded) as income.circom input. */
export function circuitInput(publicSignals: IncomePublicSignals, slots: readonly CircuitSlot[]): CircuitInput {
  if (slots.length > INCOME_SLOTS) throw new RangeError(`at most ${INCOME_SLOTS} slots`);
  const all = [...slots, ...Array<CircuitSlot>(INCOME_SLOTS - slots.length).fill(UNUSED_SLOT)];
  const each = (f: (s: CircuitSlot) => bigint | number) => all.map((s) => f(s).toString());
  const paths = (f: (s: CircuitSlot) => readonly (bigint | number)[]) => all.map((s) => f(s).map(String));
  const input: CircuitInput = {};
  for (const name of PUBLIC_SIGNAL_ORDER) input[name] = publicSignals[name].toString();
  return {
    ...input,
    used: each((s) => s.used),
    secretP: each((s) => s.secretP),
    amount: each((s) => s.amount),
    payerId: each((s) => s.payerId),
    vPathElements: paths((s) => s.vPath.pathElements),
    vPathIndices: paths((s) => s.vPath.pathIndices),
    secretS: each((s) => s.secretS),
    amountS: each((s) => s.amountS),
    sPathElements: paths((s) => s.sPath.pathElements),
    sPathIndices: paths((s) => s.sPath.pathIndices),
  };
}
