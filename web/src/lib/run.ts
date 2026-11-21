"use client";
// A multi-step flow on screen: which step is running, what stopped it, and an unknown outcome's request id
// (checked by its record, never re-sent).
import { useCallback, useState } from "react";
import type { RelayRecord } from "@shaida/pay";
import type { Result } from "@shaida/proofs";
import type { Step, StepState } from "@/components/StepList";
import type { Problem } from "./problem";

export class Stop extends Error {
  constructor(readonly problem: Problem, readonly unknownRequest: string | null = null) { super(problem.message); }
}

export interface Run {
  steps: Step[];
  problem: Problem | null;
  unknownRequest: string | null;
  busy: boolean;
  start(titles: readonly { title: string; detail: string }[], body: (at: (i: number) => void) => Promise<void>): Promise<void>;
  setProblem(p: Problem | null): void;
}

export function useRun(): Run {
  const [steps, setSteps] = useState<Step[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [unknownRequest, setUnknown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = useCallback<Run["start"]>(async (titles, body) => {
    let current = -1;
    const paint = (upTo: number, last: StepState) =>
      setSteps(titles.map((t, i) => ({ ...t, state: i < upTo ? "done" : i === upTo ? last : "todo" })));
    const at = (i: number) => { current = i; paint(i, "active"); };
    setBusy(true); setProblem(null); setUnknown(null);
    try {
      await body(at);
      paint(titles.length, "done");
    } catch (e) {
      const stop = e instanceof Stop ? e : new Stop({ code: "TxRejected", message: `Stopped unexpectedly: ${e instanceof Error ? e.message : String(e)}. Check the steps above before trying again.` });
      paint(current, stop.unknownRequest ? "unknown" : "failed");
      setProblem(stop.problem);
      setUnknown(stop.unknownRequest);
    } finally {
      setBusy(false);
    }
  }, []);
  return { steps, problem, unknownRequest, busy, start, setProblem };
}

/** Unwraps a Result or stops the run with its error. */
export function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Stop(r.error);
  return r.value;
}

/** A settled relay record must be mined and not reverted; unknown stops with its id so it can be checked. */
export function minedOrStop(r: Result<RelayRecord>, requestId?: string): RelayRecord {
  if (!r.ok) throw new Stop(r.error, r.error.code === "TxOutcomeUnknown" ? (requestId ?? null) : null);
  const rec = r.value;
  if (rec.state === "mined" && !rec.reverted) return rec;
  if (rec.state === "unknown" || rec.state === "accepted" || rec.state === "pending") {
    throw new Stop({ code: "TxOutcomeUnknown", message: `Sent as ${rec.hash.slice(0, 10)}…, not confirmed yet. It is checked by its hash and never sent again.` }, rec.requestId);
  }
  throw new Stop(rec.error ?? { code: "TxRejected", message: "The transaction did not go through. Nothing changed." });
}
