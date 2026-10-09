/**
 * Shared record-list pattern.
 *
 * Search is a pure client-side filter over the imported records. It does not
 * call any service and it does not modify the snapshot: `listRecords` returns
 * the same objects, and filtering only changes which of them are rendered.
 */

import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { IdBadge, StatusBadge } from '../ui/Badges'
import FilterBar from './FilterBar'
import type { FilterDef, SortDef } from './FilterBar'
import { pathForRecord, titleOf } from '../../data/selectors'
import type { RecordRow } from '../../types/records'

export interface Column<T> {
  key: string
  header: string
  /** Cell renderer. */
  render: (rec: T) => ReactNode
  /** Optional text used for client-side search. Omit to exclude from search. */
  search?: (rec: T) => string
}

interface RecordListPageProps {
  title: string
  description: string
  /**
   * Heading level for the title. Standalone list pages own the `h1`; when the
   * table is nested inside a hub page that already has its own `h1`, the hub
   * passes 2 so the page keeps exactly one top-level heading.
   */
  headingAs?: 'h1' | 'h2'
  records: RecordRow[]
  columns: Column<RecordRow>[]
  /** Placeholder for the search box, e.g. "name, ID, country". */
  searchPlaceholder: string
  /** Extra content above the table, e.g. status summary. */
  above?: ReactNode
  /**
   * Optional filter definitions. When omitted no filter bar renders, so pages
   * that do not need filters are unaffected.
   */
  filters?: FilterDef[]
  /** Optional sort options. When omitted, the `initialSort` order is kept. */
  sorts?: SortDef[]
  initialSort?: string
  /**
   * Applies the active filters. Defaults to "keep everything" — pages without
   * filters never pass this.
   */
  filterRecords?: (records: RecordRow[], active: Record<string, string>) => RecordRow[]
  /**
   * Applies the chosen sort. Defaults to "keep the order given" — pages without
   * sorts never pass this.
   */
  sortRecords?: (records: RecordRow[], sortKey: string) => RecordRow[]
  /** Rendered inside the filter bar, beside the selects. */
  filterExtra?: ReactNode
  /**
   * Filter keys to keep in the query string, enabling shareable and drill-down
   * URLs such as `/bids?status=Awarded`.
   *
   * When supplied, the URL becomes the single source of truth for these filters:
   * the selects read from it, writes to it, and the browser's back and forward
   * buttons move between filter states with no extra bookkeeping. Omit it and
   * filter state stays local, so a page that never opts in behaves exactly as
   * before.
   *
   * The parameter name is the filter key, verbatim. Param names that a page
   * already uses for a preset — `notice` and `company` on Bids, `notice`, `bid`
   * and `company` on Contracts — are deliberately not filter keys, so enabling
   * this cannot collide with them.
   */
  urlFilters?: string[]
}

/** Case-insensitive substring match across the declared search fields. */
function matches(rec: RecordRow, columns: Column<RecordRow>[], query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return columns.some((c) => {
    if (!c.search) return false
    return c.search(rec).toLowerCase().includes(q)
  })
}

export default function RecordListPage({
  title,
  description,
  headingAs = 'h1',
  records,
  columns,
  searchPlaceholder,
  above,
  filters,
  sorts,
  initialSort = '',
  filterRecords,
  sortRecords,
  filterExtra,
  urlFilters,
}: RecordListPageProps) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState(initialSort)
  const [localActive, setLocalActive] = useState<Record<string, string>>({})
  const [searchParams, setSearchParams] = useSearchParams()
  const latestSearchParams = useRef(searchParams)
  latestSearchParams.current = searchParams

  // With `urlFilters` set the URL is the only place filter state lives. Deriving
  // rather than mirroring means back/forward navigation and a shared link both
  // work by construction, with no effect to keep in step and no way for the two
  // to disagree.
  const syncToUrl = urlFilters !== undefined
  const active = useMemo(() => {
    if (!syncToUrl || !urlFilters) return localActive
    const next: Record<string, string> = {}
    for (const key of urlFilters) {
      const value = searchParams.get(key)
      if (value !== null && value !== '') next[key] = value
    }
    return next
    // `urlFilters` is a literal array at every call site, so joining it gives a
    // stable dependency without asking nine pages to memoise their own.
  }, [syncToUrl, urlFilters?.join('|'), searchParams])

  const filtered = useMemo(() => {
    // Order matters: search narrows, filters narrow, sort reorders. Sorting
    // last means a sort always applies to exactly what is on screen.
    const searched = records.filter((r) => matches(r, columns, query))
    const filteredBySelects = filterRecords ? filterRecords(searched, active) : searched
    return sortRecords ? sortRecords(filteredBySelects, sortKey) : filteredBySelects
  }, [records, columns, query, filterRecords, sortRecords, active, sortKey])

  const setFilter = (key: string, value: string) => {
    if (!syncToUrl) {
      setLocalActive((prev) => {
        const next = { ...prev }
        if (value === '') delete next[key]
        else next[key] = value
        return next
      })
      return
    }
    // `replace` rather than `push`, so changing three filters is one history
    // entry rather than three. Back still leaves the page, which is what a reader
    // expects from a filter, and the back button inside the list still undoes the
    // last filter.
    const next = new URLSearchParams(latestSearchParams.current)
    if (value === '') next.delete(key)
    else next.set(key, value)
    latestSearchParams.current = next
    setSearchParams(next, { replace: true })
  }

  const clearAllFilters = () => {
    if (!syncToUrl) {
      setLocalActive({})
      return
    }
    const next = new URLSearchParams(latestSearchParams.current)
    for (const key of urlFilters ?? []) next.delete(key)
    latestSearchParams.current = next
    setSearchParams(next, { replace: true })
  }

  const hasFilterBar = Boolean(filters && filters.length > 0)

  return (
    <section className="page">
      <header className="page__header">
        {headingAs === 'h1' ? (
          <h1 className="page__title">{title}</h1>
        ) : (
          <h2 className="page__title page__title--sub">{title}</h2>
        )}
        <p className="page__description">{description}</p>
      </header>

      <div className="listbar">
        <div className="listbar__counts">
          <span className="count">
            <strong>{records.length}</strong> records
          </span>
        </div>
        <div className="listbar__search">
          <label htmlFor="record-search" className="visually-hidden">
            Search {title}
          </label>
          <input
            id="record-search"
            type="search"
            className="input"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {query ? (
            <button type="button" className="btn btn--clear" onClick={() => setQuery('')}>
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {filters && filters.length > 0 ? (
        <FilterBar
          filters={filters}
          activeValues={active}
          sorts={sorts ?? []}
          activeSort={sortKey}
          resultCount={filtered.length}
          totalCount={records.length}
          noun={title}
          extra={filterExtra}
          onFilterChange={setFilter}
          onSortChange={setSortKey}
          onClearAll={clearAllFilters}
        />
      ) : null}

      {above}

      {filtered.length === 0 ? (
        <div className="empty" role="status">
          <p className="empty__headline">
            {records.length === 0
              ? 'No records'
              : Object.keys(active).length > 0
                ? 'No records match the selected filters'
                : 'No records match your search'}
          </p>
          <p className="empty__body">
            {records.length === 0
              ? `The snapshot contains no ${title.toLowerCase()}.`
              : Object.keys(active).length > 0
                ? `No ${title.toLowerCase()} match the selected filters${
                    query ? ` and the search term "${query}"` : ''
                  }. Clear a filter to widen the result.`
                : `No ${title.toLowerCase()} match "${query}". Try a different term, or clear the search.`}
          </p>
        </div>
      ) : (
        <>
          {/* Search can narrow the list without touching any filter, so this
              region is announced on every page — but only when no filter bar is
              present to announce the same thing. Two live regions reporting the
              identical count would make a screen reader say it twice. */}
          {!hasFilterBar ? (
            <p className="visually-hidden" role="status">
              Showing {filtered.length} of {records.length} {title.toLowerCase()}
            </p>
          ) : null}
          <div className="tablewrap">
            <table className="table">
              <caption className="visually-hidden">
                {title}: {filtered.length} of {records.length} records
              </caption>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} scope="col">
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((rec) => (
                  <tr key={rec.id}>
                    {columns.map((c) => (
                      <td key={c.key} data-label={c.header}>
                        {c.render(rec)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

/** A record name cell linking to its detail page. */
export function RecordLink({ rec }: { rec: RecordRow }) {
  const path = pathForRecord(rec.id)
  return (
    <span className="recordlink">
      <IdBadge id={rec.id} />
      <Link to={path ?? '#'} className="recordlink__name">
        {titleOf(rec)}
      </Link>
    </span>
  )
}

/** A status cell, or an explicit blank marker when the value is blank. */
export function StatusCell({ value }: { value: unknown }) {
  if (typeof value !== 'string' || value === '') {
    return <span className="value value--blank">(blank)</span>
  }
  return <StatusBadge label={value} />
}

/**
 * Links to related records for a table cell, or an explicit "none" note.
 * Every cell always renders a real link or the note, never an empty `<td>`.
 */
export function RelatedLinks({ ids }: { ids: string[] }) {
  if (ids.length === 0) return <span className="value value--absent">none</span>
  return (
    <>
      {ids.map((id) => {
        const path = pathForRecord(id)
        return (
          <span key={id} className="relatedcell">
            {path ? <Link to={path}>{id}</Link> : id}
          </span>
        )
      })}
    </>
  )
}
