// Recipient side of an income proof (PRD §3, D27): which of my inbox payments can be counted, the witness request
// for a period, the leaves' block times, and the shared-link record kept in the vault. Pure: block times injected.
import type { CheckedTrees } from "@shaida/index";
import { TUSD8_FIELD, type PaymentRecord, type TimedLeaf } from "@shaida/proofs";
import { z } from "zod";
import type { InboxEntry } from "./inbox-state";
import type { IncomingPayment } from "./recipient";

/** Why one of my payments cannot be counted (statuses for the screen, not errors; D10). */
export type NotCountable =
  | "not-vouched" // no V leaf: paid by an unregistered or revoked wallet, or straight to the pool
  | "not-swept" // still sweepable, or the sweep is not confirmed by an S leaf with my fresh note
  | "swept-elsewhere"; // an S leaf exists for this nullifier but with someone else's note (a clawback)

export interface CountablePayment {
  readonly commitment: string;
  readonly amount: bigint;
  readonly vouchIndex: number;
  readonly sweepIndex: number;
  readonly vouchBlock: bigint;
  readonly record: PaymentRecord;
}

export interface IncomeCandidates {
  readonly countable: readonly CountablePayment[];
  readonly notCountable: readonly { readonly commitment: string; readonly amount: bigint; readonly reason: NotCountable; readonly privateNote: string | null }[];
}

/** Classifies every opened payment against the checked ledger tree and my vault's sweep notes. */
export function incomeCandidates(t: CheckedTrees, payments: readonly IncomingPayment[], inbox: readonly InboxEntry[]): IncomeCandidates {
  const countable: CountablePayment[] = [];
  const notCountable: IncomeCandidates["notCountable"][number][] = [];
  for (const p of payments) {
    const amount = BigInt(p.note.amountWei);
    const skip = (reason: NotCountable) => notCountable.push({ commitment: p.note.commitment, amount, reason, privateNote: p.privateNote });
    const vouch = t.snapshot.ledgerLeaves.find((l) => l.kind === "vouch" && l.commitment === p.note.commitment);
    if (!vouch || vouch.kind !== "vouch") { skip("not-vouched"); continue; }
    const sweep = t.snapshot.ledgerLeaves.find((l) => l.kind === "sweep" && l.nullifier === p.note.nullifier);
    const fresh = inbox.find((e) => e.commitment === p.note.commitment && e.state === "swept")?.fresh ?? null;
    if (!sweep || sweep.kind !== "sweep" || !fresh) { skip(sweep ? "swept-elsewhere" : "not-swept"); continue; }
    if (sweep.sweepCommitment !== fresh.commitment) { skip("swept-elsewhere"); continue; }
    countable.push({
      commitment: p.note.commitment,
      amount,
      vouchIndex: vouch.index,
      sweepIndex: sweep.index,
      vouchBlock: BigInt(vouch.block),
      record: { secretP: BigInt(p.note.secret), amount, payerId: BigInt(vouch.payerId), secretS: BigInt(fresh.secret), amountS: BigInt(fresh.amountWei) },
    });
  }
  countable.sort((a, b) => a.vouchIndex - b.vouchIndex);
  return { countable, notCountable };
}

/** The witness builder's input (src/witness.ts) for a period of the checked ledger tree. */
export function incomeRequestOf(
  t: CheckedTrees,
  countable: readonly CountablePayment[],
  ask: { readonly threshold: bigint; readonly fromIndex: bigint; readonly toIndex: bigint; readonly context: bigint; readonly shareStep: bigint },
) {
  return {
    ledgerLeaves: t.snapshot.ledgerLeaves.map((l) => BigInt(l.leaf)),
    ledgerRoot: t.ledger.root,
    asset: TUSD8_FIELD,
    threshold: ask.threshold,
    fromIndex: ask.fromIndex,
    toIndex: ask.toIndex,
    context: ask.context,
    payments: countable.map((c) => c.record),
    shareStep: ask.shareStep,
  };
}

/** Every ledger leaf with its block time. `blockTime` is called once per distinct block. */
export async function timedLeaves(t: CheckedTrees, blockTime: (block: bigint) => Promise<bigint>): Promise<TimedLeaf[]> {
  const times = new Map<string, Promise<bigint>>();
  const timeOf = (b: string) => {
    let p = times.get(b);
    if (!p) { p = blockTime(BigInt(b)); times.set(b, p); }
    return p;
  };
  return Promise.all(t.snapshot.ledgerLeaves.map(async (l) => ({ index: l.index, time: await timeOf(l.block), vouch: l.kind === "vouch" })));
}

const decimal = z.string().regex(/^(0|[1-9][0-9]{0,30})$/);
const unix = z.number().int().nonnegative();

/** A proof link made in this browser (D27), kept in the vault: the dashboard's "Shared proofs". */
export const sharedLinkSchema = z
  .object({
    fragment: z.string().min(1).max(20_000),
    reader: z.string().min(1).max(200),
    expiry: unix,
    threshold: decimal,
    count: z.number().int().positive(),
    fromDate: unix,
    toDate: unix,
    proofs: z.number().int().min(1).max(8),
    createdAt: unix,
  })
  .strict();
export type SharedLink = z.output<typeof sharedLinkSchema>;
