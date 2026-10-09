import { Link } from 'react-router-dom'

export interface Segment {
  key: string
  label: string
  /** Full path including the query string, e.g. `/funding?view=organizations`. */
  to: string
}

/**
 * A link-driven segmented control for switching a hub's view.
 *
 * Each option is a real link, so a chosen view is part of the address and can be
 * shared, bookmarked, and reached with the browser back button — the same
 * principle as the URL-carrying filters on the list tables.
 */
export default function SegmentedTabs({
  label,
  current,
  segments,
}: {
  label: string
  current: string
  segments: Segment[]
}) {
  return (
    <nav className="segmented" aria-label={label}>
      {segments.map((s) => {
        const active = s.key === current
        return (
          <Link
            key={s.key}
            to={s.to}
            className={active ? 'segmented__item segmented__item--active' : 'segmented__item'}
            aria-current={active ? 'page' : undefined}
          >
            {s.label}
          </Link>
        )
      })}
    </nav>
  )
}
