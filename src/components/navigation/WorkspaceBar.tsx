/**
 * The workspace bar: one compact tab row under the top navigation.
 *
 * It answers "where am I?" inside a workspace. Funding and Procurement each
 * own a tab row that mirrors their top-menu, so a reader who lands on any
 * subprocess — a collection, a review queue, a detail page — still sees the
 * workspace they are in and the sections beside the one they are reading.
 *
 * The discovery and human-review pages are shared by both workflows, so they
 * get a workflow strip instead of a workspace claim: Source discovery →
 * Human review → Match review, the automation pipeline stated as navigation
 * rather than as architecture.
 *
 * Every tab is a real link, so the bar is navigable, bookmarkable, and
 * carries `aria-current` the way a navigation should.
 */

import { Link, useLocation } from 'react-router-dom'

interface BarTab {
  label: string
  to: string
  active: boolean
}

interface Bar {
  key: string
  title: string
  ariaLabel: string
  tabs: BarTab[]
}

const startsWith = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`)

function barFor(pathname: string, search: string): Bar | null {
  const view = new URLSearchParams(search).get('view')

  if (startsWith(pathname, '/funding') || startsWith(pathname, '/opportunities') || startsWith(pathname, '/applications') || startsWith(pathname, '/match-review') || startsWith(pathname, '/matches')) {
    return {
      key: 'funding',
      title: 'Funding',
      ariaLabel: 'Funding workspace',
      tabs: [
        {
          label: 'Overview',
          to: '/funding',
          active: pathname === '/funding' && !view,
        },
        {
          label: 'Opportunities',
          to: '/opportunities',
          active: pathname === '/opportunities' || (pathname === '/funding' && Boolean(view)),
        },
        {
          label: 'Matches',
          to: '/matches',
          active: startsWith(pathname, '/matches') || startsWith(pathname, '/match-review'),
        },
        {
          label: 'Applications',
          to: '/applications',
          active: startsWith(pathname, '/applications'),
        },
      ],
    }
  }

  if (
    startsWith(pathname, '/procurement') ||
    startsWith(pathname, '/notices') ||
    startsWith(pathname, '/bids') ||
    startsWith(pathname, '/contracts')
  ) {
    return {
      key: 'procurement',
      title: 'Procurement',
      ariaLabel: 'Procurement workspace',
      tabs: [
        {
          label: 'Overview',
          to: '/procurement',
          active: pathname === '/procurement' && !view,
        },
        {
          label: 'RFPs',
          to: '/notices',
          active: pathname === '/notices' || (pathname === '/procurement' && Boolean(view)),
        },
        {
          label: 'Matches',
          to: '/procurement-match-review',
          active: startsWith(pathname, '/procurement-match-review'),
        },
        { label: 'Bids', to: '/bids', active: startsWith(pathname, '/bids') },
        { label: 'Contracts', to: '/contracts', active: startsWith(pathname, '/contracts') },
      ],
    }
  }

  if (startsWith(pathname, '/discovery') || startsWith(pathname, '/review')) {
    return {
      key: 'workflow',
      title: 'Discovery workflow',
      ariaLabel: 'Discovery workflow',
      tabs: [
        { label: 'Source discovery', to: '/discovery', active: startsWith(pathname, '/discovery') },
        { label: 'Human review', to: '/review', active: startsWith(pathname, '/review') },
        { label: 'Match review', to: '/match-review', active: false },
      ],
    }
  }

  return null
}

export default function WorkspaceBar() {
  const location = useLocation()
  const bar = barFor(location.pathname, location.search)
  if (!bar) return null

  return (
    <nav className="wbar" aria-label={bar.ariaLabel}>
      <div className="wbar__inner">
        <span className="wbar__title">{bar.title}</span>
        <div className="wbar__tabs">
          {bar.tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className={tab.active ? 'wbar__tab wbar__tab--active' : 'wbar__tab'}
              aria-current={tab.active ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}
