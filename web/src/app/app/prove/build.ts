"use client";
// Builds a proof link (PRD §5, D27): reader id → leaf range → witness bundle → one fresh worker per proof → link →
// the same verification the reader runs, here, before the link is shown. Note secrets stay in this tab and its workers.
import type { CheckedTrees } from "@shaida/index";
import { incomeRequestOf, type CountablePayment, type SharedLink } from "@shaida/pay";
import {
  buildIncomeBundle, contextOf, encodeIncomeLink, leafRangeForPeriod, readerIdHashOf, verifyIncomeLink,
  shaidaError, type IncomeLink, type Result, type TimedLeaf,
} from "@shaida/proofs";
import type { Wiring } from "@/lib/flows";
import { verifyDepsFor } from "@/lib/income/chain";
import { incomeArtifacts, proveInFreshWorker } from "@/lib/income/prover";

export interface ProveAsk {
  readonly reader: string;
  /** Unix seconds, inclusive. */
  readonly start: bigint;
  readonly end: bigint;
  readonly threshold: bigint;
  readonly step: bigint;
  readonly expiry: bigint;
}

export type Stage = { readonly done: number; readonly total: number; readonly label: string };

export interface Built {
  readonly fragment: string;
  readonly shared: SharedLink;
  readonly proveMs: readonly number[];
}

/** A random salt below 2^248 (31 bytes), so the context reveals nothing about reader or expiry. */
function randomSalt(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(31));
  return b.reduce((v, x) => (v << 8n) | BigInt(x), 0n);
}

export async function buildLink(w: Wiring, t: CheckedTrees, leaves: readonly TimedLeaf[], countable: readonly CountablePayment[], ask: ProveAsk, progress: (s: Stage) => void): Promise<Result<Built>> {
  const reader = readerIdHashOf(ask.reader);
  if (!reader.ok) return reader;
  const range = leafRangeForPeriod(leaves, ask.start, ask.end);
  if (!range.ok) return range;
  const salt = randomSalt();
  const context = contextOf(reader.value, ask.expiry, salt);

  progress({ done: 0, total: 3, label: "Checking the final key's files" });
  const a = await incomeArtifacts();
  if (!a.ok) return a;

  progress({ done: 1, total: 3, label: "Building the witness" });
  const bundle = buildIncomeBundle(incomeRequestOf(t, countable, { threshold: ask.threshold, fromIndex: range.value.fromIndex, toIndex: range.value.toIndex, context, shareStep: ask.step }));
  if (!bundle.ok) return bundle;
  const n = bundle.value.proofs.length;
  const total = 3 + n;

  const proofs: IncomeLink["proofs"] = [];
  const proveMs: number[] = [];
  for (const [k, p] of bundle.value.proofs.entries()) {
    progress({ done: 2 + k, total, label: `Proving ${k + 1} of ${n} (in its own worker)` });
    const r = await proveInFreshWorker(a.value, p.input);
    if (!r.ok) return { ok: false, error: shaidaError("ProofInvalid", r.message) };
    proofs.push({ proof: r.proof, publicSignals: r.publicSignals });
    proveMs.push(r.proveMs);
  }

  progress({ done: 2 + n, total, label: "Checking the link as the reader will" });
  const fragment = encodeIncomeLink({ v: 1, proofs, readerIdHash: reader.value.toString(), expiry: ask.expiry.toString(), salt: salt.toString() });
  const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
  const v = await verifyIncomeLink(fragment, verifyDepsFor(w, t, leaves, reader.value, nowSec));
  if (v.status !== "VALID") return { ok: false, error: v.error };
  progress({ done: total, total, label: "Done" });

  return {
    ok: true,
    value: {
      fragment,
      proveMs,
      shared: {
        fragment,
        reader: ask.reader.normalize("NFC").trim().replace(/\s+/gu, " "),
        expiry: Number(v.expiry),
        threshold: v.threshold.toString(),
        count: Number(v.count),
        fromDate: Number(v.fromDate),
        toDate: Number(v.toDate),
        proofs: v.proofs,
        createdAt: Number(nowSec()),
      },
    },
  };
}
