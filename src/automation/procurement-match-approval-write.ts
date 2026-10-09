/**
 * Approved-procurement-match ProcurementMatch-record proposal — Phase Q dry-run proposer.
 *
 * The SINGLE explicit boundary between an APPROVED ProcurementMatchReviewItem
 * and a proposed ProcurementMatch record. Pure function: it builds the exact
 * proposed record payload and the write decision, and never touches the
 * filesystem, the network, or a clock. No writer exists in this phase — a
 * future controlled writer would consume `proposed` results without this
 * module changing.
 *
 * Approval rule: the item's reviewStatus must be APPROVED *with* a complete
 * APPROVED audit entry (reviewer and decided-at recorded by a human
 * decision). The engine's proposal status travels along transparently but
 * never gates: a human verdict governs, including an override of a NOT_A_MATCH
 * engine verdict, and the audit shows it. No review transition runs here.
 *
 * Schema mapping (existing ProcurementMatch schema, existing terminology):
 *  - procurement_match_id: deterministic PMATCH-### derived from the proposal
 *    id, which already binds rule version + Notice + company;
 *  - notice / company: real vault-style links `[[id — name]]` built only from
 *    the item's own identities (never guessed) — the fixture uses the real
 *    RFB-### and COMP-### ids that exist in the vault snapshot;
 *  - match_status `New` and eligibility_status `Not assessed`: schema-approved
 *    workflow truths for a fresh proposal (nothing assessed yet);
 *  - evidence_notes: rendered matched/missing evidence plus the approval line;
 *  - missing_information: the proposal's missing-evidence notes verbatim;
 *  - reviewed_by / review_date: the recorded human decision (date precision).
 * Deliberately absent: score, confidence, bid, contract, eligibility facts,
 * and any date other than the actual review date — none of them has a source
 * on this boundary.
 *
 * Identity collisions with existing ProcurementMatch ids are `conflict`, never
 * overwrites. The output is a ProcurementMatch proposal only — no Match, Bid,
 * Contract, Opportunity, or Application shape exists in this module.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import { stableHash } from './candidate'
import type { ProcurementMatchReviewItem } from './procurement-match-review'

/** Schema-approved workflow truths for a fresh proposal. `New`: the pairing
 *  awaits ProcurementMatch-record creation. `Not assessed`: no eligibility
 *  assessment has been performed — asserting anything else would invent one. */
const DEFAULT_MATCH_STATUS = 'New'
const DEFAULT_ELIGIBILITY_STATUS = 'Not assessed'

export interface ProcurementMatchRecordProposalRequest {
  item: ProcurementMatchReviewItem
  /** Caller-supplied existing ProcurementMatch identities — the ONLY record knowledge allowed in. */
  existingProcurementMatchIds: readonly string[]
}

export interface ProcurementMatchRecordApproval {
  proposalId: string
  reviewerId: string
  decidedAt: string
}

export type ProcurementMatchRecordProposal =
  | {
      decision: 'proposed'
      recordId: string
      /** The exact frontmatter payload a writer would file. Missing required
       *  fields are absent here and listed in `missingRequiredFields`. */
      payload: Readonly<Record<string, unknown>>
      missingRequiredFields: readonly string[]
      approval: ProcurementMatchRecordApproval
      /** The engine's verdict, carried transparently — never a gate. */
      proposalStatus: string
    }
  | {
      decision: 'conflict'
      recordId: string
      reason: string
    }
  | {
      decision: 'rejected'
      reason: string
    }

function deriveProcurementMatchId(proposalId: string): string {
  const numeric = parseInt(stableHash(proposalId).slice(0, 8), 16)
  return `PMATCH-${String((numeric % 900) + 100)}`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** The latest human APPROVED decision on the item, if it is complete and dated. */
function approvingEntry(item: ProcurementMatchReviewItem): ProcurementMatchRecordApproval | null {
  if (item.reviewStatus !== 'APPROVED') return null
  const entries = item.audit.filter((entry) => entry.newStatus === 'APPROVED')
  const latest = entries[entries.length - 1]
  if (latest === undefined) return null
  if (!isNonEmptyString(latest.reviewerId) || !isNonEmptyString(latest.decidedAt)) return null
  if (!/^\d{4}-\d{2}-\d{2}/.test(latest.decidedAt)) return null
  return { proposalId: item.proposal.proposalId, reviewerId: latest.reviewerId, decidedAt: latest.decidedAt }
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

function renderEvidenceNotes(item: ProcurementMatchReviewItem, approval: ProcurementMatchRecordApproval): string {
  const lines = item.proposal.evidence.map((entry) => {
    const values = entry.values.length > 0 ? `: ${entry.values.join(', ')}` : ''
    const note = entry.outcome === 'missing' || entry.outcome === 'mismatched' ? ` — ${entry.note}` : ''
    return `${entry.signal} [${entry.outcome}]${values}${note}`
  })
  return (
    `Procurement proposal ${item.proposal.proposalId} (${item.proposal.ruleVersion}): ` +
    `${item.proposal.matchedSignals.length} matched signal(s), ` +
    `${item.proposal.missingSignals.length} missing. ` +
    `Evidence: ${lines.join(' | ')}. ` +
    `Approved by ${approval.reviewerId} at ${approval.decidedAt}. ` +
    `Approval marks eligibility for a future Procurement Match record; no eligibility assessment performed.`
  )
}

/**
 * Dry-run write boundary: evaluates one procurement match review item and
 * returns the exact write decision plus, for approvals, the exact proposed
 * ProcurementMatch payload. Pure and side-effect free. Throws only on a
 * malformed (non-object) item; every business refusal is a `rejected` result.
 */
export function proposeProcurementMatchRecord(
  request: ProcurementMatchRecordProposalRequest,
): ProcurementMatchRecordProposal {
  const { item, existingProcurementMatchIds } = request
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('procurement match record proposal requires a review item object')
  }
  if (item.reviewStatus !== 'APPROVED') {
    return deepFreeze({
      decision: 'rejected' as const,
      reason: `only APPROVED items reach the write boundary (status is ${String(item.reviewStatus)})`,
    })
  }
  const approval = approvingEntry(item)
  if (approval === null) {
    return deepFreeze({
      decision: 'rejected' as const,
      reason:
        'APPROVED item has no complete human approval (reviewer, decided-at, and valid audit entry required)',
    })
  }
  if (item.proposal.recordType !== 'notice') {
    return deepFreeze({
      decision: 'rejected' as const,
      reason:
        'the ProcurementMatch schema requires a Notice source (recordType is not notice), so this proposal has no honest destination',
    })
  }
  const recordId = deriveProcurementMatchId(item.proposal.proposalId)
  if (existingProcurementMatchIds.includes(recordId)) {
    return deepFreeze({
      decision: 'conflict' as const,
      recordId,
      reason: `record ${recordId} already exists — refusing to overwrite`,
    })
  }
  const missing: string[] = []
  const payload: Record<string, unknown> = { procurement_match_id: recordId }
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
  payload.match_status = DEFAULT_MATCH_STATUS
  payload.eligibility_status = DEFAULT_ELIGIBILITY_STATUS
  payload.missing_information = deepFreeze(
    item.proposal.evidence.filter((entry) => entry.outcome === 'missing').map((entry) => entry.note),
  )
  payload.evidence_notes = renderEvidenceNotes(item, approval)
  payload.reviewed_by = approval.reviewerId
  payload.review_date = approval.decidedAt.slice(0, 10)
  return deepFreeze({
    decision: 'proposed' as const,
    recordId,
    payload,
    missingRequiredFields: missing,
    approval,
    proposalStatus: item.proposal.status,
  })
}