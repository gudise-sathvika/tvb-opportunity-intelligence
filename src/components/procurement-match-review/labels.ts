/**
 * Procurement match review vocabulary (Phase Q).
 *
 * Review statuses, queue filters (Pending by default), proposal-status labels,
 * and the four PMATCH-RULES-v1 signal labels for the Procurement Match Review
 * pages, in the user-facing RFP terminology. The review statuses, filters, and
 * proposal-status labels are shared unchanged with the funding Match Review
 * pages (Phase M); only the signals and the source kind are procurement
 * specific. No scores, no confidence, no generated text anywhere.
 */

import type { ProcurementMatchSignalId } from '../../automation/procurement-proposal'
import { MATCH_REVIEW_FILTERS, PROPOSAL_STATUS_LABEL, resolveMatchReviewFilter } from '../match-review/labels'

/**
 * The procurement terms for a Notice: the user-facing RFP terminology used in
 * every column heading and section on these pages.
 */
export const RFP_LABEL = 'RFP'

export const PMATCH_REVIEW_FILTERS = MATCH_REVIEW_FILTERS

export const PMATCH_PROPOSAL_STATUS_LABEL = PROPOSAL_STATUS_LABEL

export function resolveProcurementReviewFilter(slug: string | null): 'all' | 'APPROVED' | 'REJECTED' | 'PENDING' {
  return resolveMatchReviewFilter(slug)
}

export const PMATCH_SIGNAL_LABEL: Record<ProcurementMatchSignalId, string> = {
  'industry-overlap': 'Industry overlap',
  'country-compatibility': 'Country compatibility',
  'keyword-overlap': 'Keyword overlap',
  'capability-overlap': 'Capability overlap',
}