/**
 * Match proposal human review — Phase M review states and decisions.
 *
 * A MatchReviewItem wraps one Phase L MatchProposal for a human verdict. The
 * proposal itself is carried verbatim and is never modified by a decision:
 * deciding produces a new item whose `proposal` is the same frozen object.
 * Review states are PENDING → APPROVED | REJECTED, terminal thereafter, with
 * an append-only audit trail. No automatic approval exists anywhere — every
 * decision requires an explicit reviewer and decided-at timestamp, which the
 * caller supplies (no clock runs inside this deterministic module).
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import type { MatchProposal } from './match-proposal'

export const MATCH_REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type MatchReviewStatus = (typeof MATCH_REVIEW_STATUSES)[number]

/** Terminal review states: once reached, no further transition exists. */
export const TERMINAL_MATCH_REVIEW_STATUSES: readonly MatchReviewStatus[] = ['APPROVED', 'REJECTED']

/** The complete, explicit transition table. Anything not listed is rejected. */
export const MATCH_REVIEW_TRANSITIONS: Readonly<Record<MatchReviewStatus, readonly MatchReviewStatus[]>> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
}

export function canMatchTransition(from: MatchReviewStatus, to: MatchReviewStatus): boolean {
  return MATCH_REVIEW_TRANSITIONS[from].includes(to)
}

export interface MatchReviewAuditEntry {
  proposalId: string
  previousStatus: MatchReviewStatus
  newStatus: MatchReviewStatus
  reviewerId: string
  decidedAt: string
  reason: string | null
}

export interface MatchReviewItem {
  /** The Phase L proposal under review — carried verbatim, never mutated. */
  proposal: MatchProposal
  companyName: string | null
  sourceName: string | null
  reviewStatus: MatchReviewStatus
  audit: readonly MatchReviewAuditEntry[]
  createdAt: string
  updatedAt: string
}

export interface MatchReviewItemOptions {
  companyName?: string | null
  sourceName?: string | null
  /** Explicit creation timestamp — the caller supplies it; this module runs no clock. */
  createdAt: string
}

export interface MatchReviewDecisionInput {
  proposalId: string
  decision: 'APPROVED' | 'REJECTED'
  reviewerId: string
  decidedAt: string
  reason?: string | null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
  const object = value as Record<string, unknown>
  for (const key of Object.keys(object)) {
    const child = object[key]
    if (child !== null && typeof child === 'object') deepFreeze(child)
  }
  return Object.freeze(object) as T
}

/**
 * Wraps a proposal as a pending review item. The proposal object is kept by
 * reference inside the frozen item — shared, never copied, never altered.
 */
export function createMatchReviewItem(proposal: MatchProposal, options: MatchReviewItemOptions): MatchReviewItem {
  if (proposal === null || typeof proposal !== 'object' || Array.isArray(proposal)) {
    throw new Error('match review requires a proposal object')
  }
  if (!isNonEmptyString(proposal.proposalId)) {
    throw new Error('match review requires a proposal with a proposalId')
  }
  if (!isNonEmptyString(options.createdAt)) {
    throw new Error('match review requires an explicit createdAt timestamp')
  }
  return deepFreeze({
    proposal,
    companyName: options.companyName ?? null,
    sourceName: options.sourceName ?? null,
    reviewStatus: 'PENDING' as const,
    audit: deepFreeze([]),
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
  })
}

function validateMatchReviewDecision(value: unknown): { ok: true } | { ok: false; errors: readonly string[] } {
  const errors: string[] = []
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['decision must be an object'] }
  }
  const record = value as Record<string, unknown>
  if (!isNonEmptyString(record.proposalId)) errors.push('missing required field: proposalId')
  if (record.decision !== 'APPROVED' && record.decision !== 'REJECTED') {
    errors.push(`invalid decision: ${String(record.decision)} (must be APPROVED or REJECTED)`)
  }
  if (!isNonEmptyString(record.reviewerId)) errors.push('a reviewer id is required to decide')
  if (!isNonEmptyString(record.decidedAt)) errors.push('a decided-at timestamp is required to decide')
  if (record.reason !== undefined && record.reason !== null && typeof record.reason !== 'string') {
    errors.push('field reason must be a string')
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true }
}

/**
 * Records a human decision on a pending item. The underlying proposal is
 * untouched — the returned item shares the identical proposal object — and
 * the audit trail only appends.
 */
export function applyMatchReviewDecision(item: MatchReviewItem, input: MatchReviewDecisionInput): MatchReviewItem {
  const validated = validateMatchReviewDecision(input)
  if (!validated.ok) {
    throw new Error(`invalid match review decision: ${validated.errors.join('; ')}`)
  }
  if (input.proposalId !== item.proposal.proposalId) {
    throw new Error(`decision proposalId ${input.proposalId} does not match review item ${item.proposal.proposalId}`)
  }
  if (!canMatchTransition(item.reviewStatus, input.decision)) {
    throw new Error(`invalid match review transition: ${item.reviewStatus} -> ${input.decision}`)
  }
  return deepFreeze({
    ...item,
    reviewStatus: input.decision,
    updatedAt: input.decidedAt,
    audit: deepFreeze([
      ...item.audit,
      {
        proposalId: item.proposal.proposalId,
        previousStatus: item.reviewStatus,
        newStatus: input.decision,
        reviewerId: input.reviewerId,
        decidedAt: input.decidedAt,
        reason: input.reason ?? null,
      },
    ]),
  })
}
