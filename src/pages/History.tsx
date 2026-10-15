/**
 * Phase 15B Discovery run history — read-only browser over recorded runs.
 *
 * Lists every run recorded in this session (live and demo, newest first, demo
 * runs explicitly badged and grouped separately so fixtures are never
 * presented as real history). Opening a run navigates to its read-only detail
 * page; nothing here reruns discovery or contacts any source.
 */

import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { listDiscoveryRuns } from '../live-source/discovery-run-history'
import type { RunHistoryEntry } from '../live-source/discovery-run-history'
import { rehydratePersistedReviews } from '../live-source/persisted-runs'
import { DOMAIN_SUMMARY_LABEL, OUTCOME_LABEL } from '../components/discovery/labels'

function RunRow({ entry }: { entry: RunHistoryEntry }) {
  const outcome = entry.outcome
  return (
    <li className="dg-history__run">
      <code className="idbadge">{outcome.runId}</code>
      <span>{DOMAIN_SUMMARY_LABEL[outcome.domain]}</span>
      <span>
        {outcome.companyIds.length} {outcome.companyIds.length === 1 ? 'company' : 'companies'}
      </span>
      <span>
        {outcome.counts.candidatesCreated} {outcome.counts.candidatesCreated === 1 ? 'candidate' : 'candidates'}
      </span>
      <span className="dg-chip">{OUTCOME_LABEL[outcome.outcome]}</span>
      {entry.demo ? <span className="dg-chip">Demo</span> : <span className="dg-chip">Live</span>}
      <Link to={`/history/${encodeURIComponent(outcome.runId)}`}>Open run detail</Link>
    </li>
  )
}

export default function History() {
  // Restores run-scoped review links for session-restored runs (idempotent).
  useEffect(() => {
    rehydratePersistedReviews(listDiscoveryRuns().map((entry) => entry.outcome))
  }, [])
  const runs = listDiscoveryRuns()
  const live = runs.filter((entry) => !entry.demo)
  const demo = runs.filter((entry) => entry.demo)

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Discovery run history</h1>
        <p className="page__description">
          Runs recorded in this browser session, kept across reloads in this tab. A server
          restart or a different tab starts empty, and human decisions made before a reload
          are not restored. Opening a run never reruns discovery.
        </p>
      </header>

      <h2 className="dg-subtitle">Live runs ({live.length})</h2>
      {live.length === 0 ? (
        <p className="dg-empty" data-testid="history-empty-live">
          No live discovery runs recorded yet in this session.
        </p>
      ) : (
        <ul className="dg-history">
          {live.map((entry) => (
            <RunRow key={entry.outcome.runId} entry={entry} />
          ))}
        </ul>
      )}

      <h2 className="dg-subtitle">Demo runs ({demo.length})</h2>
      <p className="dg-note" role="note">
        Fixture runs from explicit demo mode — demonstration data, never real discoveries.
      </p>
      {demo.length === 0 ? (
        <p className="dg-empty" data-testid="history-empty-demo">
          No demo runs recorded yet in this session.
        </p>
      ) : (
        <ul className="dg-history">
          {demo.map((entry) => (
            <RunRow key={entry.outcome.runId} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  )
}
