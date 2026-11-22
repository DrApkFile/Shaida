"use client";
// Browser proving for income proofs (D27): the final artifacts are fetched once and checked against the pins, then
// each proof runs in a fresh Web Worker that is terminated after it answers.
import { loadIncomeArtifacts, type IncomeArtifacts } from "@shaida/pay";
import { INCOME_FINAL_VKEY, type CircuitInput, type Result } from "@shaida/proofs";
import type { ProveReply, ProveRequest } from "@/workers/income-prover.worker";

export const INCOME_BASE = "/circuits/income";

const fetchBytes = async (url: string) => {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.arrayBuffer();
};

let artifacts: Promise<Result<IncomeArtifacts>> | null = null;
/** The checked final wasm and zkey. A failed load is not kept, so the next try fetches again. */
export function incomeArtifacts(): Promise<Result<IncomeArtifacts>> {
  if (!artifacts) {
    const p = loadIncomeArtifacts(INCOME_BASE, fetchBytes, (b) => crypto.subtle.digest("SHA-256", b));
    artifacts = p;
    void p.then((r) => { if (!r.ok) artifacts = null; });
  }
  return artifacts;
}

/** Proves one witness in a new worker; the worker verifies with the final vkey before answering. */
export function proveInFreshWorker(a: IncomeArtifacts, input: CircuitInput): Promise<ProveReply> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("../../workers/income-prover.worker.ts", import.meta.url), { type: "module" });
    const done = (r: ProveReply) => { worker.terminate(); resolve(r); };
    worker.onmessage = (e: MessageEvent<ProveReply>) => done(e.data);
    worker.onerror = (e) => done({ ok: false, message: `The proving worker failed: ${e.message || "no message"}. No link was made.` });
    const req: ProveRequest = { wasm: a.wasm, zkey: a.zkey, input, vkey: INCOME_FINAL_VKEY };
    worker.postMessage(req);
  });
}
