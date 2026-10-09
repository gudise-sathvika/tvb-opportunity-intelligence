import { useState } from 'react'
import { useParams } from 'react-router-dom'
import BackNavigation from '../components/navigation/BackNavigation'
import ProcurementMatchReviewDetailView from '../components/procurement-match-review/ProcurementMatchReviewDetail'
import { MatchReviewStatusBadge } from '../components/match-review/MatchReviewStatusBadge'
import { procurementMatchReviewFixtureStore } from '../automation/procurement-match-fixture'
import type { ProcurementMatchReviewItem } from '../automation/procurement-match-review'

export default function ProcurementMatchReviewDetail() {
  const { proposalId } = useParams<{ proposalId: string }>()
  const [item, setItem] = useState<ProcurementMatchReviewItem | undefined>(() =>
    procurementMatchReviewFixtureStore.item(proposalId ?? ''),
  )

  if (!item) {
    return (
      <section className="page">
        <h1 className="page__title">Procurement match review item not found</h1>
        <div className="empty" role="alert">
          <p className="empty__headline">No procurement match proposal with ID “{proposalId}”</p>
          <p className="empty__body">No procurement match proposal with this ID is available.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="page">
      <nav className="crumbs" aria-label="Back">
        <BackNavigation to="/procurement-match-review" label="Procurement match review queue" />
      </nav>

      <header className="page__header">
        <h1 className="page__title">Procurement match review item</h1>
        <p className="page__badges">
          <MatchReviewStatusBadge status={item.reviewStatus} />
        </p>
      </header>

      <ProcurementMatchReviewDetailView item={item} onDecided={(updated) => setItem(updated)} />
    </section>
  )
}