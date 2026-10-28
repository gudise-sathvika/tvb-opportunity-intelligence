import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listDiscoveryRuns } from '../live-source/discovery-run-history'
import type { RunHistoryEntry } from '../live-source/discovery-run-history'
import { rehydratePersistedReviews } from '../live-source/persisted-runs'
import { DOMAIN_SUMMARY_LABEL, OUTCOME_LABEL } from '../components/discovery/labels'

function RunRow({
  entry,
  expanded,
  onToggleExpand,
}: {
  entry: RunHistoryEntry
  expanded: boolean
  onToggleExpand(): void
}) {
  const outcome = entry.outcome
  const requestedDate = outcome.requestedAt ? outcome.requestedAt.replace('T', ' ').slice(0, 19) : '—'
  const isDemo = entry.demo

  return (
    <>
      <li className="dg-history__run" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: '10px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <code className="idbadge" style={{ fontWeight: 700 }}>{outcome.runId}</code>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>{DOMAIN_SUMMARY_LABEL[outcome.domain]}</span>
            <span className={outcome.outcome === 'SUCCESS' ? 'sn-tag sn-tag--success' : outcome.outcome === 'PARTIAL' ? 'sn-tag sn-tag--warn' : 'sn-tag'}>
              {OUTCOME_LABEL[outcome.outcome]}
            </span>
            {isDemo ? (
              <span className="dg-chip sn-tag sn-tag--warn">Demo</span>
            ) : (
              <span className="dg-chip sn-tag sn-tag--accent">Live</span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{requestedDate}</span>
            <Link to={`/history/${encodeURIComponent(outcome.runId)}`} className="btn btn--sm btn--primary">
              Open run detail
            </Link>
            <button type="button" className="btn btn--sm btn--outline" onClick={onToggleExpand}>
              {expanded ? 'Hide Details' : 'View Quick Details'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '13px', color: 'var(--text-muted)' }}>
          <span>
            <strong>{outcome.companyIds.length}</strong> {outcome.companyIds.length === 1 ? 'company' : 'companies'} searched
          </span>
          <span>
            <strong>{outcome.counts.candidatesCreated}</strong> {outcome.counts.candidatesCreated === 1 ? 'candidate' : 'candidates'} generated
          </span>
          <span>
            <strong>{outcome.needsReview}</strong> needing review
          </span>
          {outcome.keyword ? (
            <span>
              Keyword: <code>{outcome.keyword}</code>
            </span>
          ) : null}
        </div>

        {expanded ? (
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed var(--border)', fontSize: '12.5px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
              <div>
                <strong>Companies:</strong> {outcome.companyIds.join(', ') || 'None'}
              </div>
              <div>
                <strong>Domain:</strong> {outcome.domain}
              </div>
              <div>
                <strong>Sector Filter:</strong> {outcome.sector}
              </div>
              <div>
                <strong>Location Filter:</strong> {outcome.location}
              </div>
            </div>
            {outcome.companies && outcome.companies.length > 0 ? (
              <div style={{ marginTop: '8px' }}>
                <strong>Source Results:</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                  {(outcome.companies ?? []).flatMap((c) => c.sourceResults ?? []).map((s, i) => (
                    <li key={i}>
                      {s.sourceName || s.sourceId}: {s.outcome} ({s.candidatesReceived} records retrieved, {s.errors?.length ?? 0} errors)
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </li>
    </>
  )
}

export default function History() {
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Restores run-scoped review links for session-restored runs (idempotent).
  useEffect(() => {
    rehydratePersistedReviews(listDiscoveryRuns().map((entry) => entry.outcome))
  }, [])

  const runs = listDiscoveryRuns()

  const filteredRuns = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return runs
    return runs.filter((entry) => {
      const o = entry.outcome
      return (
        o.runId.toLowerCase().includes(q) ||
        o.domain.toLowerCase().includes(q) ||
        o.outcome.toLowerCase().includes(q) ||
        o.companyIds.some((c) => c.toLowerCase().includes(q))
      )
    })
  }, [runs, search])

  const live = filteredRuns.filter((entry) => !entry.demo)
  const demo = filteredRuns.filter((entry) => entry.demo)

  const totalCandidates = runs.reduce((sum, r) => sum + r.outcome.counts.candidatesCreated, 0)

  return (
    <section className="page" aria-labelledby="history-page-heading">
      <header className="page__header">
        <h1 className="page__title" id="history-page-heading">
          Discovery run history
        </h1>
        <p className="page__description">
          Runs recorded in this browser session, kept across reloads in this tab. A server restart or a different tab starts
          empty. Opening a run inspects its original evidence snapshot and never reruns discovery.
        </p>
      </header>

      {/* Summary Stat Cards */}
      <div className="sn-overview-grid">
        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Total Runs</span>
            <span className="sn-stat-card__icon">📊</span>
          </div>
          <span className="sn-stat-card__value">{runs.length}</span>
          <span className="sn-stat-card__meta">All recorded runs</span>
        </div>

        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Live Source Runs</span>
            <span className="sn-stat-card__icon" style={{ color: 'var(--accent)' }}>
              🌐
            </span>
          </div>
          <span className="sn-stat-card__value">{runs.filter((r) => !r.demo).length}</span>
          <span className="sn-stat-card__meta">Production API requests</span>
        </div>

        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Demo Runs</span>
            <span className="sn-stat-card__icon" style={{ color: 'var(--gold)' }}>
              🧪
            </span>
          </div>
          <span className="sn-stat-card__value">{runs.filter((r) => r.demo).length}</span>
          <span className="sn-stat-card__meta">Fixture scenario tests</span>
        </div>

        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Candidates Found</span>
            <span className="sn-stat-card__icon">🎯</span>
          </div>
          <span className="sn-stat-card__value">{totalCandidates}</span>
          <span className="sn-stat-card__meta">Discovered across all runs</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="sn-toolbar">
        <div className="sn-toolbar__search-group">
          <label htmlFor="history-search" className="visually-hidden">
            Search history
          </label>
          <input
            id="history-search"
            type="search"
            className="sn-search-input"
            placeholder="Search runs by ID, company name, or domain…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
          {search ? (
            <button type="button" className="btn btn--clear" onClick={() => setSearch('')}>
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <h2 className="dg-subtitle" style={{ marginTop: '20px' }}>
        Live runs ({live.length})
      </h2>
      {live.length === 0 ? (
        <p className="dg-empty" data-testid="history-empty-live">
          No live discovery runs recorded yet in this session.
        </p>
      ) : (
        <ul className="dg-history" style={{ listStyle: 'none', padding: 0, margin: '10px 0 24px' }}>
          {live.map((entry) => (
            <RunRow
              key={entry.outcome.runId}
              entry={entry}
              expanded={expandedId === entry.outcome.runId}
              onToggleExpand={() => setExpandedId(expandedId === entry.outcome.runId ? null : entry.outcome.runId)}
            />
          ))}
        </ul>
      )}

      <h2 className="dg-subtitle" style={{ marginTop: '24px' }}>
        Demo runs ({demo.length})
      </h2>
      <p className="dg-note" role="note" style={{ margin: '4px 0 12px' }}>
        Fixture runs from explicit demo mode — demonstration data, never real discoveries.
      </p>
      {demo.length === 0 ? (
        <p className="dg-empty" data-testid="history-empty-demo">
          No demo runs recorded yet in this session.
        </p>
      ) : (
        <ul className="dg-history" style={{ listStyle: 'none', padding: 0, margin: '10px 0 24px' }}>
          {demo.map((entry) => (
            <RunRow
              key={entry.outcome.runId}
              entry={entry}
              expanded={expandedId === entry.outcome.runId}
              onToggleExpand={() => setExpandedId(expandedId === entry.outcome.runId ? null : entry.outcome.runId)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
