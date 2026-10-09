import { useState } from 'react'
import { useParams } from 'react-router-dom'
import BackNavigation from '../components/navigation/BackNavigation'
import MatchReviewDetailView from '../components/match-review/MatchReviewDetail'
import { MatchReviewStatusBadge } from '../components/match-review/MatchReviewStatusBadge'
import { matchReviewFixtureStore } from '../automation/match-review-fixture'
import type { MatchReviewItem } from '../automation/match-review'

export default function MatchReviewDetail() {
  const { proposalId } = useParams<{ proposalId: string }>()
  const [item, setItem] = useState<MatchReviewItem | undefined>(() =>
    matchReviewFixtureStore.item(proposalId ?? ''),
  )

  if (!item) {
    return (
      <section className="page">
        <h1 className="page__title">Match review item not found</h1>
        <div className="empty" role="alert">
          <p className="empty__headline">No match proposal with ID “{proposalId}”</p>
          <p className="empty__body">No match proposal with this ID is available.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="page">
      <nav className="crumbs" aria-label="Back">
        <BackNavigation to="/match-review" label="Match review queue" />
      </nav>

      <header className="page__header">
        <h1 className="page__title">Match review item</h1>
        <p className="page__badges">
          <MatchReviewStatusBadge status={item.reviewStatus} />
        </p>
      </header>

      <MatchReviewDetailView item={item} onDecided={(updated) => setItem(updated)} />
    </section>
  )
}