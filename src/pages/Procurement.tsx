import { Link, useLocation, useSearchParams } from 'react-router-dom'
import SegmentedTabs from '../components/navigation/SegmentedTabs'
import FlowStrip from '../components/navigation/FlowStrip'
import RfbTable from '../components/tables/RfbTable'
import OrganizationsTable from '../components/tables/OrganizationsTable'
import AutomationPanel from '../components/automation/AutomationPanel'
import { listBids, listContracts, listNotices } from '../data/selectors'

/**
 * Procurement — one workspace for the whole supply side of the money workflow.
 *
 * The default route (`/procurement`) is the workspace overview: the business
 * flow from RFP to contract, the snapshot counts, and the automation status.
 * The collections live one address deeper (`/notices`, and the RFP /
 * Organizations views behind it), so the historical record routes keep
 * working unchanged.
 */

function ProcurementOverview() {
  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Procurement</h1>
        <p className="page__description">
          Discover RFPs, evaluate relevance and manage bid decisions — from publication through
          contract, across every tracked company.
        </p>
      </header>

      <FlowStrip
        label="Procurement workflow"
        steps={[
          { label: 'RFPs', to: '/notices' },
          { label: 'Review', to: '/review' },
          { label: 'Match & bid decision', to: '/procurement-match-review' },
          { label: 'Bids', to: '/bids' },
          { label: 'Contracts', to: '/contracts' },
        ]}
      />

      <div className="overview">
        <section className="card">
          <h2 className="card__title">Workspace at a glance</h2>
          <div className="minigrid">
            <Link to="/notices" className="mini">
              <span className="mini__count">{listNotices().length}</span>
              <span className="mini__label">RFPs to respond to</span>
            </Link>
            <Link to="/bids" className="mini">
              <span className="mini__count">{listBids().length}</span>
              <span className="mini__label">bids in progress</span>
            </Link>
            <Link to="/contracts" className="mini">
              <span className="mini__count">{listContracts().length}</span>
              <span className="mini__label">contracts under management</span>
            </Link>
          </div>
          <p className="card__foot">Counts from the current data snapshot.</p>
        </section>

        <AutomationPanel domain="procurement" />
      </div>
    </section>
  )
}

export default function Procurement() {
  const [params] = useSearchParams()
  const location = useLocation()
  const view = params.get('view')

  // The hub route is the overview. The collection views — the historical
  // `/notices` path and `?view=` on the hub — keep the tables.
  const onCollection =
    location.pathname === '/notices' || view === 'rfb' || view === 'organizations'

  if (!onCollection) return <ProcurementOverview />

  const segment = view === 'organizations' ? 'organizations' : 'rfb'

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Procurement</h1>
        <p className="page__description">
          The procurement collection: the Organizations that buy and the RFPs (Requests for
          Proposals) they publish. An RFP can receive multiple Bids, and a Bid may lead to a
          Contract.
        </p>
      </header>

      <SegmentedTabs
        label="Procurement view"
        current={segment}
        segments={[
          { key: 'rfb', label: 'RFPs', to: '/notices' },
          { key: 'organizations', label: 'Organizations', to: '/procurement?view=organizations' },
        ]}
      />

      {segment === 'organizations' ? <OrganizationsTable headingAs="h2" /> : <RfbTable headingAs="h2" />}
    </section>
  )
}
