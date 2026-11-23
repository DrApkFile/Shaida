"use client";
// Who the proof is for (D31): sets the wording and a suggested reader. The proof itself is the same for every choice.
import { TEMPLATE_IDS, TEMPLATES, type TemplateId } from "@/lib/templates";

export function TemplatePicker({ chosen, onChoose }: { chosen: TemplateId; onChoose: (id: TemplateId) => void }) {
  return (
    <div className="stack tight">
      <span className="fine">Who is it for?</span>
      <div className="net-switch policy-switch" role="radiogroup" aria-label="Template">
        {TEMPLATE_IDS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={id === chosen} onClick={() => onChoose(id)}>{TEMPLATES[id].label}</button>
        ))}
      </div>
      <span className="fine">Changes the words the reader sees and suggests a reader. The proof and what it shows are the same.</span>
    </div>
  );
}
