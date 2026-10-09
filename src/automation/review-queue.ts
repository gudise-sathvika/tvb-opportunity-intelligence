/**
 * Phase E human review queue (Phase E brief §1–§11, §14–§15).
 *
 * The queue is the mandatory, human-gated approval boundary between discovery
 * and any future Vault-write stage. It converts discovery candidates into
 * immutable review items, records human decisions against those items, and
 * keeps a full audit trail — without ever writing to the vault, generating
 * reviewer identity, or automatically approving anything.
 *
 * Determinism rules:
 *  - review ids derive from the candidate (never random);
 *  - timestamps come from the caller or the candidate's own provenance — the
 *    queue reads no clock, so `createdAt`/`updatedAt` mirror caller input;
 *  - `reviewStatus` is a pure function of the candidate's status at
 *    conversion, and only the guarded transitions below (§5) can change it.
 *
 * CandidateStatus and ReviewStatus are conceptually separate vocabularies: a
 * review decision changes the review item's `reviewStatus`, never the frozen
 * candidate snapshot carried inside the item.
 */

import type {
  CandidateProvenance,
  CandidateState,
  CandidateType,
  ClassificationMetadata,
  DiscoveryCandidate,
  DuplicateMetadata,
  NormalizationMetadata,
} from './candidate'
import { deepFreeze } from './candidate'
import type { DiscoveryDomain } from './types'

/* ------------------------------------------------------------------ */
/* Review status vocabulary                                             */
/* ------------------------------------------------------------------ */

/**
 * The only review statuses this phase knows. Deliberately NOT the candidate
 * vocabulary (NORMALIZED / REVIEW do not exist here): a review item's status
 * describes its place in the human queue, while `candidateStatus` on the item
 * is an immutable snapshot of the candidate it wraps.
 */
export const REVIEW_STATUSES = [
  'NEW',
  'NEEDS_REVIEW',
  'APPROVED',
  'REJECTED',
  'DUPLICATE',
  'BLOCKED',
] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** Terminal review statuses: once reached, no further transition exists. */
export const TERMINAL_REVIEW_STATUSES: readonly ReviewStatus[] = ['APPROVED', 'REJECTED', 'DUPLICATE', 'BLOCKED']

/* ------------------------------------------------------------------ */
/* Allowed state transitions                                            */
/* ------------------------------------------------------------------ */

/**
 * The complete, explicit transition table (brief §5). Anything not listed
 * here is rejected — there is no arbitrary status mutation.
 */
export const REVIEW_TRANSITIONS: Readonly<Record<ReviewStatus, readonly ReviewStatus[]>> = {
  NEW: ['NEEDS_REVIEW'],
  NEEDS_REVIEW: ['APPROVED', 'REJECTED', 'DUPLICATE', 'BLOCKED'],
  APPROVED: [],
  REJECTED: [],
  DUPLICATE: [],
  BLOCKED: [],
}

export function nextReviewStatuses(from: ReviewStatus): readonly ReviewStatus[] {
  return REVIEW_TRANSITIONS[from]
}

export function canTransition(from: ReviewStatus, to: ReviewStatus): boolean {
  return REVIEW_TRANSITIONS[from].includes(to)
}

/* ------------------------------------------------------------------ */
/* Review item contract                                                 */
/* ------------------------------------------------------------------ */

/**
 * One immutable audit entry. Every decision writes exactly one entry and the
 * original history is never overwritten.
 */
export interface ReviewAuditEntry {
  previousStatus: ReviewStatus
  newStatus: ReviewStatus
  reviewerId: string
  decidedAt: string
  reason: string | null
  evidenceNotes: string | null
}

/**
 * A review item wraps one discovery candidate for human review. It carries the
 * full candidate snapshot (status, classification, normalization, duplicate
 * evidence, provenance) untouched, plus the queue's own review status,
 * `audit` history, and creation/update timestamps.
 */
export interface ReviewItem {
  reviewId: string
  candidateId: string
  discoveryRunId: string
  companyId: string
  discoveryProfileId: string
  domain: DiscoveryDomain
  sourceId: string
  sourceRecordId: string | null
  sourceUrl: string
  sourceTitle: string
  candidateType: CandidateType
  candidateStatus: CandidateState
  classification: ClassificationMetadata | null
  normalization: NormalizationMetadata | null
  duplicate: DuplicateMetadata | null
  provenance: CandidateProvenance
  reviewStatus: ReviewStatus
  audit: readonly ReviewAuditEntry[]
  createdAt: string
  updatedAt: string
}

export interface ReviewItemOptions {
  reviewId?: string
  createdAt?: string
}

export interface ReviewQueueOptions {
  createdAt?: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Deterministic review id derivation (brief §1). The base id is
 * `RI:<candidateId>:<candidateStatus>`, which keeps a Phase C duplicate twin
 * (same candidateId, different candidateStatus) distinct from its canonical
 * record — the DUPLICATE item must stay in the queue for human confirmation.
 * `occurrence` is an explicit disambiguator for the rare case where two
 * candidates are byte-identical snapshots; `createReviewQueue` supplies it.
 */
export function reviewIdFor(candidateId: string, candidateStatus: CandidateState, occurrence = 0): string {
  const base = `RI:${candidateId}:${candidateStatus}`
  return occurrence === 0 ? base : `${base}#${occurrence}`
}

/**
 * Maps a candidate's status to its review status at queue creation (brief §3).
 * Everything that needs a human eye → NEEDS_REVIEW; Phase C verdicts that are
 * already terminal (DUPLICATE / BLOCKED) and prior human verdicts
 * (APPROVED / REJECTED) are preserved as-is. No candidate is ever
 * automatically approved, and an approved/rejected candidate can never
 * silently return to NEW.
 */
export function reviewStatusForCandidate(candidate: DiscoveryCandidate): ReviewStatus {
  switch (candidate.candidateStatus) {
    case 'NEW':
    case 'NORMALIZED':
    case 'REVIEW':
      return 'NEEDS_REVIEW'
    case 'DUPLICATE':
      return 'DUPLICATE'
    case 'BLOCKED':
      return 'BLOCKED'
    case 'APPROVED':
      return 'APPROVED'
    case 'REJECTED':
      return 'REJECTED'
  }
}

/**
 * Converts ONE candidate into a review item. Pure: the candidate object is
 * never mutated, every candidate field is carried verbatim, and the result is
 * deeply frozen. The domain guard rejects a candidate whose own domain
 * disagrees with its provenance — a silent relabel is never allowed.
 */
export function createReviewItem(candidate: DiscoveryCandidate, options: ReviewItemOptions = {}): ReviewItem {
  if (!isNonEmptyString(candidate.candidateId)) {
    throw new Error('cannot create a review item without a candidateId')
  }
  if (candidate.domain !== candidate.provenance.domain) {
    throw new Error(
      `candidate ${candidate.candidateId} has domain ${candidate.domain} but provenance domain ${candidate.provenance.domain}`,
    )
  }

  const createdAt = options.createdAt ?? candidate.provenance.requestedAt
  return deepFreeze({
    reviewId: options.reviewId ?? reviewIdFor(candidate.candidateId, candidate.candidateStatus),
    candidateId: candidate.candidateId,
    discoveryRunId: candidate.discoveryRunId,
    companyId: candidate.companyId,
    discoveryProfileId: candidate.discoveryProfileId,
    domain: candidate.domain,
    sourceId: candidate.sourceId,
    sourceRecordId: candidate.sourceRecordId,
    sourceUrl: candidate.sourceUrl,
    sourceTitle: candidate.sourceTitle,
    candidateType: candidate.candidateType,
    candidateStatus: candidate.candidateStatus,
    classification: candidate.classification,
    normalization: candidate.normalization,
    duplicate: candidate.duplicate,
    provenance: candidate.provenance,
    reviewStatus: reviewStatusForCandidate(candidate),
    audit: deepFreeze([]),
    createdAt,
    updatedAt: createdAt,
  })
}

/**
 * Converts every candidate from a discovery run into review items, preserving
 * input order. No candidate is dropped or merged: a Phase C duplicate twin is
 * kept as its own DUPLICATE item. Review ids are guaranteeed unique by
 * occurrence-indexing byte-identical snapshots.
 */
export function createReviewQueue(
  candidates: readonly DiscoveryCandidate[],
  options: ReviewQueueOptions = {},
): readonly ReviewItem[] {
  const occurrences = new Map<string, number>()
  const items: ReviewItem[] = []
  for (const candidate of candidates) {
    const key = `${candidate.candidateId}:${candidate.candidateStatus}`
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    items.push(createReviewItem(candidate, { createdAt: options.createdAt, reviewId: reviewIdFor(candidate.candidateId, candidate.candidateStatus, occurrence) }))
  }
  return deepFreeze(items)
}

/**
 * Phase 22 (from Phase 21E): narrows a review-item list to exactly ONE run.
 *
 * The Human review store is cumulative (seeded fixtures + every run), so the
 * run handoff link carries the run id to scope what the reviewer sees. A run's
 * items carry either the run id or a per-company child id (`<runId>-<company>`)
 * on `discoveryRunId` and `provenance.runId`; fixtures (and any other run) are
 * excluded. This is a pure filter — it never mutates or deletes anything.
 */
export function filterReviewItemsByRun(items: readonly ReviewItem[], runId: string): readonly ReviewItem[] {
  const trimmed = runId.trim()
  if (trimmed === '') return items
  const matches = (value: string): boolean => value === trimmed || value.startsWith(`${trimmed}-`)
  return items.filter((item) => matches(item.discoveryRunId) || matches(item.provenance.runId))
}

/* ------------------------------------------------------------------ */
/* Review decision contract                                             */
/* ------------------------------------------------------------------ */

export const REVIEW_DECISIONS = ['APPROVED', 'REJECTED', 'DUPLICATE', 'BLOCKED'] as const
export type ReviewDecisionKind = (typeof REVIEW_DECISIONS)[number]

/**
 * A human's decision against one review item. `reviewerId` and `decidedAt`
 * are required and always come from the caller — the queue never generates a
 * reviewer identity. `reason` / `evidenceNotes` are optional free text.
 */
export interface ReviewDecision {
  reviewId: string
  decision: ReviewDecisionKind
  reviewerId: string
  decidedAt: string
  reason: string | null
  evidenceNotes: string | null
}

export interface ReviewDecisionInput {
  reviewId: string
  decision: ReviewDecisionKind
  reviewerId: string
  decidedAt: string
  reason?: string | null
  evidenceNotes?: string | null
}

export type ReviewDecisionValidation =
  | { ok: true; decision: ReviewDecision }
  | { ok: false; errors: readonly string[] }

export function validateReviewDecision(value: unknown): ReviewDecisionValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['review decision must be an object'] }
  }
  const record = value as Record<string, unknown>
  const errors: string[] = []

  for (const field of ['reviewId', 'reviewerId', 'decidedAt']) {
    if (!isNonEmptyString(record[field])) {
      errors.push(`missing required field: ${field}`)
    }
  }
  if (record.decision !== undefined && !(REVIEW_DECISIONS as readonly string[]).includes(record.decision as string)) {
    errors.push(
      `invalid decision: ${String(record.decision)} (must be APPROVED, REJECTED, DUPLICATE, or BLOCKED)`,
    )
  }
  for (const field of ['reason', 'evidenceNotes']) {
    const value = record[field]
    if (value !== undefined && value !== null && typeof value !== 'string') {
      errors.push(`field ${field} must be a string or null`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  const decision: ReviewDecision = {
    reviewId: String(record.reviewId),
    decision: record.decision as ReviewDecisionKind,
    reviewerId: String(record.reviewerId),
    decidedAt: String(record.decidedAt),
    reason: record.reason === undefined || record.reason === null ? null : String(record.reason),
    evidenceNotes: record.evidenceNotes === undefined || record.evidenceNotes === null ? null : String(record.evidenceNotes),
  }
  return { ok: true, decision: deepFreeze(decision) }
}

/**
 * Applies a human decision to a review item and returns a NEW item — the input
 * item is never mutated. Guards, in order:
 *  1. the decision must itself be valid (identity + decision + reviewer);
 *  2. the decision must target this review item;
 *  3. the transition must be allowed by the review table (only NEEDS_REVIEW
 *     items may be decided, and only to APPROVED / REJECTED / DUPLICATE /
 *     BLOCKED).
 * The resulting item carries one appended audit entry; nothing is overwritten.
 */
export function applyReviewDecision(item: ReviewItem, input: ReviewDecisionInput): ReviewItem {
  const validated = validateReviewDecision(input)
  if (!validated.ok) {
    throw new Error(`invalid review decision: ${validated.errors.join('; ')}`)
  }
  const decision = validated.decision

  if (decision.reviewId !== item.reviewId) {
    throw new Error(`decision reviewId ${decision.reviewId} does not match review item ${item.reviewId}`)
  }
  if (!canTransition(item.reviewStatus, decision.decision)) {
    throw new Error(`invalid review transition: ${item.reviewStatus} -> ${decision.decision}`)
  }

  return deepFreeze({
    ...item,
    reviewStatus: decision.decision,
    updatedAt: decision.decidedAt,
    audit: deepFreeze([
      ...item.audit,
      {
        previousStatus: item.reviewStatus,
        newStatus: decision.decision,
        reviewerId: decision.reviewerId,
        decidedAt: decision.decidedAt,
        reason: decision.reason,
        evidenceNotes: decision.evidenceNotes,
      },
    ]),
  })
}