import { useMemo, useState } from 'react'

const PAGE_SIZE = 5

interface CompanySelectorProps {
  companies: readonly string[]
  selected: ReadonlySet<string>
  onToggle(companyName: string): void
  onSelectAllVisible(companyNames: readonly string[]): void
  onClear(): void
}

/**
 * Company selection for a discovery run (Phase G brief §3).
 *
 * The selector lists names from the source directory. They are selection keys,
 * not Company records or generated Company IDs. The live count ("N companies
 * selected") is spoken by a status region so screen readers hear selection changes.
 */
export default function CompanySelector({
  companies,
  selected,
  onToggle,
  onSelectAllVisible,
  onClear,
}: CompanySelectorProps) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const count = selected.size
  const sortedCompanies = useMemo(
    () => [...companies].sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' })),
    [companies],
  )
  const filteredCompanies = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return query
      ? sortedCompanies.filter((companyName) => companyName.toLocaleLowerCase().includes(query))
      : sortedCompanies
  }, [search, sortedCompanies])
  const pageCount = Math.ceil(filteredCompanies.length / PAGE_SIZE)
  const currentPage = Math.min(page, Math.max(pageCount - 1, 0))
  const visibleCompanies = filteredCompanies.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const firstVisible = filteredCompanies.length === 0 ? 0 : currentPage * PAGE_SIZE + 1
  const lastVisible = Math.min((currentPage + 1) * PAGE_SIZE, filteredCompanies.length)

  return (
    <section className="card dg-panel" aria-label="Company selection">
      <h2 className="dg-panel__title">Companies</h2>

      <label className="dg-company-search">
        <span className="visually-hidden">Search companies</span>
        <input
          type="search"
          value={search}
          aria-label="Search companies"
          placeholder="Search companies"
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(0)
          }}
        />
      </label>

      <div className="dg-tools">
        <button type="button" className="btn" onClick={() => onSelectAllVisible(visibleCompanies)}>
          Select all visible
        </button>
        <button type="button" className="btn" onClick={onClear}>
          Clear selection
        </button>
      </div>

      <p className="dg-count" role="status" aria-live="polite">
        {count} {count === 1 ? 'company' : 'companies'} selected
      </p>

      {filteredCompanies.length === 0 ? (
        <p className="dg-empty">No company records are available to run discovery for.</p>
      ) : (
        <>
          <ul className="dg-companies">
            {visibleCompanies.map((companyName) => (
              <li key={companyName}>
                <label className="dg-company">
                  <input
                    type="checkbox"
                    className="dg-company__check"
                    checked={selected.has(companyName)}
                    onChange={() => onToggle(companyName)}
                  />
                  <span className="dg-company__body">
                    <span className="dg-company__name">{companyName}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <nav className="dg-company-pagination" aria-label="Company list pages">
            <span className="dg-company-pagination__range" aria-live="polite">
              {firstVisible}–{lastVisible} of {filteredCompanies.length}
            </span>
            <div className="dg-company-pagination__controls">
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