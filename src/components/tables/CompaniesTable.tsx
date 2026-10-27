import { Fragment, useEffect, useMemo, useReducer, useState } from 'react'
import { Link } from 'react-router-dom'
import { COMPANY_DIRECTORY_NAMES } from '../../data/company-directory-names'
import { associationsForCompany } from '../../live-source/company-associations'
import { reviewFixtureStore } from '../../automation/review-fixture'
import { deadlineOf } from '../review/labels'
import {
  loadImportedTargetCompanies,
  subscribeImportedTargetCompanies,
} from '../../target-companies/store'
import type { CsvPreview } from '../../target-companies/csv'

const UNAVAILABLE = <span className="value value--blank">Unavailable</span>

interface CompanyCsvData {
  url: string
  hq: string
  sector: string
  icp: string
  capabilities: string[]
}

function headerIndex(headers: readonly string[], pattern: RegExp): number {
  return headers.findIndex((header) => pattern.test(header.trim()))
}

function extractCsvCompanyMap(preview: CsvPreview | null): Map<string, CompanyCsvData> {
  const map = new Map<string, CompanyCsvData>()
  if (!preview || preview.rows.length === 0) return map

  const nameIdx = headerIndex(preview.headers, /company.*name|^name$|legal name/i)
  const countryIdx = headerIndex(preview.headers, /hq|location|country|region/i)
  const sectorIdx = headerIndex(preview.headers, /sector|industry/i)
  const urlIdx = headerIndex(preview.headers, /url|website|domain/i)
  const icpIdx = headerIndex(preview.headers, /ideal customer|icp|profile/i)

  preview.rows.forEach((row) => {
    const rawName = nameIdx >= 0 ? (row[nameIdx] ?? '').trim() : ''
    if (!rawName) return

    const url = urlIdx >= 0 ? (row[urlIdx] ?? '').trim() : ''
    const hq = countryIdx >= 0 ? (row[countryIdx] ?? '').trim() : ''
    const sector = sectorIdx >= 0 ? (row[sectorIdx] ?? '').trim() : ''
    const icp = icpIdx >= 0 ? (row[icpIdx] ?? '').trim() : ''
    const capabilities = sector
      ? sector
          .split(/[,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : []

    map.set(rawName.toLocaleLowerCase(), { url, hq, sector, icp, capabilities })
  })

  return map
}

function distinctApproved(name: string, domain: 'funding' | 'procurement'): { recordId: string; reviewId: string }[] {
  const seen = new Set<string>()
  const out: { recordId: string; reviewId: string }[] = []
  for (const association of associationsForCompany(name)) {
    if (association.domain !== domain) continue
    const key = association.sourceRecordId ?? association.candidateId
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ recordId: key, reviewId: association.reviewId })
  }
  return out
}

function CompanyApprovals({ name, csvData }: { name: string; csvData?: CompanyCsvData }) {
  const funding = distinctApproved(name, 'funding')
  const procurement = distinctApproved(name, 'procurement')

  const renderGroup = (title: string, entries: { recordId: string; reviewId: string }[]) => {
    if (entries.length === 0) return null
    return (
      <div style={{ marginBottom: '16px' }}>
        <h4 className="dg-subtitle" style={{ fontSize: '13px', margin: '0 0 8px' }}>
          {title} ({entries.length})
        </h4>
        <ul className="dg-candidates" style={{ margin: 0, paddingLeft: '18px' }}>
          {entries.map((entry) => {
            const item = reviewFixtureStore.item(entry.reviewId)
            if (item === undefined) {
              return (
                <li key={entry.reviewId} className="dg-candidate">
                  <span className="dg-candidate__title">{entry.recordId}</span>
                  <span className="dg-candidate__meta">
                    Review record unavailable — association preserved.
                  </span>
                </li>
              )
            }
            return (
              <li key={entry.reviewId} className="dg-candidate">
                <span className="dg-candidate__title" style={{ fontWeight: 600 }}>
                  {item.sourceTitle || '(untitled)'}
                </span>
                <span className="dg-candidate__meta" style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)' }}>
                  {item.sourceRecordId ?? item.candidateId} · deadline {deadlineOf(item) ?? '—'}
                  {' · approved '}
                  {item.audit.length > 0 ? item.audit[item.audit.length - 1]?.decidedAt.slice(0, 10) ?? '—' : '—'}
                </span>
                <div style={{ marginTop: '4px', display: 'flex', gap: '10px', fontSize: '12.5px', flexWrap: 'wrap' }}>
                  <a className="dg-candidate__link" href={item.sourceUrl} target="_blank" rel="noreferrer">
                    Official source record
                  </a>
                  <Link to={`/review/${encodeURIComponent(item.reviewId)}`}>
                    Open review item
                  </Link>
                  <Link to={`/prepare/${encodeURIComponent(item.reviewId)}`}>
                    Prepare application
                  </Link>
                  <span className="dg-candidate__meta">TVB does not submit applications automatically.</span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <div className="sn-details-panel">
      {/* Profile & CSV details */}
      <div className="sn-details-card">
        <div className="sn-details-card__title">Target Company Profile (CSV Data)</div>
        <div className="sn-details-card__body">
          <p style={{ margin: '0 0 6px' }}>
            <strong>Website / URL:</strong>{' '}
            {csvData?.url ? (
              <a href={csvData.url} target="_blank" rel="noreferrer">
                {csvData.url}
              </a>
            ) : (
              UNAVAILABLE
            )}
          </p>
          <p style={{ margin: '0 0 6px' }}>
            <strong>HQ Location:</strong> {csvData?.hq || UNAVAILABLE}
          </p>
          <p style={{ margin: '0 0 6px' }}>
            <strong>Sector:</strong> {csvData?.sector || UNAVAILABLE}
          </p>
          {csvData?.capabilities && csvData.capabilities.length > 0 ? (
            <div style={{ margin: '6px 0' }}>
              <strong>Capabilities:</strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                {csvData.capabilities.map((cap, i) => (
                  <span key={i} className="sn-tag sn-tag--accent">
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {csvData?.icp ? (
            <div style={{ marginTop: '8px' }}>
              <strong>Ideal Customer Profile:</strong>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: '1.45' }}>
                {csvData.icp}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Approved Opportunities */}
      <div className="sn-details-card">
        <div className="sn-details-card__title">Approved Portfolio Opportunities</div>
        <div className="sn-details-card__body">
          {funding.length === 0 && procurement.length === 0 ? (
            <p className="dg-empty" style={{ margin: 0 }}>
              No approved opportunities yet for {name}.
            </p>
          ) : (
            <>
              {renderGroup('Approved funding opportunities', funding)}
              {renderGroup('Approved procurement notices', procurement)}
            </>
          )}
          <p style={{ margin: '10px 0 0', fontSize: '11.5px', color: 'var(--text-subtle)' }}>
            All applications require manual review and verification prior to submission.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function CompaniesTable({ headingAs = 'h1' }: { headingAs?: 'h1' | 'h2' }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'asc' | 'desc' | 'country' | 'funding' | 'procurement'>('asc')
  const [pageSize, setPageSize] = useState<number>(5)
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showCsvColumns, setShowCsvColumns] = useState(false)
  const [importedPreview, setImportedPreview] = useState<CsvPreview | null>(() =>
    loadImportedTargetCompanies(),
  )

  const [, forceRender] = useReducer((version: number) => version + 1, 0)

  useEffect(() => {
    const unsubscribeStore = reviewFixtureStore.subscribe(() => {
      forceRender()
    })
    const unsubscribeImport = subscribeImportedTargetCompanies(() => {
      setImportedPreview(loadImportedTargetCompanies())
    })
    forceRender()
    return () => {
      unsubscribeStore()
      unsubscribeImport()
    }
  }, [])

  const csvMap = useMemo(() => extractCsvCompanyMap(importedPreview), [importedPreview])

  const names = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const filtered = COMPANY_DIRECTORY_NAMES.filter((name) => {
      if (!normalizedQuery) return true
      if (name.toLocaleLowerCase().includes(normalizedQuery)) return true
      const csv = csvMap.get(name.toLocaleLowerCase())
      if (csv) {
        if (csv.url.toLocaleLowerCase().includes(normalizedQuery)) return true
        if (csv.hq.toLocaleLowerCase().includes(normalizedQuery)) return true
        if (csv.sector.toLocaleLowerCase().includes(normalizedQuery)) return true
        if (csv.icp.toLocaleLowerCase().includes(normalizedQuery)) return true
      }
      return false
    })

    return [...filtered].sort((left, right) => {
      if (sort === 'asc') return left.localeCompare(right, 'en', { sensitivity: 'base' })
      if (sort === 'desc') return right.localeCompare(left, 'en', { sensitivity: 'base' })
      if (sort === 'country') {
        const hqLeft = csvMap.get(left.toLocaleLowerCase())?.hq || ''
        const hqRight = csvMap.get(right.toLocaleLowerCase())?.hq || ''
        return hqLeft.localeCompare(hqRight, 'en', { sensitivity: 'base' })
      }
      if (sort === 'funding') {
        return distinctApproved(right, 'funding').length - distinctApproved(left, 'funding').length
      }
      if (sort === 'procurement') {
        return distinctApproved(right, 'procurement').length - distinctApproved(left, 'procurement').length
      }
      return 0
    })
  }, [query, sort, csvMap])

  const pageCount = Math.ceil(names.length / pageSize)
  const currentPage = Math.min(page, Math.max(pageCount - 1, 0))
  const visibleNames = names.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const firstVisible = names.length === 0 ? 0 : currentPage * pageSize + 1
  const lastVisible = Math.min((currentPage + 1) * pageSize, names.length)

  return (
    <section className="page" aria-labelledby="companies-page-title">
      <header className="page__header">
        {headingAs === 'h1' ? (
          <h1 className="page__title" id="companies-page-title">
            Companies
          </h1>
        ) : (
          <h2 className="page__title page__title--sub" id="companies-page-title">
            Companies
          </h2>
        )}
        <p className="page__description">
          The company and organization directory available to TVB Opportunity Intelligence. Imported target company fields
          (URL, HQ location, Sector, ICP, and capabilities) and verified approved opportunities are inspectable below.
        </p>
      </header>

      {/* Summary Stat Bar */}
      <div className="sn-overview-grid" style={{ marginBottom: '18px' }}>
        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Total Directory</span>
            <span className="sn-stat-card__icon">🏢</span>
          </div>
          <span className="sn-stat-card__value">189 Directory</span>
          <span className="sn-stat-card__meta">Protected portfolio companies</span>
        </div>
        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">CSV Imported</span>
            <span className="sn-stat-card__icon">📂</span>
          </div>
          <span className="sn-stat-card__value">{importedPreview?.rowCount ?? 0}</span>
          <span className="sn-stat-card__meta">Company profiles active in session</span>
        </div>
        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Filtered Matching</span>
            <span className="sn-stat-card__icon">🔍</span>
          </div>
          <span className="sn-stat-card__value">{names.length} Matches</span>
          <span className="sn-stat-card__meta">Matching active query</span>
        </div>
      </div>

      {/* Main Toolbar & Search */}
      <div className="listbar sn-toolbar">
        <div className="listbar__counts">
          <span className="count">
            <strong>{names.length}</strong> of {COMPANY_DIRECTORY_NAMES.length} companies
          </span>
        </div>

        <div className="listbar__search sn-toolbar__search-group">
          <label htmlFor="company-search" className="visually-hidden">
            Search Companies
          </label>
          <input
            id="company-search"
            type="search"
            className="input sn-search-input"
            placeholder="Search company name, sector, HQ, or website…"
            value={query}
            aria-label="Search Companies"
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(0)
            }}
            autoComplete="off"
          />
          {query ? (
            <button type="button" className="btn btn--clear" onClick={() => setQuery('')}>
              Clear
            </button>
          ) : null}
        </div>

        {/* Controls: Sort, Page Size, CSV Columns Toggle */}
        <div className="sn-toolbar__filters">
          <label className="company-directory-tools__sort" htmlFor="sort-by-select">
            <span>Sort by</span>
            <select
              id="sort-by-select"
              className="input sn-select"
              aria-label="Sort by"
              value={sort}
              onChange={(event) => setSort(event.target.value as any)}
            >
              <option value="asc">Name (A–Z)</option>
              <option value="desc">Name (Z–A)</option>
              <option value="country">Country / HQ</option>
              <option value="funding">Funding Activity</option>
              <option value="procurement">Procurement Activity</option>
            </select>
          </label>

          <label htmlFor="page-size-select" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
            <span>Rows:</span>
            <select
              id="page-size-select"
              className="sn-select"
              aria-label="Rows per page"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
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

          <button
            type="button"
            className={`btn ${showCsvColumns ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => setShowCsvColumns((v) => !v)}
            aria-pressed={showCsvColumns}
          >
            {showCsvColumns ? 'Hide CSV Columns' : 'Show CSV Columns (5 Fields)'}
          </button>
        </div>
      </div>

      {names.length === 0 ? (
        <div className="empty" role="status">
          <p className="empty__headline">No companies match your search</p>
          <p className="empty__body">Try searching by a different name, sector, or clearing the search query.</p>
          {query ? (
            <p style={{ marginTop: '10px' }}>
              <button type="button" className="btn btn--primary" onClick={() => setQuery('')}>
                Clear Search
              </button>
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="tablewrap">
            <table className="table">
              <caption className="visually-hidden">
                Companies: {names.length} matching of {COMPANY_DIRECTORY_NAMES.length}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Country</th>
                  <th scope="col">Company stage</th>
                  <th scope="col">Funding activity</th>
                  <th scope="col">Procurement activity</th>
                  <th scope="col">Profile status</th>
                  {showCsvColumns ? (
                    <>
                      <th scope="col">Website / URL</th>
                      <th scope="col">HQ Location</th>
                      <th scope="col">Sector</th>
                      <th scope="col">Ideal Customer Profile</th>
                      <th scope="col">Capabilities</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {visibleNames.map((name) => {
                  const funding = distinctApproved(name, 'funding')
                  const procurement = distinctApproved(name, 'procurement')
                  const open = expanded === name
                  const csvData = csvMap.get(name.toLocaleLowerCase())

                  return (
                    <Fragment key={name}>
                      <tr>
                        <td data-label="Company">
                          <button
                            type="button"
                            className="recordlink__name sn-company-name-btn"
                            aria-expanded={open}
                            aria-label={`${open ? 'Hide' : 'Show'} approved opportunities for ${name}`}
                            onClick={() => setExpanded(open ? null : name)}
                          >
                            {name}
                          </button>
                        </td>
                        <td data-label="Country">{csvData?.hq || UNAVAILABLE}</td>
                        <td data-label="Company stage">{UNAVAILABLE}</td>
                        <td data-label="Funding activity">
                          {funding.length === 0 ? (
                            <span className="value value--blank">0 approved</span>
                          ) : (
                            <span className="sn-tag sn-tag--success">
                              {funding.length} approved ({funding.length === 1 ? 'opportunity' : 'opportunities'})
                            </span>
                          )}
                        </td>
                        <td data-label="Procurement activity">
                          {procurement.length === 0 ? (
                            <span className="value value--blank">0 approved</span>
                          ) : (
                            <span className="sn-tag sn-tag--accent">
                              {procurement.length} approved ({procurement.length === 1 ? 'notice' : 'notices'})
                            </span>
                          )}
                        </td>
                        <td data-label="Profile status">
                          {csvData ? (
                            <span className="sn-tag sn-tag--accent">Imported (CSV)</span>
                          ) : (
                            UNAVAILABLE
                          )}
                        </td>
                        {showCsvColumns ? (
                          <>
                            <td data-label="Website / URL">
                              {csvData?.url ? (
                                <a
                                  href={csvData.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="sn-cell-truncate"
                                  title={csvData.url}
                                >
                                  {csvData.url}
                                </a>
                              ) : (
                                UNAVAILABLE
                              )}
                            </td>
                            <td data-label="HQ Location">
                              <span className="sn-cell-truncate" title={csvData?.hq || ''}>
                                {csvData?.hq || UNAVAILABLE}
                              </span>
                            </td>
                            <td data-label="Sector">
                              <span className="sn-cell-truncate" title={csvData?.sector || ''}>
                                {csvData?.sector || UNAVAILABLE}
                              </span>
                            </td>
                            <td data-label="Ideal Customer Profile">
                              <span className="sn-cell-truncate" title={csvData?.icp || ''}>
                                {csvData?.icp || UNAVAILABLE}
                              </span>
                            </td>
                            <td data-label="Capabilities">
                              {csvData?.capabilities && csvData.capabilities.length > 0 ? (
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '200px' }}>
                                  {csvData.capabilities.slice(0, 2).map((cap, i) => (
                                    <span key={i} className="sn-tag">
                                      {cap}
                                    </span>
                                  ))}
                                  {csvData.capabilities.length > 2 ? (
                                    <span className="sn-tag">+{csvData.capabilities.length - 2}</span>
                                  ) : null}
                                </div>
                              ) : (
                                UNAVAILABLE
                              )}
                            </td>
                          </>
                        ) : null}
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={showCsvColumns ? 11 : 6}>
                            <CompanyApprovals name={name} csvData={csvData} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <nav className="company-directory-pagination" aria-label="Company list pages">
            <div>
              <span className="company-directory-pagination__range" aria-live="polite">
                {firstVisible}–{lastVisible} of {names.length}
              </span>
              <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-subtle)' }}>
                (Showing {firstVisible}–{lastVisible} of {names.length} companies)
              </span>
            </div>

            <div className="company-directory-pagination__controls">
              <button
                type="button"
                className="btn"
                aria-label="Previous companies"
                onClick={() => setPage(currentPage - 1)}
                disabled={currentPage === 0}
              >
                Previous
              </button>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '0 4px' }}>
                Page {currentPage + 1} of {Math.max(1, pageCount)}
              </span>
              <button
                type="button"
                className="btn"
                aria-label="Next companies"
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage >= pageCount - 1}
              >
                Next
              </button>
            </div>
          </nav>
        </>
      )}
    </section>
  )
}
