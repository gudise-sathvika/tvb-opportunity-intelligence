import type { MatchReviewStatus } from '../../automation/match-review'

/** Review-status badge: text is the meaning, tone is a secondary cue. */
export function MatchReviewStatusBadge({ status }: { status: MatchReviewStatus }) {
  const modifier = status === 'PENDING' ? 'mr-badge--pending' : status === 'APPROVED' ? 'rv-badge--approved' : 'rv-badge--rejected'
  const label = status === 'PENDING' ? 'Pending' : status === 'APPROVED' ? 'Approved' : 'Rejected'
  return <span className={`rv-badge ${modifier}`}>{label}</span>
}
