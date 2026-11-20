// PRD §5: verifyIncomeLink, for a bundle of 1..8 proofs (D12). Pure: the chain reads, the Groth16 check, the
// reader's identity and the clock are injected. The first failing step returns its code.
//
// Why a bundle is sound: every proof counts only V leaves inside its own [fromIndex, toIndex] (circuit), a payment
// has exactly one V leaf (D9), and the ranges are strictly disjoint (step 2b). So no payment is counted by two
// proofs, and Σ thresholds is a lower bound on distinct vouched, swept income. Roots may differ between proofs: the
// tree is append-only, so a leaf index means the same leaf under every known root.
import { PUBLIC_SIGNAL_ORDER } from "../circuit-input.js";
import { type ErrorCode, type ShaidaError, shaidaError } from "../errors.js";
import { TUSD8_FIELD } from "../field.js";
import { contextOf } from "../hash.js";
import { decodeFragment, type Groth16Proof, incomeLinkSchema } from "./link.js";

export interface VerifyDeps {
  /** hash(this reader's id), computed by the caller from the signed-in reader. */
  readonly readerIdHash: bigint;
  /** Unix seconds. */
  readonly now: () => bigint;
  /** ShaidaLedger.isKnownRoot at a pinned block. */
  readonly isKnownRoot: (root: bigint) => Promise<boolean>;
  /** snarkjs groth16.verify with the pinned ceremony vkey (and optionally IncomeVerifier.check). */
  readonly verifyGroth16: (publicSignals: readonly string[], proof: Groth16Proof) => Promise<boolean>;
  /** Block timestamps (unix seconds) of the V leaves bounding the range, from ledger Vouched events; null if unknown. */
  readonly resolveRange: (fromIndex: bigint, toIndex: bigint) => Promise<{ readonly fromDate: bigint; readonly toDate: bigint } | null>;
}

export interface IncomeVerified {
  readonly status: "VALID";
  /** Σ of the proofs' thresholds: the bundle proves at least this much. */
  readonly threshold: bigint;
  readonly count: bigint;
  readonly fromIndex: bigint;
  readonly toIndex: bigint;
  readonly fromDate: bigint;
  readonly toDate: bigint;
  readonly expiry: bigint;
  readonly proofs: number;
}

export type IncomeVerification =
  | IncomeVerified
  | { readonly status: "INVALID"; readonly error: ShaidaError }
  | { readonly status: "INCONCLUSIVE"; readonly error: ShaidaError };

const fail = (code: ErrorCode, message: string): IncomeVerification => {
  const error = shaidaError(code, `${message} Nothing was recorded.`);
  return error.retryable === "yes" ? { status: "INCONCLUSIVE", error } : { status: "INVALID", error };
};

const signal = (signals: readonly string[], name: (typeof PUBLIC_SIGNAL_ORDER)[number]) =>
  BigInt(signals[PUBLIC_SIGNAL_ORDER.indexOf(name)]!);

/** Verifies a link fragment (with or without the leading "#"). */
export async function verifyIncomeLink(fragment: string, deps: VerifyDeps): Promise<IncomeVerification> {
  const decoded = decodeFragment(fragment);
  if (!decoded.ok) return fail("ProofInvalid", `The link is malformed: ${decoded.why}.`);
  return verifyIncomeBundle(decoded.json, deps);
}

/** Verifies an already-decoded link payload (`unknown`: it is checked against the strict schema first). */
export async function verifyIncomeBundle(raw: unknown, deps: VerifyDeps): Promise<IncomeVerification> {
  // 1. strict schema
  const parsed = incomeLinkSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("ProofInvalid", `The link is malformed at ${issue?.path.join(".") || "its root"}: ${issue?.message}.`);
  }
  const link = parsed.data;
  const proofs = link.proofs.map((p, k) => ({
    k,
    ...p,
    asset: signal(p.publicSignals, "asset"),
    context: signal(p.publicSignals, "context"),
    root: signal(p.publicSignals, "ledgerRoot"),
    threshold: signal(p.publicSignals, "threshold"),
    count: signal(p.publicSignals, "count"),
    fromIndex: signal(p.publicSignals, "fromIndex"),
    toIndex: signal(p.publicSignals, "toIndex"),
  }));

  // 2. asset
  const foreign = proofs.find((p) => p.asset !== TUSD8_FIELD);
  if (foreign) return fail("AssetMismatch", `Proof ${foreign.k + 1} is about asset ${foreign.asset}, not tUSD8.`);

  // 2a. one context for the whole bundle (so one reader and one expiry)
  const mixed = proofs.find((p) => p.context !== proofs[0]!.context);
  if (mixed) return fail("MixedContexts", `Proof ${mixed.k + 1} was made for another reader or expiry than proof 1.`);

  // 2b. strictly disjoint leaf ranges (a duplicated proof overlaps itself)
  const byRange = [...proofs].sort((a, b) => (a.fromIndex < b.fromIndex ? -1 : a.fromIndex > b.fromIndex ? 1 : a.k - b.k));
  for (let i = 0; i < byRange.length; i++) {
    const p = byRange[i]!;
    if (p.fromIndex > p.toIndex) return fail("ProofInvalid", `Proof ${p.k + 1} has an empty leaf range.`);
    const next = byRange[i + 1];
    if (next && next.fromIndex <= p.toIndex) {
      return fail(
        "RangesOverlap",
        `Proofs ${p.k + 1} (leaves ${p.fromIndex}–${p.toIndex}) and ${next.k + 1} (leaves ${next.fromIndex}–${next.toIndex}) overlap, so a payment could count twice.`,
      );
    }
  }

  // 3. context opening
  const readerIdHash = BigInt(link.readerIdHash);
  const expiry = BigInt(link.expiry);
  if (contextOf(readerIdHash, expiry, BigInt(link.salt)) !== proofs[0]!.context) {
    return fail("ContextMismatch", "The reader, expiry or salt in the link do not match the proofs.");
  }
  // 4. reader
  if (readerIdHash !== deps.readerIdHash) return fail("WrongReader", "The link was made for another reader.");
  // 5. expiry
  if (deps.now() > expiry) return fail("ProofExpired", `The link expired at ${expiry} (unix seconds).`);

  // 6. every root known on chain
  for (const root of new Set(proofs.map((p) => p.root))) {
    if (!(await deps.isKnownRoot(root))) {
      return fail("UnknownRoot", `Ledger root ${root} is not a known root at the pinned block.`);
    }
  }
  // 7. every proof
  for (const p of proofs) {
    if (!(await deps.verifyGroth16(p.publicSignals, p.proof))) {
      return fail("ProofInvalid", `Proof ${p.k + 1} of ${proofs.length} does not verify.`);
    }
  }
  // 8. dates
  const fromIndex = byRange[0]!.fromIndex;
  const toIndex = byRange.at(-1)!.toIndex;
  const dates = await deps.resolveRange(fromIndex, toIndex);
  if (dates === null) return fail("RangeUnresolvable", `Leaves ${fromIndex}–${toIndex} cannot be mapped to dates yet.`);

  // 9. result
  return {
    status: "VALID",
    threshold: proofs.reduce((s, p) => s + p.threshold, 0n),
    count: proofs.reduce((s, p) => s + p.count, 0n),
    fromIndex,
    toIndex,
    fromDate: dates.fromDate,
    toDate: dates.toDate,
    expiry,
    proofs: proofs.length,
  };
}
