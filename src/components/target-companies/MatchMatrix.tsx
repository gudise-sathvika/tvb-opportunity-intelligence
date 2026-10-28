import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { OpportunityAssessmentGroup } from '../../target-companies/live-discovery'
import type { TargetRelevanceResult } from '../../target-companies/matching'
import {
  buildMatrixRows,
  extractDistinctCompanies,
  outcomeBadgeClass,
  outcomeLabel,
} from './match-matrix-model'
import type { MatrixRowData } from './match-matrix-model'

export interface MatchMatrixProps {
  readonly opportunityGroups: readonly OpportunityAssessmentGroup[]
  readonly allCompanies?: readonly string[]
  readonly className?: string
}

export default function MatchMatrix({
  opportunityGroups,
  allCompanies: providedCompanies,
  className = '',
}: MatchMatrixProps) {
  // 1. Extract all available companies from groups if not explicitly provided
  const availableCompanies = useMemo(() => {
    if (providedCompanies && providedCompanies.length > 0) {
      return [...providedCompanies].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    }
    return extractDistinctCompanies(opportunityGroups)
  }, [providedCompanies, opportunityGroups])

  // 2. State for filters, sorting, search, column visibility, and pagination
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'funding' | 'procurement'>('all')
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [companyFilter, setCompanyFilter] = useState<string>('all')

  // Column visibility
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>(availableCompanies)
  const [showColumnPicker, setShowColumnPicker] = useState(false)

  // Sync selected companies if availableCompanies changes
  useEffect(() => {
    setSelectedCompanies((prev) => {
      const valid = prev.filter((c) => availableCompanies.includes(c))
      return valid.length > 0 ? valid : availableCompanies
    })
  }, [availableCompanies])

  // Sorting
  const [sortBy, setSortBy] = useState<string>('best_match')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  // Pagination
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  // Modals for deep inspection
  const [activeAssessment, setActiveAssessment] = useState<{
    assessment: TargetRelevanceResult
    opportunityTitle: string
    source: string
  } | null>(null)

  const [activeOpportunity, setActiveOpportunity] = useState<MatrixRowData | null>(null)

  // Available sources
  const availableSources = useMemo(() => {
    const set = new Set<string>()
    opportunityGroups.forEach((g) => {
      if (g.source) set.add(g.source)
    })
    return [...set].sort()
  }, [opportunityGroups])

  // 3. Build Matrix Rows (pure calculation with filtering & sorting)
  const allRows = useMemo(() => {
    return buildMatrixRows(opportunityGroups, availableCompanies, {
      search,
      typeFilter,
      outcomeFilter,
      sourceFilter,
      companyFilter,
      visibleCompanies: selectedCompanies,
      sortBy,
      sortDirection,
    })
  }, [
    opportunityGroups,
    availableCompanies,
    selectedCompanies,
    search,
    typeFilter,
    outcomeFilter,
    sourceFilter,
    companyFilter,
    sortBy,
    sortDirection,
  ])

  // Reset page when filters change
  useEffect(() => {
    setPage(0)
  }, [search, typeFilter, outcomeFilter, sourceFilter, companyFilter, sortBy, sortDirection, pageSize])

  // 4. Paginate rows
  const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const paginatedRows = allRows.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const rangeStart = allRows.length === 0 ? 0 : safePage * pageSize + 1
  const rangeEnd = Math.min((safePage + 1) * pageSize, allRows.length)

  // Toggle company column sort
  const handleCompanyHeaderClick = (companyName: string) => {
    const key = `company:${companyName}`
    if (sortBy === key) {
      if (sortDirection === 'desc') {
        setSortDirection('asc')
      } else {
        // Reset to best match
        setSortBy('best_match')
        setSortDirection('desc')
      }
    } else {
      setSortBy(key)
      setSortDirection('desc')
    }
  }

  // Column visibility helpers
  const toggleCompanyVisibility = (company: string) => {
    setSelectedCompanies((prev) => {
      if (prev.includes(company)) {
        if (prev.length <= 1) return prev // Keep at least one
        return prev.filter((c) => c !== company)
      }
      return [...prev, company].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    })
  }

  const selectAllCompanies = () => {
    setSelectedCompanies(availableCompanies)
  }

  const clearFilters = () => {
    setSearch('')
    setTypeFilter('all')
    setOutcomeFilter('all')
    setSourceFilter('all')
    setCompanyFilter('all')
    setSortBy('best_match')
    setSortDirection('desc')
  }

  // Close modals on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveAssessment(null)
        setActiveOpportunity(null)
        setShowColumnPicker(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 5. Empty state if no groups exist
  if (opportunityGroups.length === 0) {
    return (
      <div className={`sn-matrix-container ${className}`} style={{ padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '36px', marginBottom: '12px' }}>📊</div>
        <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text)', margin: '0 0 8px' }}>
          No Opportunity Assessments Available
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', maxWidth: '520px', margin: '0 auto' }}>
          Upload a target company CSV profile and run discovery to generate topical suitability scores and populate the match matrix.
        </p>
      </div>
    )
  }

  return (
    <div className={`sn-matrix-container ${className}`}>
      {/* Scoring Guide & Legend */}
      <div className="sn-matrix-legend" role="region" aria-label="Match Scoring Legend">
        <div className="sn-matrix-legend__header">
          <div>
            <span className="sn-matrix-legend__title">Match Percentage Matrix</span>
            <span className="sn-matrix-legend__subtitle">
              Interactive Company × Opportunity Suitability Comparison
            </span>
          </div>
          <span className="sn-tag sn-tag--accent">System Scoring Model</span>
        </div>

        <div className="sn-matrix-legend__grid">
          <div className="sn-matrix-legend__item">
            <strong>Percentage Metric:</strong>
            <span>
              Derived directly from topical &amp; capability alignment rules. <em>Not</em> a probability of grant or tender award.
            </span>
          </div>
          <div className="sn-matrix-legend__item">
            <strong>Relevance ≠ Eligibility:</strong>
            <span>
              High topical relevance does not guarantee legal eligibility or administrative approval.
            </span>
          </div>
          <div className="sn-matrix-legend__item">
            <strong>Missing Scores (—):</strong>
            <span>
              Unassessed or missing criteria remain visibly unknown (—), never fabricated or defaulted to 0%.
            </span>
          </div>
          <div className="sn-matrix-legend__item">
            <strong>Human Decision Boundary:</strong>
            <span>
              Scores are decision-support signals. Formal pursuit requires human approval in the Review Queue.
            </span>
          </div>
        </div>

        <div className="sn-matrix-legend__badges">
          <span className="sn-tag sn-tag--success" title="Evaluation score >= 70%">● Relevant (&ge; 70%)</span>
          <span className="sn-tag sn-tag--warn" title="Evaluation score 40–69%">● Potentially Relevant (40–69%)</span>
          <span className="sn-tag sn-tag--muted" title="Evaluation score < 40%">● Not Relevant (&lt; 40%)</span>
          <span className="sn-tag sn-tag--accent" title="Highest scoring company for the opportunity">★ Top Match (Row Peak)</span>
          <span className="sn-tag" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>— Unassessed / Unknown</span>
        </div>
      </div>

      {/* Matrix Toolbar & Filters */}
      <div className="sn-toolbar sn-matrix-toolbar">
        {/* Search */}
        <div className="sn-toolbar__search-group">
          <label htmlFor="matrix-search" className="visually-hidden">
            Search opportunities
          </label>
          <input
            id="matrix-search"
            type="search"
            className="sn-search-input"
            placeholder="Search opportunity title, source, or reasons…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search opportunities in matrix"
            autoComplete="off"
          />
          {search ? (
            <button type="button" className="btn btn--clear" onClick={() => setSearch('')}>
              Clear
            </button>
          ) : null}
        </div>

        {/* Filters */}
        <div className="sn-toolbar__filters">
          {/* Category */}
          <label htmlFor="matrix-type-filter" className="sn-filter-label">
            <span className="visually-hidden">Filter category</span>
            <select
              id="matrix-type-filter"
              className="sn-select"
              aria-label="Filter category"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
            >
              <option value="all">All Categories</option>
              <option value="funding">Funding calls</option>
              <option value="procurement">Procurement tenders</option>
            </select>
          </label>

          {/* Outcome Filter */}
          <label htmlFor="matrix-outcome-filter" className="sn-filter-label">
            <span className="visually-hidden">Filter outcome</span>
            <select
              id="matrix-outcome-filter"
              className="sn-select"
              aria-label="Filter outcome"
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
            >
              <option value="all">All Outcomes</option>
              <option value="relevant">Relevant</option>
              <option value="potentially_relevant">Potentially relevant</option>
              <option value="not_relevant">Not relevant</option>
            </select>
          </label>

          {/* Source Filter */}
          {availableSources.length > 1 ? (
            <label htmlFor="matrix-source-filter" className="sn-filter-label">
              <span className="visually-hidden">Filter source</span>
              <select
                id="matrix-source-filter"
                className="sn-select"
                aria-label="Filter source"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              >
                <option value="all">All Sources</option>
                {availableSources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {/* Company Filter (Row Filter) */}
          {availableCompanies.length > 1 ? (
            <label htmlFor="matrix-company-filter" className="sn-filter-label">
              <span className="visually-hidden">Filter by company</span>
              <select
                id="matrix-company-filter"
                className="sn-select"
                aria-label="Filter by company"
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
              >
                <option value="all">All Companies</option>
                {availableCompanies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {/* Column Visibility Selector */}
          <div className="sn-column-picker-anchor" style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn btn--sm btn--outline"
              aria-expanded={showColumnPicker}
              onClick={() => setShowColumnPicker((prev) => !prev)}
              title="Select which company columns appear in the comparison table"
            >
              Columns: {selectedCompanies.length} of {availableCompanies.length} ▼
            </button>

            {showColumnPicker ? (
              <div
                className="sn-column-picker-popover"
                role="dialog"
                aria-label="Select visible company columns"
              >
                <div className="sn-column-picker-header">
                  <strong>Visible Companies</strong>
                  <button
                    type="button"
                    className="btn btn--sm btn--clear"
                    onClick={() => setShowColumnPicker(false)}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <button
                    type="button"
                    className="btn btn--sm btn--outline"
                    onClick={selectAllCompanies}
                    style={{ flex: 1 }}
                  >
                    Select All
                  </button>
                </div>
                <div className="sn-column-picker-list">
                  {availableCompanies.map((c) => {
                    const checked = selectedCompanies.includes(c)
                    return (
                      <label key={c} className="sn-column-picker-item">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCompanyVisibility(c)}
                        />
                        <span>{c}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {/* Sort Selector */}
          <label htmlFor="matrix-sort" className="sn-filter-label">
            <span className="visually-hidden">Sort matrix opportunities</span>
            <select
              id="matrix-sort"
              className="sn-select"
              aria-label="Sort matrix opportunities"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="best_match">Sort by Best Match</option>
              <option value="lowest_match">Sort by Lowest Match</option>
              <option value="title">Sort by Title (A–Z)</option>
              <option value="deadline">Sort by Deadline</option>
              {availableCompanies.map((c) => (
                <option key={c} value={`company:${c}`}>
                  Sort by {c} Match
                </option>
              ))}
            </select>
          </label>

          {/* Rows per page filter matching Companies table */}
          <label htmlFor="matrix-page-size-toolbar" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
            <span>Rows:</span>
            <select
              id="matrix-page-size-toolbar"
              className="sn-select"
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(0)
              }}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </label>

          {(search || typeFilter !== 'all' || outcomeFilter !== 'all' || sourceFilter !== 'all' || companyFilter !== 'all') ? (
            <button type="button" className="btn btn--sm btn--outline" onClick={clearFilters}>
              Clear Filters
            </button>
          ) : null}
        </div>
      </div>

      {/* Main Table or Filtered Empty State */}
      {paginatedRows.length === 0 ? (
        <div className="dg-empty" role="status" style={{ margin: '24px 0', padding: '32px 16px', textAlign: 'center' }}>
          <p style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '8px' }}>
            No opportunities match the current filter and search criteria.
          </p>
          <button type="button" className="btn btn--outline" onClick={clearFilters}>
            Clear Filters &amp; Reset
          </button>
        </div>
      ) : (
        <div className="sn-matrix-table-wrap" tabIndex={0} aria-label="Company Opportunity Match Matrix Scroll Area">
          <table className="sn-matrix-table" aria-label="Company by Opportunity Match Matrix">
            <caption className="visually-hidden">
              Comparison table of opportunities across {selectedCompanies.length} target companies.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sn-matrix-th--sticky">
                  Opportunity Details
                </th>
                {selectedCompanies.map((company) => {
                  const isSorted = sortBy === `company:${company}`
                  return (
                    <th
                      key={company}
                      scope="col"
                      className={`sn-matrix-th--company ${isSorted ? 'sn-matrix-th--sorted' : ''}`}
                      onClick={() => handleCompanyHeaderClick(company)}
                      title={`Click to sort opportunities by ${company}'s match percentage`}
                      tabIndex={0}
                      role="button"
                      aria-sort={isSorted ? (sortDirection === 'desc' ? 'descending' : 'ascending') : 'none'}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleCompanyHeaderClick(company)
                        }
                      }}
                    >
                      <div className="sn-matrix-th__content">
                        <span className="sn-matrix-th__name">{company}</span>
                        <span className="sn-matrix-th__sort-icon" aria-hidden="true">
                          {isSorted ? (sortDirection === 'desc' ? '▼' : '▲') : '⇅'}
                        </span>
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row) => {
                return (
                  <tr key={row.key} className="sn-matrix-row">
                    {/* Sticky Opportunity Column */}
                    <td className="sn-matrix-td--sticky">
                      <div className="sn-matrix-opp-cell">
                        <button
                          type="button"
                          className="sn-matrix-opp-title-btn"
                          onClick={() => setActiveOpportunity(row)}
                          title="Click to view full opportunity details & review handoff"
                        >
                          {row.opportunityTitle}
                        </button>

                        <div className="sn-matrix-opp-meta">
                          <span className="sn-tag sn-tag--accent">
                            {row.opportunityType === 'procurement' ? 'Procurement' : 'Funding'}
                          </span>
                          <span className="sn-tag">{row.source}</span>
                          {row.deadline ? (
                            <span className="sn-matrix-opp-deadline" title="Submission deadline">
                              📅 {row.deadline}
                            </span>
                          ) : null}
                          {row.highestScore !== null && row.highestScore > 0 ? (
                            <span className="sn-tag sn-tag--success" title="Highest suitability score across visible companies">
                              Peak: {Math.round(row.highestScore <= 1 ? row.highestScore * 100 : row.highestScore)}%
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    {/* Company Match Score Cells */}
                    {selectedCompanies.map((company) => {
                      const cell = row.cellMap.get(company.toLowerCase())
                      const assessment = cell?.assessment ?? null
                      const score = cell?.score ?? null
                      const pctDisplay = cell?.formattedPercentage ?? '—'
                      const outcome = cell?.outcome ?? null
                      const isTop = cell?.isTopMatch ?? false
                      const badgeModifier = outcomeBadgeClass(outcome)
                      const label = outcomeLabel(outcome)

                      // Percentage bar fill color
                      const barClass =
                        score === null
                          ? ''
                          : score >= 0.7
                            ? 'sn-matrix-bar--success'
                            : score >= 0.4
                              ? 'sn-matrix-bar--warn'
                              : 'sn-matrix-bar--muted'

                      return (
                        <td
                          key={company}
                          className={`sn-matrix-td--cell ${isTop ? 'sn-matrix-td--top' : ''}`}
                        >
                          {assessment ? (
                            <button
                              type="button"
                              className={`sn-matrix-cell-btn ${isTop ? 'sn-matrix-cell-btn--top' : ''}`}
                              onClick={() =>
                                setActiveAssessment({
                                  assessment,
                                  opportunityTitle: row.opportunityTitle,
                                  source: row.source,
                                })
                              }
                              aria-label={`${company}: ${pctDisplay} match (${label}) for ${row.opportunityTitle}. Click to view assessment rationale.`}
                              title={`${company}: ${pctDisplay} match (${label}) — Click to view rationale`}
                            >
                              <div className="sn-matrix-cell__top-row">
                                <span className="sn-matrix-cell__pct">{pctDisplay}</span>
                                {isTop ? (
                                  <span className="sn-matrix-top-badge" title="Highest scoring company for this opportunity">
                                    ★ Top
                                  </span>
                                ) : null}
                              </div>

                              {score !== null ? (
                                <div className="sn-matrix-bar-track" aria-hidden="true">
                                  <div
                                    className={`sn-matrix-bar-fill ${barClass}`}
                                    style={{
                                      width: `${Math.min(100, Math.max(0, score <= 1 ? Math.round(score * 100) : Math.round(score)))}%`,
                                    }}
                                  />
                                </div>
                              ) : null}

                              {outcome ? (
                                <span className={`sn-tag sn-tag--xs ${badgeModifier}`}>
                                  {label}
                                </span>
                              ) : null}
                            </button>
                          ) : (
                            <div className="sn-matrix-cell--empty" title="No assessment evaluated for this company">
                              <span className="sn-matrix-cell__pct sn-matrix-cell__pct--empty">—</span>
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination & Range Bar */}
      <div className="listbar sn-matrix-pagination" style={{ marginTop: '16px' }}>
        <div className="listbar__counts">
          <span className="company-directory-pagination__range">
            Showing <strong>{rangeStart}–{rangeEnd}</strong> of <strong>{allRows.length}</strong> opportunities
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label htmlFor="matrix-page-size" style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
            Rows per page:
            <select
              id="matrix-page-size"
              className="sn-select"
              style={{ marginLeft: '6px', padding: '3px 8px', fontSize: '12.5px' }}
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </label>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className="btn btn--sm btn--outline"
              disabled={safePage <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              aria-label="Previous matrix page"
            >
              Previous
            </button>
            <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', padding: '0 4px' }}>
              Page {safePage + 1} of {totalPages}
            </span>
            <button
              type="button"
              className="btn btn--sm btn--outline"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              aria-label="Next matrix page"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Modal: Assessment Details (when cell is clicked) */}
      {activeAssessment ? (
        <div
          className="sn-modal-backdrop"
          role="presentation"
          onClick={() => setActiveAssessment(null)}
        >
          <div
            className="sn-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assessment-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sn-modal-header">
              <div>
                <span className="sn-tag sn-tag--accent" style={{ marginBottom: '6px' }}>
                  Company Assessment Detail
                </span>
                <h3 id="assessment-modal-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
                  {activeAssessment.assessment.companyName}
                </h3>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Evaluated for: {activeAssessment.opportunityTitle}
                </span>
              </div>
              <button
                type="button"
                className="btn btn--sm btn--clear"
                onClick={() => setActiveAssessment(null)}
                aria-label="Close assessment details"
              >
                ✕
              </button>
            </div>

            <div className="sn-modal-body">
              {/* Key Score Callout */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '12px',
                  background: 'var(--surface-2)',
                  padding: '14px',
                  borderRadius: 'var(--radius)',
                  marginBottom: '16px',
                }}
              >
                <div>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'block' }}>
                    Match Percentage
                  </span>
                  <strong style={{ fontSize: '22px', color: 'var(--accent)' }}>
                    {activeAssessment.assessment.score !== null
                      ? `${activeAssessment.assessment.score <= 1 ? Math.round(activeAssessment.assessment.score * 100) : Math.round(activeAssessment.assessment.score)}%`
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'block' }}>
                    Score Status
                  </span>
                  <span className="sn-tag" style={{ marginTop: '4px' }}>
                    {activeAssessment.assessment.scoreStatus}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'block' }}>
                    Classification
                  </span>
                  <span
                    className={`sn-tag ${outcomeBadgeClass(activeAssessment.assessment.outcome)}`}
                    style={{ marginTop: '4px' }}
                  >
                    {outcomeLabel(activeAssessment.assessment.outcome)}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'block' }}>
                    Opportunity Type
                  </span>
                  <span className="sn-tag" style={{ marginTop: '4px' }}>
                    {activeAssessment.assessment.opportunityType === 'procurement' ? 'Procurement' : 'Funding'}
                  </span>
                </div>
              </div>

              {/* Rationale List */}
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 8px' }}>
                  Evaluation Rationale &amp; Evidence
                </h4>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13.5px', lineHeight: 1.5 }}>
                  {(activeAssessment.assessment.reasons ?? []).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>

              {/* Factors Breakdown */}
              {activeAssessment.assessment.factors ? (
                <div style={{ marginBottom: '16px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 8px' }}>
                    Alignment Factor Breakdown
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
                    {Object.entries(activeAssessment.assessment.factors).map(([factorName, factor]) => {
                      const label = factorName
                        .replace(/([A-Z])/g, ' $1')
                        .replace(/^./, (s) => s.toUpperCase())
                      return (
                        <div
                          key={factorName}
                          style={{
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius)',
                            padding: '10px',
                            background: 'var(--surface)',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span style={{ fontWeight: 600, fontSize: '12.5px' }}>{label}</span>
                            <span className="sn-tag sn-tag--xs">
                              {factor.score !== null ? `${Math.round(factor.score <= 1 ? factor.score * 100 : factor.score)}%` : '—'}
                            </span>
                          </div>
                          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                            {factor.reason || (Array.isArray(factor.evidence) && factor.evidence.length > 0 ? factor.evidence.join(', ') : 'No factor evidence')}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {/* Matched / Missing / Mismatched Tags */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                {(activeAssessment.assessment.matchedFields?.length ?? 0) > 0 ? (
                  <div>
                    <span style={{ fontSize: '12px', fontWeight: 600, marginRight: '8px' }}>
                      Matched Fields:
                    </span>
                    {(activeAssessment.assessment.matchedFields ?? []).map((f) => (
                      <span key={f} className="sn-tag sn-tag--success" style={{ marginRight: '4px' }}>
                        ✓ {f}
                      </span>
                    ))}
                  </div>
                ) : null}

                {(activeAssessment.assessment.missingFields?.length ?? 0) > 0 ? (
                  <div>
                    <span style={{ fontSize: '12px', fontWeight: 600, marginRight: '8px' }}>
                      Missing Context:
                    </span>
                    {(activeAssessment.assessment.missingFields ?? []).map((f) => (
                      <span key={f} className="sn-tag" style={{ marginRight: '4px' }}>
                        ? {f}
                      </span>
                    ))}
                  </div>
                ) : null}

                {(activeAssessment.assessment.mismatchedFields?.length ?? 0) > 0 ? (
                  <div>
                    <span style={{ fontSize: '12px', fontWeight: 600, marginRight: '8px' }}>
                      Mismatches:
                    </span>
                    {(activeAssessment.assessment.mismatchedFields ?? []).map((f) => (
                      <span key={f} className="sn-tag sn-tag--muted" style={{ marginRight: '4px' }}>
                        ✕ {f}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="sn-modal-footer">
              <Link
                to={`/discovery?view=${activeAssessment.assessment.opportunityType === 'procurement' ? 'procurement-review' : 'funding-review'}`}
                className="btn btn--primary"
                onClick={() => setActiveAssessment(null)}
              >
                Open {activeAssessment.assessment.opportunityType === 'procurement' ? 'Procurement' : 'Funding'} Review Queue
              </Link>
              {activeAssessment.assessment.sourceUrl ? (
                <a
                  href={activeAssessment.assessment.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="btn btn--outline"
                >
                  Open Official Source ↗
                </a>
              ) : null}
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => setActiveAssessment(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal: Opportunity Details & Handoff (when opportunity title is clicked) */}
      {activeOpportunity ? (
        <div
          className="sn-modal-backdrop"
          role="presentation"
          onClick={() => setActiveOpportunity(null)}
        >
          <div
            className="sn-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="opportunity-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sn-modal-header">
              <div>
                <span className="sn-tag sn-tag--accent" style={{ marginBottom: '6px' }}>
                  {activeOpportunity.opportunityType === 'procurement' ? 'Procurement Opportunity' : 'Funding Opportunity'}
                </span>
                <h3 id="opportunity-modal-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
                  {activeOpportunity.opportunityTitle}
                </h3>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Source: {activeOpportunity.source} · Deadline: {activeOpportunity.deadline ?? 'Not specified'}
                </span>
              </div>
              <button
                type="button"
                className="btn btn--sm btn--clear"
                onClick={() => setActiveOpportunity(null)}
                aria-label="Close opportunity details"
              >
                ✕
              </button>
            </div>

            <div className="sn-modal-body">
              <h4 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 10px' }}>
                Evaluated Target Companies ({activeOpportunity.rawGroup.assessments?.length ?? 0})
              </h4>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {(activeOpportunity.rawGroup.assessments ?? []).map((a, i) => {
                  const pct = a.score !== null ? `${a.score <= 1 ? Math.round(a.score * 100) : Math.round(a.score)}%` : '—'
                  const isTop = activeOpportunity.topCompanies.includes(a.companyName)
                  return (
                    <li
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderBottom: '1px solid var(--border)',
                        background: isTop ? 'var(--surface-2)' : 'transparent',
                      }}
                    >
                      <div>
                        <strong>{a.companyName}</strong>
                        {isTop ? (
                          <span className="sn-tag sn-tag--accent sn-tag--xs" style={{ marginLeft: '8px' }}>
                            ★ Top Match
                          </span>
                        ) : null}
                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                          {a.reasons[0] || 'No specific reasons noted'}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, fontSize: '16px', color: 'var(--accent)' }}>
                          {pct}
                        </span>
                        <div style={{ marginTop: '2px' }}>
                          <span className={`sn-tag sn-tag--xs ${outcomeBadgeClass(a.outcome)}`}>
                            {outcomeLabel(a.outcome)}
                          </span>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="sn-modal-footer">
              <Link
                to={`/discovery?view=${activeOpportunity.opportunityType === 'procurement' ? 'procurement-review' : 'funding-review'}`}
                className="btn btn--primary"
                onClick={() => setActiveOpportunity(null)}
              >
                Open {activeOpportunity.opportunityType === 'procurement' ? 'Procurement' : 'Funding'} Review Queue
              </Link>
              {activeOpportunity.sourceUrl ? (
                <a
                  href={activeOpportunity.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="btn btn--outline"
                >
                  View Official Record ↗
                </a>
              ) : null}
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => setActiveOpportunity(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
