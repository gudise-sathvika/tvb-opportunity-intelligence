/**
 * Match review vocabulary (Phase M).
 *
 * Review statuses, queue filters (Pending by default), proposal-status labels,
 * and signal labels for the Match Review pages. No scores, no confidence, no
 * generated text anywhere.
 */

import type { MatchSignalId } from '../../automation/match-proposal'
import type { MatchProposalStatus } from '../../automation/match-proposal'
import type { MatchReviewStatus } from '../../automation/match-review'
import { MATCH_REVIEW_STATUSES } from '../../automation/match-review'

export const MATCH_REVIEW_FILTERS = [
  { slug: 'all', label: 'All', status: null },
  { slug: 'pending', label: 'Pending', status: 'PENDING' },
  { slug: 'approved', label: 'Approved', status: 'APPROVED' },
  { slug: 'rejected', label: 'Rejected', status: 'REJECTED' },
] as const satisfies readonly { slug: string; label: string; status: MatchReviewStatus | null }[]

export type MatchReviewFilter = 'all' | MatchReviewStatus

/**
 * Resolves the `?status=` filter. The queue opens on Pending by default; an
 * unknown value falls back to the same default rather than inventing a
 * status.
 */
export function resolveMatchReviewFilter(slug: string | null): MatchReviewFilter {
  if (slug === null) return 'PENDING'
  const found = MATCH_REVIEW_FILTERS.find((filter) => filter.slug === slug)
  return found ? (found.status ?? 'all') : 'PENDING'
}

export function matchReviewStatuses(): readonly MatchReviewStatus[] {
  return MATCH_REVIEW_STATUSES
}

export const MATCH_REVIEW_STATUS_LABEL: Record<MatchReviewStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
}

export const PROPOSAL_STATUS_LABEL: Record<MatchProposalStatus, string> = {
  PROPOSED: 'Proposed',
  INSUFFICIENT_EVIDENCE: 'Insufficient evidence',
  NOT_A_MATCH: 'Not a match',
}

export const MATCH_SIGNAL_LABEL: Record<MatchSignalId, string> = {
  'industry-overlap': 'Industry overlap',
  'country-compatibility': 'Country compatibility',
  'keyword-overlap': 'Keyword overlap',
}

export function sourceKindLabel(recordType: 'opportunity' | 'notice'): string {
  return recordType === 'opportunity' ? 'Grant' : 'RFP'
}
