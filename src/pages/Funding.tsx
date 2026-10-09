import { Link, useLocation, useSearchParams } from 'react-router-dom'
import SegmentedTabs from '../components/navigation/SegmentedTabs'
import FlowStrip from '../components/navigation/FlowStrip'
import GrantsTable from '../components/tables/GrantsTable'
import OrganizationsTable from '../components/tables/OrganizationsTable'
import AutomationPanel from '../components/automation/AutomationPanel'
import { listApplications, listMatches, listOpportunities } from '../data/selectors'

/**
 * Funding — one workspace for the whole demand side of the money workflow.
 *
 * The default route (`/funding`) is the workspace overview: what the workflow
 * is, where each step lives, the snapshot counts, and the automation status.
 * The collections live one address deeper (`/opportunities`, and the Grants /
 * Organizations views behind it), so the historical record routes keep working
 * unchanged while the workspace reads as one coherent product surface.
 */

function FundingOverview() {
  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Funding</h1>
        <p className="page__description">
          Discover grants, subsidies and funding programs — then review, match, and pursue them
          across every tracked company.
        </p>
      </header>

      <FlowStrip
        label="Funding workflow"
        steps={[
          { label: 'Discover', to: '/discovery' },
          { label: 'Review', to: '/review' },
          { label: 'Match', to: '/match-review' },
          { label: 'Apply', to: '/applications' },
        ]}
      />

      <div className="overview">
        <section className="card">
          <h2 className="card__title">Workspace at a glance</h2>
          <div className="minigrid">
            <Link to="/opportunities" className="mini">
              <span className="mini__count">{listOpportunities().length}</span>
              <span className="mini__label">opportunities to evaluate</span>
            </Link>
            <Link to="/matches" className="mini">
              <span className="mini__count">{listMatches().length}</span>
              <span className="mini__label">company matches recorded</span>
            </Link>
            <Link to="/applications" className="mini">
              <span className="mini__count">{listApplications().length}</span>
              <span className="mini__label">applications in progress</span>
            </Link>
          </div>
          <p className="card__foot">Counts from the current data snapshot.</p>
        </section>

        <AutomationPanel domain="funding" />
      </div>
    </section>
  )
}

export default function Funding() {
  const [params] = useSearchParams()
  const location = useLocation()
  const view = params.get('view')

  // The hub route is the overview. The collection views — the historical
  // `/opportunities` path and `?view=` on the hub — keep the tables.
  const onCollection =
    location.pathname === '/opportunities' || view === 'grants' || view === 'organizations'

  if (!onCollection) return <FundingOverview />

  const segment = view === 'organizations' ? 'organizations' : 'grants'

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Funding</h1>
        <p className="page__description">
          The Grants and the Organizations that provide them. A Grant can be evaluated through
          Matches and pursued through Applications.
        </p>
      </header>

      <SegmentedTabs
        label="Funding view"
        current={segment}
        segments={[
          { key: 'grants', label: 'Grants', to: '/opportunities' },
          { key: 'organizations', label: 'Organizations', to: '/funding?view=organizations' },
        ]}
      />

      {segment === 'organizations' ? <OrganizationsTable headingAs="h2" /> : <GrantsTable headingAs="h2" />}
    </section>
  )
}
