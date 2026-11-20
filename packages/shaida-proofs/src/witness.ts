// Pure witness builder for income.circom: ledger leaves + the recipient's payment records in, the circuit
// input (or a named refusal) out. No network, no clock, no randomness.
import { type CircuitInput, type CircuitSlot, circuitInput, type IncomePublicSignals } from "./circuit-input.js";
import { INCOME_SLOTS } from "./field.js";
import { type Result, shaidaError } from "./errors.js";
import { noteCommitment, nullifierOf, sweepLeaf, vouchLeaf } from "./hash.js";
import { type IncomeRequest, incomeRequestSchema, type PaymentRecord } from "./schema.js";
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

export interface IncomeWitness {
  readonly publicSignals: IncomePublicSignals;
  readonly input: CircuitInput;
  readonly counted: readonly CountedPayment[];
  readonly skipped: readonly { readonly record: number; readonly reason: SkipReason }[];
}

type Classified =
  | { readonly kind: "countable"; readonly payment: CountedPayment; readonly slot: CircuitSlot }
  | { readonly kind: "skipped"; readonly reason: SkipReason };

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

export function buildIncomeWitness(raw: unknown): Result<IncomeWitness> {
  const parsed = incomeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "input";
    return { ok: false, error: shaidaError("InputRejected", `${where}: ${issue?.message}. Nothing was built.`) };
  }
  const request = parsed.data;

  const tree = new LedgerTree(request.ledgerLeaves);
  if (tree.root !== request.ledgerRoot) {
    return {
      ok: false,
      error: shaidaError(
        "UnknownRoot",
        `The ${tree.size} ledger leaves give root ${tree.root}, not the checked root ${request.ledgerRoot}. Nothing was built.`,
      ),
    };
  }
  const leafIndex = new Map<bigint, number>();
  request.ledgerLeaves.forEach((leaf, i) => {
    if (!leafIndex.has(leaf)) leafIndex.set(leaf, i);
  });

  const counted: { payment: CountedPayment; slot: CircuitSlot }[] = [];
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
  if (counted.length === 0) {
    return {
      ok: false,
      error: shaidaError("NoSweptPayments", `No vouched, swept payment in ${range}. Nothing was built.`),
    };
  }
  if (counted.length > INCOME_SLOTS) {
    return {
      ok: false,
      error: shaidaError(
        "NotEnoughSlots",
        `${counted.length} payments in ${range}; one proof holds ${INCOME_SLOTS}. Nothing was built.`,
      ),
    };
  }
  const total = counted.reduce((sum, c) => sum + c.payment.amount, 0n);
  if (total < request.threshold) {
    return {
      ok: false,
      error: shaidaError(
        "BelowThreshold",
        `${counted.length} payments in ${range} add up to ${total}, below ${request.threshold}. Nothing was built.`,
      ),
    };
  }

  const publicSignals: IncomePublicSignals = {
    ledgerRoot: request.ledgerRoot,
    asset: request.asset,
    threshold: request.threshold,
    count: BigInt(counted.length),
    fromIndex: request.fromIndex,
    toIndex: request.toIndex,
    context: request.context,
  };
  const slots = counted.map((c) => c.slot);
  return {
    ok: true,
    value: {
      publicSignals,
      input: circuitInput(publicSignals, slots),
      counted: counted.map((c) => c.payment),
      skipped,
    },
  };
}
