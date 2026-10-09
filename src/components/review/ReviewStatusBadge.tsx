import type { ReviewStatus } from '../../automation/review-queue'
import { REVIEW_STATUS_LABEL } from './labels'

/**
 * Review-status badge. Every status is always announced by its text label —
 * tone is a secondary cue, never the only one.
 */
const TONES: Record<ReviewStatus, string> = {
  NEW: 'rv-badge rv-badge--new',
  NEEDS_REVIEW: 'rv-badge rv-badge--needs',
  APPROVED: 'rv-badge rv-badge--approved',
  REJECTED: 'rv-badge rv-badge--rejected',
  DUPLICATE: 'rv-badge rv-badge--duplicate',
  BLOCKED: 'rv-badge rv-badge--blocked',
}

export function ReviewStatusBadge({ status, title }: { status: ReviewStatus; title?: string }) {
  return (
    <span className={TONES[status]} title={title ?? `Review status: ${REVIEW_STATUS_LABEL[status]}`}>
      {REVIEW_STATUS_LABEL[status]}
    </span>
  )
}