/**
 * Approved-candidate Vault write boundary — Phase K dry-run proposer.
 *
 * This module is the SINGLE explicit boundary between an APPROVED Human Review
 * item and a Vault record proposal. It is a pure function: it builds the
 * exact proposed record payload and the write decision, and it never touches
 * the filesystem, the network, or a clock. There is no live writer in this
 * phase — a future controlled writer would consume `proposed` results, and
 * would refuse `incomplete` ones, without this module changing.
 *
 * Core rule, enforced structurally: discovery candidates never reach this
 * module (it accepts ReviewItems, not candidates), and only an item whose
 * reviewStatus is APPROVED *with* a complete APPROVED audit entry — reviewer
 * and decided-at recorded by a human decision — can yield a proposal.
 * Everything else yields `rejected`. An already-taken record identity yields
 * `conflict`. Nothing is ever overwritten, approved, or created here: no
 * review transition runs, no Bid/Contract shape exists in this module.
 *
 * Field policy (brief §4): every payload value comes from the item or from a
 * schema-approved workflow default (`Unverified`, `Draft`). Business facts the
 * item does not carry — country, dates, methods, linked records — stay missing
 * and are listed in `missingRequiredFields` instead of being guessed. Links are
 * never fabricated: a link-typed required field (the notice's procuring entity)
 * is filled ONLY by resolving the source's own buyer name against the caller's
 * list of organization records that already exist in the target vault, and is
 * reported missing otherwise.
 *
 * The Notice path completes every required field the pipeline can honestly
 * source: description, country, and issue date from the item's normalization
 * metadata; notice type from the source's own raw type (TED procedure codes
 * map to their schema equivalents; an already-schema value passes verbatim);
 * procurement method from TED procedure codes only; contract type and lot
 * structure as the explicit workflow default `Unknown` — the pipeline carries
 * no such fact, and the required field would otherwise stay blank forever.
 * The Opportunity path is unchanged: `country` is only ever a missing
 * lifecycle fact there, and `record_status` is never defaulted.
 *
 * Record identity is deterministic: FNV-1a over the candidate id, folded into
 * the existing 3-digit `OPP-###` / `RFB-###` shape. A collision with an
 * existing record is a `conflict`, never an overwrite.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only — never the import
 *    pipeline, the data snapshot, or record types, so this module cannot read
 *    or write Vault records, only propose payloads for caller-supplied ids.
 */

import { stableHash } from './candidate'
import type { NormalizationMetadata } from './candidate'
import { OPPORTUNITY_TYPE_VOCABULARY } from './classify'
import type { ReviewItem } from './review-queue'

/** Schema-approved workflow defaults, pinned to the import schema vocabularies:
 *  verification `Unverified`, notice lifecycle `Draft`. Both describe our
 *  record state — never the opportunity itself — so they are safe defaults. */
const DEFAULT_VERIFICATION_STATUS = 'Unverified'
const DEFAULT_NOTICE_STATUS = 'Draft'

/** The Notice schema's required contract/lot facts have no discovery source at
 *  all. `Unknown` is the schema-approved way to record that absence explicitly
 *  (both vocabularies carry the value) rather than leaving a required field
 *  blank or inventing a shape. */
const DEFAULT_CONTRACT_TYPE = 'Unknown'
const DEFAULT_LOT_STRUCTURE = 'Unknown'

/** The schema notice_type vocabulary, mirrored here because the Phase C
 *  boundary forbids importing the import pipeline from this module.
 *  `approval-write.test.ts` asserts the mirror stays identical to
 *  `CONTROLLED_VALUES.notice_type`. */
export const NOTICE_TYPE_VOCABULARY: readonly string[] = [
  'RFB',
  'RFQ',
  'RFP',
  'RTE',
  'EOI',
  'Tender',
  'Single source',
  'Other',
]

/** Exact, case-insensitive match against the pipeline's own canonical
 *  opportunity vocabulary (which mirrors the schema). Anything else leaves
 *  the controlled field missing. */
function opportunityTypeFrom(classificationType: string | null): string | null {
  if (classificationType === null) return null
  const lowered = classificationType.toLowerCase()
  return OPPORTUNITY_TYPE_VOCABULARY.find((value) => value.toLowerCase() === lowered) ?? null
}

/** The source's raw notice type as a schema notice_type value.
 *
 *  The pipeline canonicalizes procurement classification to `Notice`, which is
 *  not a schema notice_type, so the decision uses the item's own raw type:
 *  TED procedure codes map deterministically (`cn-*` procedures are tenders,
 *  `pin-*` are expressions of interest), and a raw type that already IS a
 *  schema value passes through verbatim. Anything else stays missing. */
function noticeTypeFrom(rawType: string | null): string | null {
  if (rawType === null) return null
  const lowered = rawType.trim().toLowerCase()
  if (lowered === '') return null
  if (lowered.startsWith('cn-')) return 'Tender'
  if (lowered.startsWith('pin-')) return 'EOI'
  return NOTICE_TYPE_VOCABULARY.find((value) => value.toLowerCase() === lowered) ?? null
}

/** The source's raw type as a schema procurement_method value. Only TED
 *  procedure codes are mapped — a notice TYPE raw value (e.g. `RFB`) says
 *  nothing about the method, and an unmapped code stays missing. */
function procurementMethodFrom(rawType: string | null): string | null {
  if (rawType === null) return null
  const lowered = rawType.trim().toLowerCase()
  if (lowered === 'cn-standard') return 'Open'
  if (lowered === 'cn-restricted' || lowered === 'cn-limited') return 'Limited'
  return null
}

/** One organization record that already exists in the target vault. Supplied
 *  by the caller — this module never reads the vault. */
export interface OrganizationRef {
  readonly id: string
  readonly name: string
}

/** The source's buyer name resolved against real vault organization records.
 *  The wikilink uses the vault's own record name so the link text matches the
 *  file exactly. No match → null (never a fabricated link). */
function procuringEntityFrom(
  normalization: NormalizationMetadata | null,
  refs: readonly OrganizationRef[],
): string | null {
  const buyer = normalization?.organization.normalized
  if (buyer === null || buyer === undefined) return null
  const wanted = buyer.trim().toLowerCase()
  if (wanted === '') return null
  const match = refs.find((ref) => ref.name.trim().toLowerCase() === wanted)
  return match === undefined ? null : `[[${match.id} — ${match.name}]]`
}

export type VaultWriteTargetType = 'opportunity' | 'notice'

export interface VaultWriteProposalRequest {
  item: ReviewItem
  /** Caller-supplied existing identities — the ONLY record knowledge allowed in. */
  existingOpportunityIds: readonly string[]
  existingNoticeIds: readonly string[]
  /** Caller-supplied organization records that already exist in the target
   *  vault — the ONLY way procuring_entity is ever resolved to a link. */
  existingOrganizationRefs?: readonly OrganizationRef[]
}

export interface VaultWriteApproval {
  reviewId: string
  reviewerId: string
  decidedAt: string
}

export type VaultWriteProposal =
  | {
      decision: 'proposed'
      targetType: VaultWriteTargetType
      recordId: string
      /** The exact frontmatter payload a writer would file. Missing required
       *  fields are absent here and listed in `missingRequiredFields`. */
      payload: Readonly<Record<string, unknown>>
      missingRequiredFields: readonly string[]
      approval: VaultWriteApproval
    }
  | {
      decision: 'conflict'
      targetType: VaultWriteTargetType
      recordId: string
      reason: string
    }
  | {
      decision: 'rejected'
      reason: string
    }

function deriveRecordId(prefix: 'OPP' | 'RFB', candidateId: string): string {
  const numeric = parseInt(stableHash(candidateId).slice(0, 8), 16)
  return `${prefix}-${String((numeric % 900) + 100)}`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** The latest human APPROVED decision on the item, if it is complete. */
function approvingEntry(item: ReviewItem): VaultWriteApproval | null {
  if (item.reviewStatus !== 'APPROVED') return null
  const entries = item.audit.filter((entry) => entry.newStatus === 'APPROVED')
  const latest = entries[entries.length - 1]
  if (latest === undefined) return null
  if (!isNonEmptyString(latest.reviewerId) || !isNonEmptyString(latest.decidedAt)) return null
  return { reviewId: item.reviewId, reviewerId: latest.reviewerId, decidedAt: latest.decidedAt }
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

function provenanceNote(
  item: ReviewItem,
  approval: VaultWriteApproval,
  evidenceNotes: string | null,
  disclosures: readonly string[] = [],
): string {
  const record = item.sourceRecordId ?? 'unknown record'
  const base =
    `Proposed from approved review ${item.reviewId} (candidate ${item.candidateId}, ` +
    `source ${item.sourceId} ${record}), approved by ${approval.reviewerId} at ${approval.decidedAt}.`
  const parts = [base]
  if (evidenceNotes !== null && evidenceNotes.length > 0) parts.push(`Reviewer note: ${evidenceNotes}`)
  if (disclosures.length > 0) parts.push(`Recorded values: ${disclosures.join(' ')}`)
  return parts.join(' ')
}

function proposeOpportunity(
  item: ReviewItem,
  approval: VaultWriteApproval,
  evidenceNotes: string | null,
  existingIds: readonly string[],
): VaultWriteProposal {
  const recordId = deriveRecordId('OPP', item.candidateId)
  if (existingIds.includes(recordId)) {
    return deepFreeze({
      decision: 'conflict' as const,
      targetType: 'opportunity' as const,
      recordId,
      reason: `record ${recordId} already exists — refusing to overwrite`,
    })
  }
  const missing: string[] = []
  const payload: Record<string, unknown> = { opportunity_id: recordId }
  if (isNonEmptyString(item.sourceTitle)) {
    payload.opportunity_name = item.sourceTitle
  } else {
    missing.push('opportunity_name')
  }
  const opportunityType = opportunityTypeFrom(item.classification?.type ?? null)
  if (opportunityType === null) {
    missing.push('opportunity_type')
  } else {
    payload.opportunity_type = opportunityType
  }
  missing.push('country')
  payload.verification_status = DEFAULT_VERIFICATION_STATUS
  missing.push('record_status')
  payload.source_url = item.sourceUrl
  payload.notes = provenanceNote(item, approval, evidenceNotes)
  return deepFreeze({
    decision: 'proposed' as const,
    targetType: 'opportunity' as const,
    recordId,
    payload,
    missingRequiredFields: missing,
    approval,
  })
}

function proposeNotice(
  item: ReviewItem,
  approval: VaultWriteApproval,
  evidenceNotes: string | null,
  existingIds: readonly string[],
  organizationRefs: readonly OrganizationRef[],
): VaultWriteProposal {
  const recordId = deriveRecordId('RFB', item.candidateId)
  if (existingIds.includes(recordId)) {
    return deepFreeze({
      decision: 'conflict' as const,
      targetType: 'notice' as const,
      recordId,
      reason: `record ${recordId} already exists — refusing to overwrite`,
    })
  }
  const missing: string[] = []
  const disclosures: string[] = []
  const payload: Record<string, unknown> = { notice_id: recordId }
  if (isNonEmptyString(item.sourceTitle)) {
    payload.notice_name = item.sourceTitle
  } else {
    missing.push('notice_name')
  }
  if (isNonEmptyString(item.sourceRecordId)) {
    payload.notice_number = item.sourceRecordId
  } else {
    missing.push('notice_number')
  }

  const normalization = item.normalization
  const rawType = normalization?.rawType.normalized ?? null

  const noticeType = noticeTypeFrom(rawType)
  if (noticeType === null) {
    missing.push('notice_type')
  } else {
    payload.notice_type = noticeType
  }
  const method = procurementMethodFrom(rawType)
  if (method === null) {
    missing.push('procurement_method')
  } else {
    payload.procurement_method = method
  }
  const loweredRawType = (rawType ?? '').trim().toLowerCase()
  if ((noticeType !== null || method !== null) && (loweredRawType.startsWith('cn-') || loweredRawType.startsWith('pin-'))) {
    disclosures.push(`notice_type/procurement_method derived from the TED procedure code "${rawType}".`)
  }

  const procuringEntity = procuringEntityFrom(normalization, organizationRefs)
  if (procuringEntity === null) {
    missing.push('procuring_entity')
  } else {
    payload.procuring_entity = procuringEntity
  }

  payload.notice_url = item.sourceUrl

  const country = normalization?.country.normalized
  if (country !== null && country !== undefined && country.trim() !== '') {
    payload.country = country
  } else {
    missing.push('country')
  }

  const summary = normalization?.summary.normalized
  if (summary !== null && summary !== undefined && summary.trim() !== '') {
    payload.description = summary
  } else if (isNonEmptyString(item.sourceTitle)) {
    payload.description = item.sourceTitle
    disclosures.push(
      'Description recorded from the notice title — the source carried no separate description text.',
    )
  } else {
    missing.push('description')
  }

  payload.contract_type = DEFAULT_CONTRACT_TYPE
  payload.lot_structure = DEFAULT_LOT_STRUCTURE
  disclosures.push('Contract type and lot structure recorded as Unknown — the discovery source carries no such fact.')

  const issueDate = normalization?.publicationDate.normalized
  if (issueDate !== null && issueDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    payload.issue_date = issueDate
  } else {
    missing.push('issue_date')
  }

  payload.notice_status = DEFAULT_NOTICE_STATUS
  payload.notes = provenanceNote(item, approval, evidenceNotes, disclosures)
  return deepFreeze({
    decision: 'proposed' as const,
    targetType: 'notice' as const,
    recordId,
    payload,
    missingRequiredFields: missing,
    approval,
  })
}

/**
 * Dry-run write boundary: evaluates one review item and returns the exact
 * write decision plus, for approvals, the exact proposed payload. Pure and
 * side-effect free — calling it can never modify the Vault, the item, or any
 * review state. Throws only on a malformed (non-object) item; every business
 * refusal is a `rejected` result, never an exception.
 */
export function proposeVaultWrite(request: VaultWriteProposalRequest): VaultWriteProposal {
  const { item, existingOpportunityIds, existingNoticeIds, existingOrganizationRefs } = request
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('write proposal requires a review item object')
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
      reason: 'APPROVED item has no complete human approval (reviewer and decided-at required)',
    })
  }
  const evidenceNotes = item.audit[item.audit.length - 1]?.evidenceNotes ?? null
  if (item.domain === 'funding') {
    return proposeOpportunity(item, approval, evidenceNotes, existingOpportunityIds)
  }
  if (item.domain === 'procurement') {
    return proposeNotice(item, approval, evidenceNotes, existingNoticeIds, existingOrganizationRefs ?? [])
  }
  return deepFreeze({
    decision: 'rejected' as const,
    reason: `unsupported domain: ${String(item.domain)}`,
  })
}
