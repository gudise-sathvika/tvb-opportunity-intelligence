import { Fragment, useEffect, useMemo, useReducer, useState } from 'react'
import { Link } from 'react-router-dom'
import { installReviewPersistence } from '../../live-source/review-persistence'
import { COMPANY_DIRECTORY_NAMES } from '../../data/company-directory-names'
import { associationsForCompany } from '../../live-source/company-associations'
import { reviewFixtureStore } from '../../automation/review-fixture'
import { deadlineOf } from '../review/labels'

const PAGE_SIZE = 5
const UNAVAILABLE = <span className="value value--blank">Unavailable</span>

/**
 * Phase 32: approved-activity columns are derived from recorded
 * company-opportunity associations (distinct canonical opportunities per
 * company per domain), never from discovery occurrences. Details come live
 * from the referenced review items, so the list cannot drift from evidence.
 */
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

/**
 * Phase 32 approved-opportunity list for one company. Every field is read live
 * from the referenced review item; an association whose review record is
 * unavailable renders honestly instead of guessing.
 */
function CompanyApprovals({ name }: { name: string }) {
  const funding = distinctApproved(name, 'funding')
  const procurement = distinctApproved(name, 'procurement')
  if (funding.length === 0 && procurement.length === 0) {
    return <p className="dg-empty">No approved opportunities yet for {name}.</p>
  }
  const renderGroup = (title: string, entries: { recordId: string; reviewId: string }[]) => {
    if (entries.length === 0) return null
    return (
      <div>
        <h3 className="dg-subtitle">
          {title} ({entries.length})
        </h3>
        <ul className="dg-candidates">
          {entries.map((entry) => {
            const item = reviewFixtureStore.item(entry.reviewId)
            if (item === undefined) {
              return (
                <li key={entry.reviewId} className="dg-candidate">
                  <span className="dg-candidate__title">{entry.recordId}</span>
                  <span className="dg-candidate__meta">Review record unavailable — association preserved.</span>
                </li>
              )
            }
            return (
              <li key={entry.reviewId} className="dg-candidate">
                <span className="dg-candidate__title">{item.sourceTitle || '(untitled)'}</span>
                <span className="dg-candidate__meta">
                  {item.sourceRecordId ?? item.candidateId} · deadline {deadlineOf(item) ?? '—'}
                  {' · approved '}
                  {item.audit.length > 0 ? item.audit[item.audit.length - 1]?.decidedAt.slice(0, 10) ?? '—' : '—'}
                </span>
                <a className="dg-candidate__link" href={item.sourceUrl} target="_blank" rel="noreferrer">
                  Official source record
                </a>{' '}
                <Link to={`/review/${encodeURIComponent(item.reviewId)}`}>Open review item</Link>{' '}
                <Link to={`/prepare/${encodeURIComponent(item.reviewId)}`}>Prepare application</Link>
                <span className="dg-candidate__meta">TVB does not submit applications automatically.</span>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }
  return (
    <div>
      {renderGroup('Approved funding opportunities', funding)}
      {renderGroup('Approved procurement notices', procurement)}
    </div>
  )
}

export default function CompaniesTable({ headingAs = 'h1' }: { headingAs?: 'h1' | 'h2' }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  // Phase 33: restore persisted review items/decisions so approved lists survive reloads.
  const [, forceRender] = useReducer((version: number) => version + 1, 0)
  useEffect(() => {
    const uninstallPersistence = installReviewPersistence()
    const unsubscribeTick = reviewFixtureStore.subscribe(() => {
      forceRender()
    })
    forceRender()
    return () => {
      uninstallPersistence()
      unsubscribeTick()
    }
  }, [])

  const names = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const filtered = COMPANY_DIRECTORY_NAMES.filter((name) =>
      name.toLocaleLowerCase().includes(normalizedQuery),
    )
    return [...filtered].sort((left, right) =>
      sort === 'asc'
        ? left.localeCompare(right, 'en', { sensitivity: 'base' })
        : right.localeCompare(left, 'en', { sensitivity: 'base' }),
    )
  }, [query, sort])

  const pageCount = Math.ceil(names.length / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(pageCount - 1, 0))
  const visibleNames = names.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const firstVisible = names.length === 0 ? 0 : currentPage * PAGE_SIZE + 1
  const lastVisible = Math.min((currentPage + 1) * PAGE_SIZE, names.length)

  return (
    <section className="page">
      <header className="page__header">
        {headingAs === 'h1' ? (
          <h1 className="page__title">Companies</h1>
        ) : (
          <h2 className="page__title page__title--sub">Companies</h2>
        )}
        <p className="page__description">
          The company and organization name directory available to the platform. Additional profile
          details are shown when present in company records.
        </p>
      </header>

      <div className="listbar">
        <div className="listbar__counts">
          <span className="count">
            <strong>{names.length}</strong> of {COMPANY_DIRECTORY_NAMES.length} companies
          </span>
        </div>
        <div className="listbar__search">
          <label htmlFor="company-search" className="visually-hidden">
            Search Companies
          </label>
          <input
            id="company-search"
            type="search"
            className="input"
            placeholder="Search company names…"
            value={query}
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
      </div>

      <div className="company-directory-tools">
        <label className="company-directory-tools__sort">
          <span>Sort by</span>
          <select
            className="input"
            aria-label="Sort by"
            value={sort}
            onChange={(event) => setSort(event.target.value === 'desc' ? 'desc' : 'asc')}
          >
            <option value="asc">Name (A–Z)</option>
            <option value="desc">Name (Z–A)</option>
          </select>
        </label>
      </div>

      {names.length === 0 ? (
        <div className="empty" role="status">
          <p className="empty__headline">No companies match your search</p>
          <p className="empty__body">Try a different name or clear the search.</p>
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
                </tr>
              </thead>
              <tbody>
                {visibleNames.map((name) => {
                  const funding = distinctApproved(name, 'funding')
                  const procurement = distinctApproved(name, 'procurement')
                  const open = expanded === name
                  return (
                    <Fragment key={name}>
                      <tr>
                        <td data-label="Company">
                          <button
                            type="button"
                            className="recordlink__name"
                            aria-expanded={open}
                            aria-label={`${open ? 'Hide' : 'Show'} approved opportunities for ${name}`}
                            onClick={() => setExpanded(open ? null : name)}
                          >
                            {name}
                          </button>
                        </td>
                        <td data-label="Country">{UNAVAILABLE}</td>
                        <td data-label="Company stage">{UNAVAILABLE}</td>
                        <td data-label="Funding activity">
                          {funding.length === 0 ? (
                            <span className="value value--blank">0 approved</span>
                          ) : (
                            <span>
                              {funding.length} approved ({funding.length === 1 ? 'opportunity' : 'opportunities'})
                            </span>
                          )}
                        </td>
                        <td data-label="Procurement activity">
                          {procurement.length === 0 ? (
                            <span className="value value--blank">0 approved</span>
                          ) : (
                            <span>
                              {procurement.length} approved ({procurement.length === 1 ? 'notice' : 'notices'})
                            </span>
                          )}
                        </td>
                        <td data-label="Profile status">{UNAVAILABLE}</td>
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={6}>
                            <CompanyApprovals name={name} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <nav className="company-directory-pagination" aria-label="Company list pages">
            <span className="company-directory-pagination__range" aria-live="polite">
              {firstVisible}–{lastVisible} of {names.length}
            </span>
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
