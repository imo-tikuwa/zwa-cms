import { Fragment, ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export type FlowStep = { icon: ReactNode; title: string; sub: string; accent?: boolean };

/** Numbered steps in a row, with arrows between them. */
export function Flow({ steps }: { steps: FlowStep[] }) {
  return (
    <ol className="flow">
      {steps.map((step, i) => (
        <Fragment key={step.title}>
          {i > 0 && (
            <li className="flow-arrow" aria-hidden>
              <ChevronRight size={18} />
            </li>
          )}
          <li className={step.accent ? "flow-step flow-accent" : "flow-step"}>
            <span className="flow-num">{i + 1}</span>
            <span className="flow-icon">{step.icon}</span>
            <span className="flow-title">{step.title}</span>
            <span className="flow-sub">{step.sub}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
