// Strict input schema for the witness builder: callers pass BigInt base units and field elements.
import { z } from "zod";
import { AMOUNT_LIMIT, FIELD_ORDER, MAX_LEAVES, SHARE_STEP, THRESHOLD_LIMIT } from "./field";

const field = z.bigint().nonnegative().lt(FIELD_ORDER);
const nonZeroField = field.refine((v) => v !== 0n, "must be non-zero");
const leafIndex = z.bigint().nonnegative().lt(MAX_LEAVES);

/** What the recipient's browser stores for one received payment and its sweep. Never leaves the browser. */
export const paymentRecordSchema = z
  .object({
    /** Payment note opening (from the Gloam pay memo). */
    secretP: nonZeroField,
    amount: z.bigint().nonnegative().lt(AMOUNT_LIMIT),
    /** From the ledger's public Vouched event for this commitment. */
    payerId: z.bigint().positive().lt(1n << 32n),
    /** Sweep note opening: the recipient's own secret. */
    secretS: nonZeroField,
    amountS: field,
  })
  .strict();

export const incomeRequestSchema = z
  .object({
    /** Every ShaidaLedger leaf in insertion order (V and S, from Vouched/Swept events). */
    ledgerLeaves: z.array(nonZeroField).max(Number(MAX_LEAVES)),
    /** The root the caller checked with ledger.isKnownRoot at a pinned block. */
    ledgerRoot: field,
    asset: field,
    threshold: z.bigint().nonnegative().lt(THRESHOLD_LIMIT),
    fromIndex: leafIndex,
    toIndex: leafIndex,
    context: field,
    payments: z.array(paymentRecordSchema),
    /** Each proof's threshold share is a multiple of this (D13). Default whole tUSD8; coarser steps reveal less. */
    shareStep: z
      .bigint()
      .positive()
      .refine((v) => v % SHARE_STEP === 0n, `must be a multiple of ${SHARE_STEP} (whole tUSD8)`)
      .default(SHARE_STEP),
  })
  .strict()
  .refine((r) => r.fromIndex <= r.toIndex, { message: "fromIndex must be <= toIndex", path: ["toIndex"] })
  // zod still runs this after a failed field check, so guard the division (shareStep 0 is refused above)
  .refine((r) => r.shareStep > 0n && r.threshold % r.shareStep === 0n, {
    message: "must be a multiple of shareStep, since every proof's share is (D13)",
    path: ["threshold"],
  });

export type PaymentRecord = z.infer<typeof paymentRecordSchema>;
export type IncomeRequest = z.infer<typeof incomeRequestSchema>;
