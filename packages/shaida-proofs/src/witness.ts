// Pure witness builder for income.circom: ledger leaves + the recipient's payment records in, a bundle of circuit
// inputs (or a named refusal) out. A period with more than INCOME_SLOTS payments is split into proofs over
// disjoint leaf ranges (D12, src/split.ts). No network, no clock, no randomness.
import { type CircuitInput, type CircuitSlot, circuitInput, type IncomePublicSignals } from "./circuit-input.js";
import { INCOME_SLOTS, MAX_BUNDLE_PROOFS } from "./field.js";
import { type Result, shaidaError } from "./errors.js";
import { noteCommitment, nullifierOf, sweepLeaf, vouchLeaf } from "./hash.js";
import { type IncomeRequest, incomeRequestSchema, type PaymentRecord } from "./schema.js";
import { chunk, chunkRanges, splitThreshold } from "./split.js";
import { LedgerTree } from "./tree.js";

/** Why a payment record is not counted. Not an error: the builder counts what it can and says what it left out. */
export type SkipReason =
  | "notVouched" // no V leaf: paid outside ShaidaLedger, or a copied vouchedPay not yet repaired with lateVouch (D9)
  | "notSwept" // no S leaf this record opens: not swept yet, clawed back, or swept by someone else (X08, X09)
  | "outOfRange" // V leaf outside [fromIndex, toIndex]
  | "duplicate"; // the same payment note listed twice

export interface CountedPayment {
  readonly record: number;
  readonly vouchIndex: number;
  readonly sweepIndex: number;
  readonly amount: bigint;
}

/** One proof of the bundle: at most INCOME_SLOTS payments. */
export interface IncomeProofWitness {
  readonly publicSignals: IncomePublicSignals;
  readonly input: CircuitInput;
  readonly counted: readonly CountedPayment[];
}

/** Everything needed to prove one period: 1..MAX_BUNDLE_PROOFS proofs over disjoint ranges, in leaf order. */
export interface IncomeBundleWitness {
  readonly proofs: readonly IncomeProofWitness[];
  /** = Σ proof thresholds = the asked threshold. */
  readonly threshold: bigint;
  /** = Σ proof counts. */
  readonly count: bigint;
  readonly counted: readonly CountedPayment[];
  readonly skipped: readonly { readonly record: number; readonly reason: SkipReason }[];
}

type Countable = { readonly payment: CountedPayment; readonly slot: CircuitSlot };
type Classified = ({ readonly kind: "countable" } & Countable) | { readonly kind: "skipped"; readonly reason: SkipReason };

function classify(
  request: IncomeRequest,
  tree: LedgerTree,
  leafIndex: ReadonlyMap<bigint, number>,
  record: PaymentRecord,
  position: number,
): Classified {
  const cp = noteCommitment(record.secretP, record.amount, request.asset);
  const vouchIndex = leafIndex.get(vouchLeaf(record.payerId, cp));
  if (vouchIndex === undefined) return { kind: "skipped", reason: "notVouched" };
  const cs = noteCommitment(record.secretS, record.amountS, request.asset);
  const sweepIndex = leafIndex.get(sweepLeaf(nullifierOf(record.secretP, cp), cs));
  if (sweepIndex === undefined) return { kind: "skipped", reason: "notSwept" };
  const v = BigInt(vouchIndex);
  if (v < request.fromIndex || v > request.toIndex) return { kind: "skipped", reason: "outOfRange" };
  return {
    kind: "countable",
    payment: { record: position, vouchIndex, sweepIndex, amount: record.amount },
    slot: { ...record, used: 1, vPath: tree.path(vouchIndex), sPath: tree.path(sweepIndex) },
  };
}

function refuse(code: Parameters<typeof shaidaError>[0], message: string): Result<IncomeBundleWitness> {
  return { ok: false, error: shaidaError(code, `${message} Nothing was built.`) };
}

export function buildIncomeBundle(raw: unknown): Result<IncomeBundleWitness> {
  const parsed = incomeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return refuse("InputRejected", `${issue?.path.join(".") || "input"}: ${issue?.message}.`);
  }
  const request = parsed.data;

  const tree = new LedgerTree(request.ledgerLeaves);
  if (tree.root !== request.ledgerRoot) {
    return refuse("UnknownRoot", `The ${tree.size} ledger leaves give root ${tree.root}, not the checked root ${request.ledgerRoot}.`);
  }
  const leafIndex = new Map<bigint, number>();
  request.ledgerLeaves.forEach((leaf, i) => {
    if (!leafIndex.has(leaf)) leafIndex.set(leaf, i);
  });

  const counted: Countable[] = [];
  const skipped: { record: number; reason: SkipReason }[] = [];
  const seenVouch = new Set<number>();
  request.payments.forEach((record, position) => {
    const c = classify(request, tree, leafIndex, record, position);
    if (c.kind === "skipped") skipped.push({ record: position, reason: c.reason });
    else if (seenVouch.has(c.payment.vouchIndex)) skipped.push({ record: position, reason: "duplicate" });
    else {
      seenVouch.add(c.payment.vouchIndex);
      counted.push(c);
    }
  });
  counted.sort((a, b) => a.payment.vouchIndex - b.payment.vouchIndex);

  const range = `leaves ${request.fromIndex}–${request.toIndex}`;
  if (counted.length === 0) return refuse("NoSweptPayments", `No vouched, swept payment in ${range}.`);
  const limit = INCOME_SLOTS * MAX_BUNDLE_PROOFS;
  if (counted.length > limit) {
    return refuse("NotEnoughSlots", `${counted.length} payments in ${range}; one bundle holds ${limit} (${MAX_BUNDLE_PROOFS} proofs of ${INCOME_SLOTS}).`);
  }
  const total = counted.reduce((sum, c) => sum + c.payment.amount, 0n);
  if (total < request.threshold) {
    return refuse("BelowThreshold", `${counted.length} payments in ${range} add up to ${total}, below ${request.threshold}.`);
  }

  const chunks = chunk(counted);
  const ranges = chunkRanges(chunks.map((c) => c.map((x) => x.payment.vouchIndex)), request.fromIndex, request.toIndex);
  const shares = splitThreshold(chunks.map((c) => c.reduce((s, x) => s + x.payment.amount, 0n)), request.threshold);
  const proofs = chunks.map((c, k): IncomeProofWitness => {
    const publicSignals: IncomePublicSignals = {
      ledgerRoot: request.ledgerRoot,
      asset: request.asset,
      threshold: shares[k]!,
      count: BigInt(c.length),
      fromIndex: ranges[k]!.fromIndex,
      toIndex: ranges[k]!.toIndex,
      context: request.context,
    };
    return { publicSignals, input: circuitInput(publicSignals, c.map((x) => x.slot)), counted: c.map((x) => x.payment) };
  });
  return {
    ok: true,
    value: {
      proofs,
      threshold: request.threshold,
      count: BigInt(counted.length),
      counted: counted.map((c) => c.payment),
      skipped,
    },
  };
}
