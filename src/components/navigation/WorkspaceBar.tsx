import { Link, useLocation } from 'react-router-dom'

const TABS = [
  { label: 'Discovery', view: 'discovery' },
  { label: 'Human Review', view: 'human-review' },
  { label: 'Funding Review', view: 'funding-review' },
  { label: 'Procurement Review', view: 'procurement-review' },
  { label: 'Approved', view: 'approved' },
] as const

export default function WorkspaceBar() {
  const { pathname, search } = useLocation()
  if (!pathname.startsWith('/discovery')) return null

  const params = new URLSearchParams(search)
  const currentView = params.get('view') ?? (pathname.includes('/review/') ? 'human-review' : 'discovery')

  return (
    <nav className="wbar" aria-label="Discovery workspace">
      <div className="wbar__inner">
        <span className="wbar__title">Discovery</span>
        <div className="wbar__tabs">
          {TABS.map((tab) => {
            const query = new URLSearchParams()
            if (tab.view !== 'discovery') query.set('view', tab.view)
            if (tab.view === 'approved') query.set('status', 'approved')
            if (params.get('demo') === '1') query.set('demo', '1')
            const to = query.size > 0 ? `/discovery?${query.toString()}` : '/discovery'
            const active = currentView === tab.view
            return (
              <Link
                key={tab.view}
                to={to}
                className={active ? 'wbar__tab wbar__tab--active' : 'wbar__tab'}
                aria-current={active ? 'page' : undefined}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
