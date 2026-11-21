export type StepState = "todo" | "active" | "done" | "failed" | "unknown";
export interface Step { readonly title: string; readonly detail: string; readonly state: StepState }

const WORD: Record<StepState, string> = { todo: "", active: "working", done: "done", failed: "stopped", unknown: "unknown: checking" };

export function StepList({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="steps">
      {steps.map((s) => (
        <li key={s.title} className={`step ${s.state}`}>
          <span className="step-dot" aria-hidden="true" />
          <div className="step-body">
            <div className="step-top">
              <span className="step-title">{s.title}</span>
              {WORD[s.state] && <span className="step-state">{WORD[s.state]}</span>}
            </div>
            <div className="step-who">{s.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
