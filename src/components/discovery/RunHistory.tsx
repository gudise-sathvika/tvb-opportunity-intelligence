import type { DiscoveryRunOutcome } from '../../automation/discovery-fixture'
import { COMPANY_STATE_FOR_OUTCOME, DOMAIN_LABEL, OUTCOME_LABEL } from './labels'

/**
 * Recent Discovery Runs (Phase G brief §11). Strictly in-memory for the current
 * page session: run id, domain, company count, candidates found, and outcome.
 * Nothing is persisted.
 */
export default function RunHistory({ runs }: { runs: readonly DiscoveryRunOutcome[] }) {
  return (
    <section className="card dg-panel" aria-label="Recent discovery runs">
      <h2 className="dg-panel__title">Recent Discovery Runs</h2>
      {runs.length === 0 ? (
        <p className="dg-empty">No discovery runs yet in this session. Run a discovery above to see it here.</p>
      ) : (
        <ul className="dg-history">
          {runs.map((run) => (
            <li key={run.runId} className="dg-history__run">
              <code className="idbadge">{run.runId}</code>
              <span>{DOMAIN_LABEL[run.domain]}</span>
              <span>
                {run.companyIds.length} {run.companyIds.length === 1 ? 'company' : 'companies'}
              </span>
              <span>
                {run.counts.candidatesCreated} {run.counts.candidatesCreated === 1 ? 'candidate' : 'candidates'}
              </span>
              <span className={`dg-chip dg-chip--${COMPANY_STATE_FOR_OUTCOME[run.outcome]}`}>
                {OUTCOME_LABEL[run.outcome]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}