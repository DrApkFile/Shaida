import type { Problem } from "@/lib/problem";
import { codeLabel } from "@/lib/problem";

export function ProblemBox({ problem }: { problem: Problem | null }) {
  if (!problem) return null;
  const unknown = problem.code === "TxOutcomeUnknown";
  return (
    <div className={`notice ${unknown ? "warn" : "bad"}`} role="alert">
      <strong className="mono">{codeLabel(problem.code)}</strong> {problem.message}
      {problem.nextAction && <div className="fine">Next: {problem.nextAction}</div>}
    </div>
  );
}
