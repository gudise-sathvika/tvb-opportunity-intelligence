import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { listDiscoveryRuns } from '../live-source/discovery-run-history'

interface LogEntry {
  id: string
  timestamp: string
  runId: string
  source: string
  severity: 'info' | 'warning' | 'error'
  status: string
  recordsRetrieved: number
  summary: string
  details?: string
  warnings: string[]
  errors: string[]
  retryStatus: string
}

export default function Logs() {
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState<'all' | 'info' | 'warning' | 'error'>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const runs = listDiscoveryRuns()

  const entries: LogEntry[] = useMemo(() => {
    const out: LogEntry[] = []

    runs.forEach((entry, runIdx) => {
      const outcome = entry.outcome
      outcome.companies.forEach((company, compIdx) => {
        company.sourceResults.forEach((source, srcIdx) => {
          const hasErrors = source.errors && source.errors.length > 0
          const hasWarnings = source.warnings && source.warnings.length > 0
          const severity: 'info' | 'warning' | 'error' = hasErrors
            ? 'error'
            : hasWarnings || source.outcome === 'PARTIAL'
              ? 'warning'
              : 'info'

          const sourceName = source.sourceName || source.sourceId || 'Unknown Source'
          const summary = hasErrors
            ? `Source request failed with ${source.errors.length} error(s)`
            : source.outcome === 'NO_RESULTS'
              ? `Completed with 0 matching records`
              : `Successfully retrieved ${source.candidatesReceived} candidate record(s)`

          out.push({
            id: `${outcome.runId}-${compIdx}-${srcIdx}-${runIdx}`,
            timestamp: source.observedAt || outcome.completedAt || outcome.requestedAt,
            runId: outcome.runId,
            source: sourceName,
            severity,
            status: source.outcome,
            recordsRetrieved: source.candidatesReceived,
            summary,
            details: JSON.stringify(
              {
                sourceId: source.sourceId,
                adapterType: source.adapterType,
                accessState: source.accessState,
                domain: source.domain,
                companyId: company.companyId,
                candidatesCreated: source.candidatesCreated,
                duplicates: source.duplicates,
                candidateIds: source.candidateIds,
              },
              null,
              2,
            ),
            warnings: [...(source.warnings || [])],
            errors: [...(source.errors || [])],
            retryStatus: hasErrors ? 'Ready for retry' : 'Not required',
          })
        })
      })
    })

    return out
  }, [runs])

  const sources = useMemo(() => {
    const set = new Set<string>()
    entries.forEach((e) => set.add(e.source))
    return Array.from(set).sort()
  }, [entries])

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (severityFilter !== 'all' && e.severity !== severityFilter) return false
      if (sourceFilter !== 'all' && e.source !== sourceFilter) return false
      if (!q) return true
      return (
        e.runId.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q) ||
        e.summary.toLowerCase().includes(q) ||
        e.status.toLowerCase().includes(q) ||
        e.errors.some((err) => err.toLowerCase().includes(q)) ||
        e.warnings.some((w) => w.toLowerCase().includes(q))
      );
    })
  }, [entries, search, severityFilter, sourceFilter])

  return (
    <section className="page" aria-labelledby="logs-page-heading">
      <header className="page__header">
        <h1 className="page__title" id="logs-page-heading">
          Logs and Execution Details
        </h1>
        <p className="page__description">
          Diagnostic logs from automated discovery runs and source adapters in this browser session.
          Credentials, secrets, and private keys are never recorded or displayed.
        </p>
      </header>

      {/* Overview Stat Cards */}
      <div className="sn-overview-grid">
        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Total Log Events</span>
            <span className="sn-stat-card__icon">📋</span>
          </div>
          <span className="sn-stat-card__value">{entries.length}</span>
          <span className="sn-stat-card__meta">Recorded this session</span>
        </div>
        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Errors</span>
            <span className="sn-stat-card__icon" style={{ color: 'var(--error)' }}>
              ⚠️
            </span>
          </div>
          <span className="sn-stat-card__value" style={{ color: entries.filter((e) => e.severity === 'error').length > 0 ? 'var(--error)' : 'inherit' }}>
            {entries.filter((e) => e.severity === 'error').length}
          </span>
          <span className="sn-stat-card__meta">Failed operations</span>
        </div>
        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Warnings</span>
            <span className="sn-stat-card__icon" style={{ color: 'var(--gold)' }}>
              ⚡
            </span>
          </div>
          <span className="sn-stat-card__value">
            {entries.filter((e) => e.severity === 'warning').length}
          </span>
          <span className="sn-stat-card__meta">Partial or unexpected outcomes</span>
        </div>
        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Sources Monitored</span>
            <span className="sn-stat-card__icon">🌐</span>
          </div>
          <span className="sn-stat-card__value">{sources.length}</span>
          <span className="sn-stat-card__meta">Distinct endpoints</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="sn-toolbar">
        <div className="sn-toolbar__search-group">
          <label htmlFor="log-search" className="visually-hidden">
            Search logs
          </label>
          <input
            id="log-search"
            type="search"
            className="sn-search-input"
            placeholder="Search logs by run ID, source, or message…"
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

        <div className="sn-toolbar__filters">
          <label className="sn-filter-label" htmlFor="severity-select">
            <span className="visually-hidden">Filter by severity</span>
            <select
              id="severity-select"
              className="sn-select"
              aria-label="Filter by severity"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as any)}
            >
              <option value="all">All Severities</option>
              <option value="info">Info only</option>
              <option value="warning">Warnings only</option>
              <option value="error">Errors only</option>
            </select>
          </label>

          {sources.length > 0 ? (
            <label className="sn-filter-label" htmlFor="source-select">
              <span className="visually-hidden">Filter by source</span>
              <select
                id="source-select"
                className="sn-select"
                aria-label="Filter by source"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              >
                <option value="all">All Sources</option>
                {sources.map((src) => (
                  <option key={src} value={src}>
                    {src}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {/* Entries List */}
      {filteredEntries.length === 0 ? (
        <div className="empty" role="status">
          <p className="empty__headline">
            {entries.length === 0
              ? 'No execution logs recorded yet'
              : 'No log events match your search'}
          </p>
          <p className="empty__body">
            {entries.length === 0
              ? 'Logs are generated when you run Discovery or perform automated actions.'
              : 'Try clearing your search keyword or changing the severity filter.'}
          </p>
          {entries.length === 0 ? (
            <p style={{ marginTop: '14px' }}>
              <Link to="/discovery" className="btn btn--primary">
                Go to Discovery
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="sn-logs-list" role="feed" aria-label="Log records">
          {filteredEntries.map((log) => {
            const isExpanded = expandedId === log.id
            const badgeClass =
              log.severity === 'error'
                ? 'sn-tag sn-tag--warn'
                : log.severity === 'warning'
                  ? 'sn-tag sn-tag--warn'
                  : 'sn-tag'

            return (
              <article
                key={log.id}
                className={`sn-log-entry sn-log-entry--${log.severity}`}
                aria-labelledby={`log-title-${log.id}`}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    marginBottom: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={badgeClass}>{log.severity.toUpperCase()}</span>
                    <strong id={`log-title-${log.id}`} style={{ fontSize: '13.5px' }}>
                      {log.source}
                    </strong>
                    <code className="idbadge">{log.runId}</code>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {log.timestamp}
                  </span>
                </div>

                <p style={{ margin: '4px 0 8px', fontSize: '13.5px', color: 'var(--text)' }}>
                  {log.summary}
                </p>

                {log.errors.length > 0 ? (
                  <div
                    style={{
                      background: 'var(--error-bg)',
                      border: '1px solid var(--error-border)',
                      borderRadius: '4px',
                      padding: '8px 12px',
                      marginBottom: '8px',
                      color: 'var(--error-text)',
                      fontSize: '12.5px',
                    }}
                    role="alert"
                  >
                    <strong>Error details:</strong>
                    <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                      {log.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {log.warnings.length > 0 ? (
                  <div
                    style={{
                      background: 'var(--warn-bg)',
                      border: '1px solid var(--warn-border)',
                      borderRadius: '4px',
                      padding: '8px 12px',
                      marginBottom: '8px',
                      color: 'var(--warn-text)',
                      fontSize: '12.5px',
                    }}
                  >
                    <strong>Warnings:</strong>
                    <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                      {log.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: '8px',
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>
                    Records: <strong>{log.recordsRetrieved}</strong> · Status:{' '}
                    <strong>{log.status}</strong> · Retry: <strong>{log.retryStatus}</strong>
                  </span>
                  <button
                    type="button"
                    className="btn btn--sm btn--outline"
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? 'Hide Technical Details' : 'View Technical Details'}
                  </button>
                </div>

                {isExpanded && log.details ? (
                  <pre
                    style={{
                      marginTop: '10px',
                      padding: '10px 14px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '12px',
                      overflowX: 'auto',
                    }}
                  >
                    <code>{log.details}</code>
                  </pre>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
