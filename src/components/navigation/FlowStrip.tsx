/**
 * A compact business-flow strip: the steps of a workflow as navigation.
 *
 * Each step is a real link where a page exists, so the flow answers "what
 * happens next?" without exposing the automation architecture. Steps are
 * labels, not headings, so the strip never disturbs the page's heading
 * hierarchy.
 */

import { Link } from 'react-router-dom'

export interface FlowStep {
  label: string
  to: string
}

export default function FlowStrip({ label, steps }: { label: string; steps: FlowStep[] }) {
  return (
    <nav className="flow" aria-label={label}>
      <ol className="flow__list">
        {steps.map((step, i) => (
          <li key={step.label} className="flow__item">
            {i > 0 ? (
              <span className="flow__sep" aria-hidden="true">
                →
              </span>
            ) : null}
            <Link to={step.to} className="flow__step">
              {step.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  )
}
