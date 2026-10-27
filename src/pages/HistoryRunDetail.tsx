/**
 * Phase 15B historical run detail — read-only snapshot view.
 *
 * Renders the recorded run through the same `DiscoveryResults` evidence
 * component the live flow uses (no second source of truth). Review states
 * shown are the handoff-time snapshot; the run-scoped review queue behind the
 * handoff links shows current human decisions. Opening this page performs no
 * source requests and never runs matching. Unknown ids (e.g. after a refresh
 * wiped session history) render an honest not-found state.
 */

import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { findDiscoveryRun } from '../live-source/discovery-run-history'
import { rehydratePersistedReviews } from '../live-source/persisted-runs'
import DiscoveryResults from '../components/discovery/DiscoveryResults'

export default function HistoryRunDetail() {
  const { runId } = useParams<{ runId: string }>()
  const entry = runId !== undefined ? findDiscoveryRun(runId) : undefined
  useEffect(() => {
    if (entry !== undefined) rehydratePersistedReviews([entry.outcome])
  }, [entry !== undefined ? entry.outcome.runId : ''])

  if (entry === undefined) {
    return (
      <section className="page">
        <h1 className="page__title">Run not found</h1>
        <div className="empty" role="alert" data-testid="history-run-missing">
          <p className="empty__headline">No recorded run with ID “{runId ?? ''}”</p>
          <p className="empty__body">
            Run history lives in this session only — a full page refresh or server restart
            removes it. No run was rerun and nothing was guessed.
          </p>
          <p>
            <Link to="/discovery" className="btn">
              Back to run history
            </Link>
          </p>
        </div>
      </section>
    )
  }

  const outcome = entry.outcome
  return (
    <section className="page">
      <nav className="crumbs" aria-label="Back">
        <Link to="/discovery">Discovery</Link> / <Link to="/history">Run History</Link>
      </nav>
      <header className="page__header">
        <h1 className="page__title">
          Run <code className="idbadge">{outcome.runId}</code>
        </h1>
        <p className="page__description">
          Original snapshot from {outcome.requestedAt}
          {entry.demo ? ' — a demo fixture run, not a real discovery.' : ' — a live-source run.'}{' '}
          Review states below are the handoff-time snapshot; follow the review handoff links
          for current human decisions.
        </p>
      </header>
      <DiscoveryResults outcome={outcome} />
    </section>
  )
}
