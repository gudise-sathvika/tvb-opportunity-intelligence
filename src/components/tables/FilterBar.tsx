/**
 * Filter and sort controls for a record list.
 *
 * Presentational and fully controlled: it owns no state of its own. The page
 * holds the authoritative filter values and passes them down, because the page
 * is what actually applies them. An earlier version kept its own copy to render
 * the clear button and the result count, which silently disagreed with the page
 * — the count read "no filters" while the table was filtered, and the clear
 * button never appeared at all.
 *
 * Accessibility notes, because a filter bar is easy to get wrong:
 *
 * - Every control is a real labelled form field, so it is reachable by keyboard
 *   and announced with its own name. No div-with-onClick anywhere.
 * - The result count is a live region, so a screen reader hears the outcome of a
 *   filter change rather than having to go hunting for the table.
 * - Each select is labelled by its own visible text, and the group is wrapped in
 *   a labelled fieldset so the set of filters is announced as a set.
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface SelectOption {
  value: string
  label: string
  /** Optional trailing count, e.g. "3". Rendered muted, never as the label. */
  count?: number
}

export interface FilterDef {
  /** Stable key used in the change callback. */
  key: string
  /** Visible label. Also the accessible name. */
  label: string
  options: SelectOption[]
  /**
   * A human description of what this filter selects, shown as the title
   * attribute. Present so a reader can find out what a dimension means without
   * leaving the list.
   */
  hint?: string
  /**
   * Whether this filter is considered a primary/core filter that stays visible
   * directly in the filter bar.
   */
  primary?: boolean
  /**
   * Category name for grouping in the dropdown/popup panel.
   */
  category?: string
}

export interface SortDef {
  key: string
  label: string
}

interface FilterBarProps {
  filters: FilterDef[]
  /** Current value per filter key. An absent or empty value means "all". */
  activeValues: Record<string, string>
  sorts: SortDef[]
  activeSort: string
  resultCount: number
  totalCount: number
  noun: string
  onFilterChange: (key: string, value: string) => void
  onSortChange: (key: string) => void
  /**
   * Removes every filter in one step. Passed as its own callback rather than
   * derived from repeated `onFilterChange` calls, because a page that syncs
   * filters to the query string rebuilds those params per call.
   */
  onClearAll: () => void
  extra?: ReactNode
}

interface CategoryFilterPopupProps {
  category: string
  filters: FilterDef[]
  activeValues: Record<string, string>
  onFilterChange: (key: string, value: string) => void
  onResetCategory: (catFilters: FilterDef[]) => void
}

function CategoryFilterPopup({
  category,
  filters,
  activeValues,
  onFilterChange,
  onResetCategory,
}: CategoryFilterPopupProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const hoverTimerRef = useRef<number | null>(null)
  const justClosedRef = useRef(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupId = useId()

  const activeFilters = filters.filter((f) => (activeValues[f.key] ?? '') !== '')
  const activeCount = activeFilters.length

  const handleMouseEnter = () => {
    if (justClosedRef.current) return
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setIsOpen(true)
  }

  const handleMouseLeave = () => {
    justClosedRef.current = false
    if (isPinned) return
    hoverTimerRef.current = window.setTimeout(() => {
      setIsOpen(false)
    }, 180)
  }

  const closePanel = () => {
    justClosedRef.current = true
    setIsPinned(false)
    setIsOpen(false)
  }

  const handleTriggerClick = () => {
    justClosedRef.current = false
    if (isPinned) {
      closePanel()
    } else {
      setIsPinned(true)
      setIsOpen(true)
    }
  }

  // Close on outside click or Escape (using capture phase so Escape is never swallowed)
  useEffect(() => {
    if (!isOpen) return
    const onDocClick = (e: MouseEvent | TouchEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        closePanel()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closePanel()
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDocClick, true)
    document.addEventListener('touchstart', onDocClick, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDocClick, true)
      document.removeEventListener('touchstart', onDocClick, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [isOpen])

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current)
      }
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setIsPinned(false)
      setIsOpen(false)
      triggerRef.current?.focus()
    }
  }

  // Derive summary text
  let summaryText = 'All'
  if (activeCount === 1) {
    const f = activeFilters[0]
    const val = activeValues[f.key]
    const opt = f.options.find((o) => o.value === val)
    summaryText = opt?.label ?? val
  } else if (activeCount > 1) {
    summaryText = `${activeCount} active`
  }

  const tooltipTitle =
    activeCount > 0
      ? `${category}: ` +
        activeFilters
          .map((f) => {
            const val = activeValues[f.key]
            const opt = f.options.find((o) => o.value === val)
            return `${f.label}: ${opt?.label ?? val}`
          })
          .join(', ')
      : `${category} filters`

  return (
    <div
      ref={wrapRef}
      className={`filterbar__field filterbar__category-wrap ${isOpen ? 'filterbar__category-wrap--open' : ''} ${isPinned ? 'filterbar__category-wrap--pinned' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="filterbar__label" id={`cat-label-${popupId}`}>
        {category}
      </span>
      <button
        ref={triggerRef}
        type="button"
        id={`cat-btn-${popupId}`}
        className={`input filterbar__select filterbar__category-btn ${activeCount > 0 ? 'filterbar__category-btn--active' : ''} ${isOpen ? 'filterbar__category-btn--open' : ''} ${isPinned ? 'filterbar__category-btn--pinned' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={popupId}
        aria-labelledby={`cat-label-${popupId}`}
        title={tooltipTitle}
        onClick={handleTriggerClick}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            closePanel()
          }
        }}
      >
        <span className="filterbar__category-summary">{summaryText}</span>
        {activeCount > 0 ? (
          <span className="filterbar__badge" aria-label={`${activeCount} active`}>
            {activeCount}
          </span>
        ) : null}
        <span className="filterbar__caret" aria-hidden="true">
          {isOpen ? '▴' : '▾'}
        </span>
      </button>

      {isOpen ? (
        <div
          id={popupId}
          className="filterbar__popup"
          role="dialog"
          aria-label={`${category} filters`}
          onKeyDown={handleKeyDown}
        >
          <div className="filterbar__popup-header">
            <span className="filterbar__popup-title">{category}</span>
            <div className="filterbar__popup-actions">
              {activeCount > 0 ? (
                <button
                  type="button"
                  className="btn btn--clear filterbar__popup-clear"
                  onClick={() => onResetCategory(filters)}
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                className={`filterbar__pin-btn ${isPinned ? 'filterbar__pin-btn--pinned' : ''}`}
                onClick={() => setIsPinned((prev) => !prev)}
                title={isPinned ? 'Unpin panel (closes when mouse leaves)' : 'Pin panel open'}
                aria-pressed={isPinned}
              >
                {isPinned ? '📌 Pinned' : '📍 Pin'}
              </button>
              <button
                type="button"
                className="filterbar__popup-close"
                onClick={() => {
                  closePanel()
                  triggerRef.current?.focus()
                }}
                aria-label={`Close ${category} filters`}
              >
                ×
              </button>
            </div>
          </div>

          <div className="filterbar__popup-body">
            {filters.map((f) => {
              const isActive = (activeValues[f.key] ?? '') !== ''
              return (
                <div
                  key={f.key}
                  className={`filterbar__field filterbar__popup-field ${isActive ? 'filterbar__field--active' : ''}`}
                >
                  <label className="filterbar__label" htmlFor={`filter-${f.key}`}>
                    {f.label}
                    {isActive ? (
                      <span className="filterbar__active-dot" title="Filter active" aria-hidden="true" />
                    ) : null}
                  </label>
                  <select
                    id={`filter-${f.key}`}
                    className="input filterbar__select"
                    value={activeValues[f.key] ?? ''}
                    title={f.hint}
                    onChange={(e) => onFilterChange(f.key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation()
                        closePanel()
                        triggerRef.current?.focus()
                      }
                    }}
                  >
                    <option value="">All</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                        {typeof o.count === 'number' ? ` (${o.count})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function FilterBar({
  filters,
  activeValues,
  sorts,
  activeSort,
  resultCount,
  totalCount,
  noun,
  onFilterChange,
  onSortChange,
  onClearAll,
  extra,
}: FilterBarProps) {
  // Derived, never stored: this is what keeps the button and the count honest.
  const activeKeys = filters.filter((f) => (activeValues[f.key] ?? '') !== '')

  // Partition filters into primary (visible directly) and grouped (in category popups)
  const hasExplicitPrimary = filters.some((f) => f.primary !== undefined)

  let visibleFilters: FilterDef[] = []
  let categoryFilters: FilterDef[] = []

  if (hasExplicitPrimary) {
    visibleFilters = filters.filter((f) => f.primary)
    categoryFilters = filters.filter((f) => !f.primary)
  } else if (filters.length <= 3) {
    visibleFilters = filters
    categoryFilters = []
  } else {
    visibleFilters = filters.slice(0, 2)
    categoryFilters = filters.slice(2)
  }

  // Group category filters
  const groups: { category: string; filters: FilterDef[] }[] = []
  const groupMap = new Map<string, FilterDef[]>()

  for (const f of categoryFilters) {
    const cat = f.category || 'More filters'
    if (!groupMap.has(cat)) {
      const list: FilterDef[] = []
      groupMap.set(cat, list)
      groups.push({ category: cat, filters: list })
    }
    groupMap.get(cat)!.push(f)
  }

  const handleResetCategory = (catFilters: FilterDef[]) => {
    for (const f of catFilters) {
      if ((activeValues[f.key] ?? '') !== '') {
        onFilterChange(f.key, '')
      }
    }
  }

  return (
    <div className="filterbar">
      <fieldset className="filterbar__group">
        <legend className="filterbar__legend">Filter {noun.toLowerCase()}</legend>
        <div className="filterbar__controls">
          {visibleFilters.map((f) => (
            <div key={f.key} className="filterbar__field">
              <label className="filterbar__label" htmlFor={`filter-${f.key}`}>
                {f.label}
              </label>
              <select
                id={`filter-${f.key}`}
                className="input filterbar__select"
                value={activeValues[f.key] ?? ''}
                title={f.hint}
                onChange={(e) => onFilterChange(f.key, e.target.value)}
              >
                <option value="">All</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                    {typeof o.count === 'number' ? ` (${o.count})` : ''}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {groups.map((g) => (
            <CategoryFilterPopup
              key={g.category}
              category={g.category}
              filters={g.filters}
              activeValues={activeValues}
              onFilterChange={onFilterChange}
              onResetCategory={handleResetCategory}
            />
          ))}

          <div className="filterbar__field">
            <label className="filterbar__label" htmlFor="filter-sort">
              Sort by
            </label>
            <select
              id="filter-sort"
              className="input filterbar__select"
              value={activeSort}
              onChange={(e) => onSortChange(e.target.value)}
            >
              {sorts.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {extra}

          {activeKeys.length > 0 ? (
            <button
              type="button"
              className="btn btn--clear"
              // Every key is written on one state transition rather than one
              // `onFilterChange` per key. When the page syncs filters to the query
              // string that matters: each call rebuilds the params from the value
              // captured when the handler was created, so clearing two filters in a
              // loop would restore the first one and leave the list filtered.
              onClick={() => onClearAll()}
            >
              Clear {activeKeys.length} filter{activeKeys.length === 1 ? '' : 's'}
            </button>
          ) : null}
        </div>
      </fieldset>

      {/* Announced on every filter or sort change, so the outcome is heard. */}
      <p className="filterbar__result" role="status">
        Showing <strong>{resultCount}</strong> of {totalCount} {noun.toLowerCase()}
        {activeKeys.length > 0 ? ' matching the current filters' : ''}
      </p>
    </div>
  )
}