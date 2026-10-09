/**
 * Procurement match proposal human review — Phase Q review states and decisions.
 *
 * A ProcurementMatchReviewItem wraps one Phase Q ProcurementMatchProposal for
 * a human verdict. The proposal itself is carried verbatim and is never
 * modified by a decision: deciding produces a new item whose `proposal` is the
 * same frozen object. Review states are PENDING → APPROVED | REJECTED,
 * terminal thereafter, with an append-only audit trail. No automatic approval
 * exists anywhere — every decision requires an explicit reviewer and decided-at
 * timestamp, which the caller supplies (no clock runs inside this
 * deterministic module).
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import type { ProcurementMatchProposal } from './procurement-proposal'

export const PMATCH_REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type ProcurementMatchReviewStatus = (typeof PMATCH_REVIEW_STATUSES)[number]

/** Terminal review states: once reached, no further transition exists. */
export const TERMINAL_PMATCH_REVIEW_STATUSES: readonly ProcurementMatchReviewStatus[] = ['APPROVED', 'REJECTED']

/** The complete, explicit transition table. Anything not listed is rejected. */
export const PMATCH_REVIEW_TRANSITIONS: Readonly<Record<ProcurementMatchReviewStatus, readonly ProcurementMatchReviewStatus[]>> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
}

export function canProcurementMatchTransition(
  from: ProcurementMatchReviewStatus,
  to: ProcurementMatchReviewStatus,
): boolean {
  return PMATCH_REVIEW_TRANSITIONS[from].includes(to)
}

export interface ProcurementMatchReviewAuditEntry {
  proposalId: string
  previousStatus: ProcurementMatchReviewStatus
  newStatus: ProcurementMatchReviewStatus
  reviewerId: string
  decidedAt: string
  reason: string | null
}

export interface ProcurementMatchReviewItem {
  /** The Phase Q proposal under review — carried verbatim, never mutated. */
  proposal: ProcurementMatchProposal
  noticeName: string | null
  companyName: string | null
  reviewStatus: ProcurementMatchReviewStatus
  audit: readonly ProcurementMatchReviewAuditEntry[]
  createdAt: string
  updatedAt: string
}

export interface ProcurementMatchReviewItemOptions {
  noticeName?: string | null
  companyName?: string | null
  /** Explicit creation timestamp — the caller supplies it; this module runs no clock. */
  createdAt: string
}

export interface ProcurementMatchReviewDecisionInput {
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
export function createProcurementMatchReviewItem(
  proposal: ProcurementMatchProposal,
  options: ProcurementMatchReviewItemOptions,
): ProcurementMatchReviewItem {
  if (proposal === null || typeof proposal !== 'object' || Array.isArray(proposal)) {
    throw new Error('procurement match review requires a proposal object')
  }
  if (!isNonEmptyString(proposal.proposalId)) {
    throw new Error('procurement match review requires a proposal with a proposalId')
  }
  if (!isNonEmptyString(options.createdAt)) {
    throw new Error('procurement match review requires an explicit createdAt timestamp')
  }
  return deepFreeze({
    proposal,
    noticeName: options.noticeName ?? null,
    companyName: options.companyName ?? null,
    reviewStatus: 'PENDING' as const,
    audit: deepFreeze([]),
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
  })
}

function validateProcurementMatchReviewDecision(
  value: unknown,
): { ok: true } | { ok: false; errors: readonly string[] } {
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
export function applyProcurementMatchReviewDecision(
  item: ProcurementMatchReviewItem,
  input: ProcurementMatchReviewDecisionInput,
): ProcurementMatchReviewItem {
  const validated = validateProcurementMatchReviewDecision(input)
  if (!validated.ok) {
    throw new Error(`invalid procurement match review decision: ${validated.errors.join('; ')}`)
  }
  if (input.proposalId !== item.proposal.proposalId) {
    throw new Error(`decision proposalId ${input.proposalId} does not match review item ${item.proposal.proposalId}`)
  }
  if (!canProcurementMatchTransition(item.reviewStatus, input.decision)) {
    throw new Error(`invalid procurement match review transition: ${item.reviewStatus} -> ${input.decision}`)
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