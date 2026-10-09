/**
 * Review UI vocabulary (Phase F brief §4, §6).
 *
 * Product terminology for the human review queue. Funding opportunities are
 * shown as Grants/Funds and procurement opportunities as RFPs/Notices; the
 * internal review-status and domain vocabularies stay out of sight. Every
 * status here corresponds exactly to a locked Phase E `ReviewStatus` — the UI
 * invents no statuses of its own.
 */

import type { DiscoveryDomain } from '../../automation/types'
import type { ReviewItem, ReviewStatus } from '../../automation/review-queue'
import { getRecord, titleOf } from '../../data/selectors'

/** Human label for each Phase E review status. */
export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  NEW: 'New',
  NEEDS_REVIEW: 'Needs review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  DUPLICATE: 'Duplicate',
  BLOCKED: 'Blocked',
}

export const DOMAIN_LABEL: Record<DiscoveryDomain, string> = {
  funding: 'Funding',
  procurement: 'Procurement',
}

/** The six queue filters. `all` shows every item; everything else is a status. */
export const REVIEW_FILTERS = [
  { slug: 'all', label: 'All', status: null },
  { slug: 'needs-review', label: 'Needs review', status: 'NEEDS_REVIEW' },
  { slug: 'approved', label: 'Approved', status: 'APPROVED' },
  { slug: 'rejected', label: 'Rejected', status: 'REJECTED' },
  { slug: 'duplicate', label: 'Duplicate', status: 'DUPLICATE' },
  { slug: 'blocked', label: 'Blocked', status: 'BLOCKED' },
] as const satisfies readonly { slug: string; label: string; status: ReviewStatus | null }[]

export type ReviewFilter = 'all' | ReviewStatus

/**
 * Resolves the `?status=` filter. The queue opens on Needs review by default;
 * an unknown value falls back to the same default rather than inventing a
 * status.
 */
export function resolveReviewFilter(slug: string | null): ReviewFilter {
  if (slug === null) return 'NEEDS_REVIEW'
  const found = REVIEW_FILTERS.find((filter) => filter.slug === slug)
  return found ? (found.status ?? 'all') : 'NEEDS_REVIEW'
}

/*
 * Display helpers. The candidate's flat fields already hold normalized values
 * (Phase C contract), so the normalization block is the display source of
 * truth, with a null-safe fallback. No value is ever fabricated: a source that
 * gave no date stays null.
 */

export function publicationDateOf(item: ReviewItem): string | null {
  return item.normalization?.publicationDate.normalized ?? null
}

export function deadlineOf(item: ReviewItem): string | null {
  return item.normalization?.deadline.normalized ?? null
}

/** Resolves a company id to its recorded name, falling back to the raw id. */
export function companyNameFor(companyId: string): string {
  const record = getRecord(companyId)
  return record ? titleOf(record) : companyId
}