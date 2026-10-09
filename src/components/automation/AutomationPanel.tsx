/**
 * Discovery status — the automation panel, shown contextually on each
 * workspace overview rather than as a destination of its own.
 *
 * Every figure comes from the running stores or the source registry: the
 * registered source count, the last discovery run recorded in this session,
 * and the candidates currently waiting for a human decision. An empty store
 * says so plainly; nothing here extrapolates, forecasts, or claims a live
 * connection that is not there.
 *
 * "How this works" states the pipeline as a business flow — Source discovery
 * → Classification → Human review → Company matching — so the value of the
 * automation is visible without navigating through implementation stages.
 */

import { Link } from 'react-router-dom'
import { listSources } from '../../data/selectors'

type Domain = 'funding' | 'procurement'

export default function AutomationPanel({ domain }: { domain: Domain }) {
  const sources = listSources()

  return (
    <section className="card automation" aria-label="Discovery status">
      <h2 className="card__title">Discovery status</h2>

      <dl className="automation__facts">
        <div className="automation__fact">
          <dt>Source status</dt>
          <dd>
            <Link to="/sources">{sources.length} registered sources</Link> · TED — Official EU
            procurement source
          </dd>
        </div>
        <div className="automation__fact">
          <dt>Last discovery run</dt>
          <dd>No {domain} discovery runs available</dd>
        </div>
        <div className="automation__fact">
          <dt>Candidates found</dt>
          <dd><Link to="/review">No review candidates available</Link></dd>
        </div>
      </dl>

      <p className="card__foot">
        <Link to="/discovery">Run discovery</Link>
        <span aria-hidden="true"> · </span>
        <Link to="/review">Open the review queue</Link>
      </p>

      <details className="automation__how">
        <summary>How this works</summary>
        <ol className="automation__steps">
          <li>Source discovery</li>
          <li aria-hidden="true">→</li>
          <li>Classification</li>
          <li aria-hidden="true">→</li>
          <li>Human review</li>
          <li aria-hidden="true">→</li>
          <li>Company matching</li>
        </ol>
        <p className="automation__note">
          Registered sources are listed separately. No run or candidate data is currently
          available in this workspace.
        </p>
      </details>
    </section>
  )
}
