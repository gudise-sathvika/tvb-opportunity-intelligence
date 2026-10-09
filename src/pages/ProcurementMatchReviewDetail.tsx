import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import BackNavigation from '../components/navigation/BackNavigation'
import ProcurementMatchReviewDetailView from '../components/procurement-match-review/ProcurementMatchReviewDetail'
import { MatchReviewStatusBadge } from '../components/match-review/MatchReviewStatusBadge'
import { procurementMatchReviewFixtureStore } from '../automation/procurement-match-fixture'
import {
  MATCH_REVIEW_DEMO_PARAM,
  MATCH_REVIEW_DEMO_VALUE,
  isDemoMatchReviewRequest,
} from '../automation/match-review-source'
import type { ProcurementMatchReviewItem } from '../automation/procurement-match-review'

export default function ProcurementMatchReviewDetail() {
  const { proposalId } = useParams<{ proposalId: string }>()
  const [params] = useSearchParams()
  const demo = isDemoMatchReviewRequest(params.get(MATCH_REVIEW_DEMO_PARAM))
  const [item, setItem] = useState<ProcurementMatchReviewItem | undefined>(() =>
    demo ? procurementMatchReviewFixtureStore.item(proposalId ?? '') : undefined,
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
        <BackNavigation
          to={`/procurement-match-review?${MATCH_REVIEW_DEMO_PARAM}=${MATCH_REVIEW_DEMO_VALUE}`}
          label="Procurement match review queue"
        />
      </nav>

      <header className="page__header">
        <h1 className="page__title">Procurement match review item</h1>
        <p className="page__badges">
          <MatchReviewStatusBadge status={item.reviewStatus} />
        </p>
      </header>

      <div className="mr-demo" role="note" data-testid="procurement-match-review-demo-banner">
        <strong className="mr-demo__label">Demo data.</strong> This fixture proposal uses
        demonstration records. It is not a real match and appears only in demo mode.
      </div>

      <ProcurementMatchReviewDetailView item={item} onDecided={(updated) => setItem(updated)} />
    </section>
  )
}