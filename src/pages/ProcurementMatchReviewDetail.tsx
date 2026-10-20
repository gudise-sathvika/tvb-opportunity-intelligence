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
import {
  loadProcurementMatchReviewItems,
  updateProcurementMatchReviewItem,
} from '../target-companies/procurement-match-review-store'

export default function ProcurementMatchReviewDetail() {
  const { proposalId } = useParams<{ proposalId: string }>()
  const [params] = useSearchParams()
  const demo = isDemoMatchReviewRequest(params.get(MATCH_REVIEW_DEMO_PARAM))
  const [item, setItem] = useState<ProcurementMatchReviewItem | undefined>(() =>
    demo
      ? procurementMatchReviewFixtureStore.item(proposalId ?? '')
      : loadProcurementMatchReviewItems().find((entry) => entry.proposal.proposalId === proposalId),
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
          to={
            demo
              ? `/procurement-match-review?${MATCH_REVIEW_DEMO_PARAM}=${MATCH_REVIEW_DEMO_VALUE}`
              : '/procurement-match-review'
          }
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

      <ProcurementMatchReviewDetailView
        item={item}
        demo={demo}
        onDecided={(updated) => {
          if (demo) {
            const decision = updated.audit[updated.audit.length - 1]
            if (!decision) throw new Error('The procurement match review decision has no audit entry.')
            if (decision.newStatus === 'PENDING') {
              throw new Error('The procurement match review decision is not final.')
            }
            procurementMatchReviewFixtureStore.apply({
              proposalId: updated.proposal.proposalId,
              decision: decision.newStatus,
              reviewerId: decision.reviewerId,
              decidedAt: decision.decidedAt,
              reason: decision.reason,
            })
          } else if (!updateProcurementMatchReviewItem(updated)) {
            throw new Error('The procurement match review decision could not be persisted in browser storage.')
          }
          setItem(updated)
        }}
      />
    </section>
  )
}