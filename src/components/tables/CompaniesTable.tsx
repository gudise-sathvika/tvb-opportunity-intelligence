import { useMemo, useState } from 'react'
import { COMPANY_DIRECTORY_NAMES } from '../../data/company-directory-names'

const PAGE_SIZE = 5
const UNAVAILABLE = <span className="value value--blank">Unavailable</span>

export default function CompaniesTable({ headingAs = 'h1' }: { headingAs?: 'h1' | 'h2' }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)

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
                {visibleNames.map((name) => (
                  <tr key={name}>
                    <td data-label="Company">{name}</td>
                    <td data-label="Country">{UNAVAILABLE}</td>
                    <td data-label="Company stage">{UNAVAILABLE}</td>
                    <td data-label="Funding activity">{UNAVAILABLE}</td>
                    <td data-label="Procurement activity">{UNAVAILABLE}</td>
                    <td data-label="Profile status">{UNAVAILABLE}</td>
                  </tr>
                ))}
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
