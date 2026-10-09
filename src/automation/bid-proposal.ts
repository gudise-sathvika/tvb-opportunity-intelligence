/**
 * ProcurementMatch → Bid decision boundary — Phase R.
 *
 * THE BUSINESS RULE: an APPROVED ProcurementMatch means "this RFP may be
 * relevant to this company". It does NOT mean "the company will bid". A
 * separate HUMAN Bid decision (`BID` | `DO_NOT_BID`) is the only thing that
 * may produce a Bid proposal, and even then the output is a dry-run proposal:
 * this module writes nothing and creates no record.
 *
 *  - Approved ProcurementMatch + BID      → a deterministic Bid proposal;
 *  - Approved ProcurementMatch + DO_NOT_BID → no Bid proposal (`no_bid`);
 *  - Pending or Rejected ProcurementMatch → rejected (approval is a hard gate);
 *  - an APPROVED item whose human approval has no reviewer/decided-at → rejected;
 *  - a derived bid id or a notice×company pair that already has a Bid → `conflict`,
 *    never an overwrite.
 *
 * EXISTING Bid schema, reused unchanged (no schema change in this phase):
 * the Bid's Axis-2 decision field `bid_decision` already carries the exact
 * vocabulary the business rule needs (`Bid`, `No bid`). That axis is reused —
 * `bid_decision: 'Bid'` records the human BID choice on the proposal, and
 * `bid_decision_date` / `decided_by` (existing optional fields) carry the
 * human decision's own timestamp and decision-maker. `bid_status` uses the
 * vocabulary's workflow-neutral start (`Researching`, the first lifecycle
 * value) and `eligibility_status` is `Not assessed` — NO eligibility fact is
 * invented. Submission and commercial fields stay absent and are listed in
 * `manualFields`; the required identity links (`notice`, `company`) are built
 * only from the review item's own ids and names, never guessed.
 *
 * Determinism: the bid id derives from the match proposal id exactly as the
 * Phase Q ProcurementMatch id does — equal inputs produce equal proposals and
 * equal verdicts, with no randomness, clock, filesystem, or network. The
 * caller supplies decidedAt; nothing here reads a clock.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only;
 *  - the proposed payload contains no Contract, Application, or funding Match
 *    shape, and no Contract is ever produced.
 */

import { stableHash } from './candidate'
import type { ProcurementMatchReviewItem } from './procurement-match-review'

/** The two explicit human Bid decisions (business rule, Phase R). */
export const BID_DECISIONS = ['BID', 'DO_NOT_BID'] as const
export type BidDecision = (typeof BID_DECISIONS)[number]

/** Schema-approved workflow truths, reused from the existing Bid vocabulary:
 *  `bid_decision` is the Axis-2 go/no-go decision; `Researching` is the first
 *  lifecycle value and the neutral start of a freshly proposed bid; `Not
 *  assessed` states that no eligibility assessment has happened yet — any
 *  other eligibility value would be an invented fact. */
export const BID_DECISION_VALUE = 'Bid'
export const NO_BID_DECISION_VALUE = 'No bid'
export const DEFAULT_BID_STATUS = 'Researching'
export const DEFAULT_ELIGIBILITY_STATUS = 'Not assessed'

/**
 * Existing Bid fields that a fresh proposal can never truthfully fill. They
 * are the company's own commercial and planning work and are REPORTED as
 * remaining manual rather than invented. `bid_submission_datetime` is the
 * notice cutoff in text; `requisite` amounts and scores are the bid sheet's.
 */
export const MANUAL_BID_FIELDS: readonly string[] = [
  'quoted_value',
  'quoted_currency',
  'bid_submission_date',
  'bid_submission_datetime',
  'technical_score',
  'financial_score',
  'security_posted_status',
  'award_date',
]

export interface BidProposalRequest {
  /** The review item R being decided — its APPROVED status gates the proposal. */
  item: ProcurementMatchReviewItem
  decision: BidDecision
  /** The human decision-maker (the reviewer is who approved; the decider is who chose to bid). */
  deciderId: string
  /** When the human made the Bid decision — caller-supplied, no clock inside. */
  decidedAt: string
  /** Existing Bid identities — the ONLY record knowledge allowed in. */
  existingBidIds: readonly string[]
  /** Existing notice×company bid pairs as `noticeId|companyId` keys. */
  existingBidPairs: readonly string[]
}

export type BidProposalResult =
  | {
      outcome: 'proposed'
      bidId: string
      /** The exact frontmatter payload a future controlled writer would file. */
      payload: Readonly<Record<string, unknown>>
      /** Schema-required fields the proposal cannot fill (identity links only). */
      missingRequiredFields: readonly string[]
      /** Existing fields deliberately left blank; see MANUAL_BID_FIELDS. */
      manualFields: readonly string[]
    }
  | {
      outcome: 'no_bid'
      reason: string
    }
  | {
      outcome: 'conflict'
      bidId: string
      reason: string
    }
  | {
      outcome: 'rejected'
      reason: string
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

/** Derives a deterministic `BID-###` from the match proposal id — same FNV-1a
 *  derivation the Phase Q ProcurementMatch boundary uses. */
export function deriveBidId(proposalId: string): string {
  const numeric = parseInt(stableHash(proposalId).slice(0, 8), 16)
  return `BID-${String((numeric % 900) + 100)}`
}

/** The latest human APPROVED audit entry, when it is complete and dated. */
function approvingEntry(item: ProcurementMatchReviewItem): { reviewerId: string; decidedAt: string } | null {
  if (item.reviewStatus !== 'APPROVED') return null
  const entries = item.audit.filter((entry) => entry.newStatus === 'APPROVED')
  const latest = entries[entries.length - 1]
  if (latest === undefined) return null
  if (!isNonEmptyString(latest.reviewerId) || !isNonEmptyString(latest.decidedAt)) return null
  if (!/^\d{4}-\d{2}-\d{2}/.test(latest.decidedAt)) return null
  return { reviewerId: latest.reviewerId, decidedAt: latest.decidedAt }
}

function pairKey(noticeId: string, companyId: string): string {
  return `${noticeId}|${companyId}`
}

function renderProvenanceNotes(
  item: ProcurementMatchReviewItem,
  decision: BidDecision,
  deciderId: string,
  decidedAt: string,
): string {
  const matched = item.proposal.evidence.filter((entry) => entry.outcome === 'matched')
  const signals = matched.length > 0 ? matched.map((entry) => entry.signal).join(', ') : 'none matched'
  return (
    `Bid proposal derived from APPROVED procurement match ${item.proposal.proposalId} (` +
    `${item.proposal.ruleVersion}): matched signals — ${signals}. ` +
    `Human bid decision ${decision} by ${deciderId} at ${decidedAt}. ` +
    `Eligibility not assessed; submission and commercial details remain manual.`
  )
}

/**
 * Dry-run guidance boundary: one APPROVED ProcurementMatch review item plus one
 * human Bid decision produce a deterministic verdict. Pure and side-effect
 * free. Throws only on malformed input (non-object item, unknown decision, or
 * missing decider/timestamp); every business refusal is a result variant.
 */
export function proposeBidFromApprovedMatch(request: BidProposalRequest): BidProposalResult {
  const { item, decision, deciderId, decidedAt, existingBidIds, existingBidPairs } = request
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('bid proposal requires a procurement match review item object')
  }
  if (decision !== 'BID' && decision !== 'DO_NOT_BID') {
    throw new Error(`invalid bid decision: ${String(decision)} (must be BID or DO_NOT_BID)`)
  }
  if (!isNonEmptyString(deciderId)) {
    throw new Error('a decision-maker id is required to record a bid decision')
  }
  if (!isNonEmptyString(decidedAt)) {
    throw new Error('a decided-at timestamp is required to record a bid decision')
  }
  if (item.reviewStatus !== 'APPROVED') {
    return deepFreeze({
      outcome: 'rejected' as const,
      reason: `only APPROVED procurement matches reach the Bid decision (review status is ${String(item.reviewStatus)})`,
    })
  }
  if (approvingEntry(item) === null) {
    return deepFreeze({
      outcome: 'rejected' as const,
      reason: 'approval is required before a Bid decision: the APPROVED item has no complete human approval (reviewer, decided-at)',
    })
  }
  if (decision === 'DO_NOT_BID') {
    return deepFreeze({
      outcome: 'no_bid' as const,
      reason: 'human decision DO_NOT_BID: no Bid proposal is created from an approved procurement match',
    })
  }
  if (item.proposal.recordType !== 'notice') {
    return deepFreeze({
      outcome: 'rejected' as const,
      reason:
        'a Bid hangs off a Notice, and this proposal recordType is not notice — no honest Bid destination',
    })
  }
  const bidId = deriveBidId(item.proposal.proposalId)
  if (existingBidIds.includes(bidId)) {
    return deepFreeze({
      outcome: 'conflict' as const,
      bidId,
      reason: `bid ${bidId} already exists — refusing to overwrite`,
    })
  }
  if (existingBidPairs.includes(pairKey(item.proposal.noticeId, item.proposal.companyId))) {
    return deepFreeze({
      outcome: 'conflict' as const,
      bidId,
      reason: `a Bid for ${item.proposal.companyId} on ${item.proposal.noticeId} already exists — refusing to create a duplicate`,
    })
  }
  const missing: string[] = []
  const payload: Record<string, unknown> = { bid_id: bidId }
  if (isNonEmptyString(item.noticeName) && isNonEmptyString(item.proposal.noticeId)) {
    payload.notice = `[[${item.proposal.noticeId} — ${item.noticeName}]]`
  } else {
    missing.push('notice')
  }
  if (isNonEmptyString(item.companyName) && isNonEmptyString(item.proposal.companyId)) {
    payload.company = `[[${item.proposal.companyId} — ${item.companyName}]]`
  } else {
    missing.push('company')
  }
  payload.eligibility_status = DEFAULT_ELIGIBILITY_STATUS
  payload.bid_decision = BID_DECISION_VALUE
  payload.bid_decision_date = decidedAt.slice(0, 10)
  payload.decided_by = deciderId
  payload.bid_status = DEFAULT_BID_STATUS
  payload.evidence_notes = renderProvenanceNotes(item, decision, deciderId, decidedAt)
  const missingInformation = item.proposal.evidence
    .filter((entry) => entry.outcome === 'missing')
    .map((entry) => entry.note)
  if (missingInformation.length > 0) {
    payload.missing_information = deepFreeze(missingInformation)
  }
  return deepFreeze({
    outcome: 'proposed' as const,
    bidId,
    payload,
    missingRequiredFields: missing,
    manualFields: MANUAL_BID_FIELDS,
  })
}