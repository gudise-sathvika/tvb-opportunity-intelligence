/**
 * Phase F local review fixture (Phase F brief §10, §14).
 *
 * A deterministic, in-memory mock store that backs the human review UI. It
 * builds discovery candidates by hand and runs them through the REAL Phase E
 * queue (`createReviewQueue`) and the REAL decision contract
 * (`applyReviewDecision`) — the UI never re-implements review state, and every
 * item it renders is contract-valid.
 *
 * Boundary notes (Phase C boundary suite also scans this module):
 *  - no network, filesystem, clock, socket, scheduler, or vault write of any
 *    kind — every id and timestamp is a fixed constant;
 *  - imports are sibling `src/automation` modules only;
 *  - the store surface (`items` / `item` / `apply` / `reset`) is the seam a
 *    real review backend can later slot into without touching the UI.
 */

import type { AccessState, DiscoveryDomain } from './types'
import type {
  CandidateState,
  CandidateStage,
  ClassificationMetadata,
  DiscoveryCandidate,
  DuplicateMetadata,
  NormalizationMetadata,
  NormalizationState,
} from './candidate'
import { candidateIdFor, deepFreeze } from './candidate'
import type { ReviewDecisionInput, ReviewItem } from './review-queue'
import { applyReviewDecision, createReviewQueue } from './review-queue'

/* ------------------------------------------------------------------ */
/* Fixed fixture constants                                             */
/* ------------------------------------------------------------------ */

const RULE_VERSION = '2026-10-01'
const REQUESTED_AT = '2026-10-07T00:00:00.000Z'
const QUEUE_CREATED_AT = '2026-10-07T01:00:00.000Z'
const DECIDED_AT = '2026-10-07T02:00:00.000Z'
const DECIDED_LATER_AT = '2026-10-07T02:30:00.000Z'
const REVIEWER_ID = 'reviewer-1'
const RUN_ID = 'RUN-FX-001'
const PROFILE_ID = 'DP-REV-1'
const COMPANY_ID = 'COMP-001'
const ALL_STAGES: readonly CandidateStage[] = ['transform', 'normalize', 'classify', 'dedup']

/* ------------------------------------------------------------------ */
/* Metadata builders                                                   */
/* ------------------------------------------------------------------ */

interface FieldPair {
  original: string
  normalized: string
}

interface NullableFieldPair {
  original: string | null
  normalized: string | null
}

/** A field whose value cannot be null (title, source url). */
function sameText(value: string): FieldPair {
  return { original: value, normalized: value }
}

/** A field whose source value may be missing. */
function sameValue(value: string | null): NullableFieldPair {
  return { original: value, normalized: value }
}

/** Full normalization metadata form, used where a change must be visible. */
function normalizationMeta(opts: {
  status: NormalizationState
  ruleVersion: string
  changedFields: readonly string[]
  warnings?: readonly string[]
  title: FieldPair
  sourceUrl: FieldPair
  canonicalUrl: string | null
  summary: NullableFieldPair
  publicationDate: NullableFieldPair
  deadline: NullableFieldPair
  organization: NullableFieldPair
  country: NullableFieldPair
  rawType: NullableFieldPair
}): NormalizationMetadata {
  return {
    ruleVersion: opts.ruleVersion,
    status: opts.status,
    changedFields: opts.changedFields,
    warnings: opts.warnings ?? [],
    title: opts.title,
    sourceUrl: opts.sourceUrl,
    canonicalUrl: opts.canonicalUrl,
    summary: opts.summary,
    publicationDate: opts.publicationDate,
    deadline: opts.deadline,
    organization: opts.organization,
    country: opts.country,
    rawType: opts.rawType,
    sourceStatus: sameValue(null),
  }
}

/** Normalization metadata where nothing meaningful changed. */
function unchangedNorm(opts: {
  status: NormalizationState
  ruleVersion: string
  changedFields: readonly string[]
  warnings?: readonly string[]
  title: string
  url: string
  canonicalUrl: string | null
  summary?: string | null
  publicationDate: string | null
  deadline: string | null
  organization: string | null
  country: string | null
  rawType: string | null
}): NormalizationMetadata {
  return {
    ruleVersion: opts.ruleVersion,
    status: opts.status,
    changedFields: opts.changedFields,
    warnings: opts.warnings ?? [],
    title: sameText(opts.title),
    sourceUrl: sameText(opts.url),
    canonicalUrl: opts.canonicalUrl,
    summary: sameValue(opts.summary ?? null),
    publicationDate: sameValue(opts.publicationDate),
    deadline: sameValue(opts.deadline),
    organization: sameValue(opts.organization),
    country: sameValue(opts.country),
    rawType: sameValue(opts.rawType),
    sourceStatus: sameValue(null),
  }
}

function classify(opts: {
  state: 'CLASSIFIED' | 'NEEDS_REVIEW'
  type: string | null
  certainty: 'HIGH' | 'MEDIUM' | 'LOW' | null
  domain: DiscoveryDomain
  sourceId: string
  sourceRawType: string | null
  titleHints: readonly string[]
  matchedRule: string
}): ClassificationMetadata {
  return {
    state: opts.state,
    type: opts.type,
    certainty: opts.certainty,
    evidence: {
      domain: opts.domain,
      sourceEvidence: {
        sourceId: opts.sourceId,
        adapterType: 'routine-request',
        sourceRawType: opts.sourceRawType,
      },
      titleHints: opts.titleHints,
      matchedRule: opts.matchedRule,
      ruleVersion: RULE_VERSION,
    },
  }
}

function dup(opts: {
  verdict: 'DISTINCT' | 'EXACT_DUPLICATE' | 'POSSIBLE_DUPLICATE'
  matchedOn: string
  tier: 1 | 2 | 3
  otherCandidateId?: string | null
  titleKey?: string | null
  corroboratingSignals?: readonly string[]
}): DuplicateMetadata {
  return {
    verdict: opts.verdict,
    evidence: deepFreeze({
      ruleVersion: RULE_VERSION,
      matchedOn: opts.matchedOn,
      tier: opts.tier,
      otherCandidateId: opts.otherCandidateId ?? null,
      titleKey: opts.titleKey ?? null,
      corroboratingSignals: opts.corroboratingSignals ?? [],
    }),
  }
}

/* ------------------------------------------------------------------ */
/* Candidate builder                                                   */
/* ------------------------------------------------------------------ */

interface CandidateSeed {
  sourceId: string
  sourceName: string
  domain: DiscoveryDomain
  sourceRecordId: string
  sourceUrl: string
  sourceTitle: string
  sourceSummary?: string | null
  sourcePublicationDate: string | null
  sourceDeadline: string | null
  sourceOrganization: string | null
  sourceCountry: string | null
  sourceRawType: string | null
  accessState?: AccessState | null
  candidateStatus: CandidateState
  stageHistory?: readonly CandidateStage[]
  normalization: NormalizationMetadata | null
  classification: ClassificationMetadata | null
  duplicate: DuplicateMetadata | null
}

function makeCandidate(seed: CandidateSeed): DiscoveryCandidate {
  const candidateId = candidateIdFor({
    sourceId: seed.sourceId,
    sourceRecordId: seed.sourceRecordId,
    sourceUrl: seed.sourceUrl,
    rawPayload: seed.sourceTitle,
  })
  return deepFreeze({
    candidateId,
    discoveryRunId: RUN_ID,
    companyId: COMPANY_ID,
    discoveryProfileId: PROFILE_ID,
    sourceId: seed.sourceId,
    sourceRecordId: seed.sourceRecordId,
    sourceUrl: seed.sourceUrl,
    sourceTitle: seed.sourceTitle,
    sourceSummary: seed.sourceSummary ?? null,
    sourcePublicationDate: seed.sourcePublicationDate,
    sourceDeadline: seed.sourceDeadline,
    sourceOrganization: seed.sourceOrganization,
    sourceCountry: seed.sourceCountry,
    sourceRawType: seed.sourceRawType,
    sourceStatus: null,
    domain: seed.domain,
    candidateType: 'opportunity',
    candidateStatus: seed.candidateStatus,
    provenance: deepFreeze({
      runId: RUN_ID,
      companyId: COMPANY_ID,
      discoveryProfileId: PROFILE_ID,
      sourceId: seed.sourceId,
      sourceName: seed.sourceName,
      sourceUrl: seed.sourceUrl,
      sourceRecordId: seed.sourceRecordId,
      adapterType: 'routine-request',
      domain: seed.domain,
      accessState: seed.accessState ?? 'AVAILABLE',
      queryTerm: null,
      requestedAt: REQUESTED_AT,
      observedAt: REQUESTED_AT,
      stageHistory: seed.stageHistory ?? ALL_STAGES,
    }),
    normalization: seed.normalization,
    classification: seed.classification,
    duplicate: seed.duplicate,
  })
}

/* ------------------------------------------------------------------ */
/* The fixture candidates                                              */
/* ------------------------------------------------------------------ */

const FX_PROC_URL = 'https://fixtures.invalid/cloudcorp'
const FX_FUND_URL = 'https://fixtures.invalid/grants'

function fixtureCandidates(): readonly DiscoveryCandidate[] {
  return deepFreeze([
    // 1. Procurement RFB item that needs review, with a normalized deadline.
    makeCandidate({
      sourceId: 'FX-PROC-001',
      sourceName: 'Fixture Procurement Portal (test)',
      domain: 'procurement',
      sourceRecordId: 'FX-PRF-101',
      sourceUrl: `${FX_PROC_URL}/PRF-101`,
      sourceTitle: 'Fixture - Cloud Services Framework Agreement (Phase F test)',
      sourcePublicationDate: '2026-09-22',
      sourceDeadline: '2026-10-30',
      sourceOrganization: 'CloudCorp Procurement Office',
      sourceCountry: 'India',
      sourceRawType: 'Notice',
      candidateStatus: 'NORMALIZED',
      normalization: normalizationMeta({
        status: 'NORMALIZED',
        ruleVersion: RULE_VERSION,
        changedFields: ['sourceDeadline', 'sourceCountry'],
        title: sameText('Fixture - Cloud Services Framework Agreement (Phase F test)'),
        sourceUrl: sameText(`${FX_PROC_URL}/PRF-101`),
        canonicalUrl: `${FX_PROC_URL}/PRF-101`,
        summary: sameValue('Fixture - framework arrangement for cloud services suppliers.'),
        publicationDate: sameValue('2026-09-22'),
        deadline: { original: '30-10-2026', normalized: '2026-10-30' },
        organization: sameValue('CloudCorp Procurement Office'),
        country: { original: 'IN', normalized: 'India' },
        rawType: sameValue('Notice'),
      }),
      classification: classify({
        state: 'CLASSIFIED',
        type: 'Notice',
        certainty: 'HIGH',
        domain: 'procurement',
        sourceId: 'FX-PROC-001',
        sourceRawType: 'Notice',
        titleHints: ['framework', 'agreement'],
        matchedRule: 'title-keyword-and-raw-type',
      }),
      duplicate: dup({
        verdict: 'DISTINCT',
        matchedOn: 'source identity',
        tier: 1,
      }),
    }),
    // 2. Procurement RFB item with no deadline on offer.
    makeCandidate({
      sourceId: 'FX-PROC-001',
      sourceName: 'Fixture Procurement Portal (test)',
      domain: 'procurement',
      sourceRecordId: 'FX-PRF-102',
      sourceUrl: `${FX_PROC_URL}/PRF-102`,
      sourceTitle: 'Fixture - Rural Wi-Fi Network Builds (Phase F test)',
      sourcePublicationDate: '2026-09-28',
      sourceDeadline: null,
      sourceOrganization: 'State Broadband Authority',
      sourceCountry: 'India',
      sourceRawType: 'RFB',
      candidateStatus: 'NORMALIZED',
      normalization: unchangedNorm({
        status: 'UNCHANGED',
        ruleVersion: RULE_VERSION,
        changedFields: [],
        title: 'Fixture - Rural Wi-Fi Network Builds (Phase F test)',
        url: `${FX_PROC_URL}/PRF-102`,
        canonicalUrl: `${FX_PROC_URL}/PRF-102`,
        summary: 'Fixture - request for bids on rural network builds.',
        publicationDate: '2026-09-28',
        deadline: null,
        organization: 'State Broadband Authority',
        country: 'India',
        rawType: 'RFB',
      }),
      classification: classify({
        state: 'CLASSIFIED',
        type: 'RFB',
        certainty: 'MEDIUM',
        domain: 'procurement',
        sourceId: 'FX-PROC-001',
        sourceRawType: 'RFB',
        titleHints: ['network'],
        matchedRule: 'raw-type-regex',
      }),
      duplicate: dup({
        verdict: 'DISTINCT',
        matchedOn: 'source identity',
        tier: 1,
      }),
    }),
    // 3. Funding Grant item that needs review.
    makeCandidate({
      sourceId: 'FX-FUND-001',
      sourceName: 'Fixture Grant Finder (test)',
      domain: 'funding',
      sourceRecordId: 'FX-GR-201',
      sourceUrl: `${FX_FUND_URL}/GR-201`,
      sourceTitle: 'Fixture - Community Solar Innovation Grant FY 2027 (Phase F test)',
      sourcePublicationDate: '2026-09-30',
      sourceDeadline: '2026-11-15',
      sourceOrganization: 'Ministry of New Energy',
      sourceCountry: 'India',
      sourceRawType: 'Grant',
      candidateStatus: 'NORMALIZED',
      normalization: unchangedNorm({
        status: 'NORMALIZED',
        ruleVersion: RULE_VERSION,
        changedFields: ['sourceTitle'],
        title: 'Fixture - Community Solar Innovation Grant FY 2027 (Phase F test)',
        url: `${FX_FUND_URL}/GR-201`,
        canonicalUrl: `${FX_FUND_URL}/GR-201`,
        summary: 'Fixture - grant call for community solar innovation projects.',
        publicationDate: '2026-09-30',
        deadline: '2026-11-15',
        organization: 'Ministry of New Energy',
        country: 'India',
        rawType: 'Grant',
      }),
      classification: classify({
        state: 'CLASSIFIED',
        type: 'Grant',
        certainty: 'HIGH',
        domain: 'funding',
        sourceId: 'FX-FUND-001',
        sourceRawType: 'Grant',
        titleHints: ['grant'],
        matchedRule: 'title-keyword-and-raw-type',
      }),
      duplicate: dup({
        verdict: 'DISTINCT',
        matchedOn: 'source identity',
        tier: 1,
      }),
    }),
    // 4. Funding open call that the classifier is unsure about — still needs
    //    review, and it carries possible-duplicate evidence for the human eye.
    makeCandidate({
      sourceId: 'FX-FUND-001',
      sourceName: 'Fixture Grant Finder (test)',
      domain: 'funding',
      sourceRecordId: 'FX-GR-202',
      sourceUrl: `${FX_FUND_URL}/GR-202`,
      sourceTitle: 'Fixture - Open Call for Community Innovators (Phase F test)',
      sourcePublicationDate: '2026-10-01',
      sourceDeadline: null,
      sourceOrganization: 'Council for Innovation',
      sourceCountry: 'India',
      sourceRawType: null,
      candidateStatus: 'REVIEW',
      normalization: unchangedNorm({
        status: 'WARNING',
        ruleVersion: RULE_VERSION,
        changedFields: ['rawType'],
        warnings: ['Listing does not state an opportunity type'],
        title: 'Fixture - Open Call for Community Innovators (Phase F test)',
        url: `${FX_FUND_URL}/GR-202`,
        canonicalUrl: `${FX_FUND_URL}/GR-202`,
        summary: 'Fixture - open call for community innovation proposals.',
        publicationDate: '2026-10-01',
        deadline: null,
        organization: 'Council for Innovation',
        country: 'India',
        rawType: null,
      }),
      classification: classify({
        state: 'NEEDS_REVIEW',
        type: null,
        certainty: null,
        domain: 'funding',
        sourceId: 'FX-FUND-001',
        sourceRawType: null,
        titleHints: [],
        matchedRule: 'no-confident-rule',
      }),
      duplicate: dup({
        verdict: 'POSSIBLE_DUPLICATE',
        matchedOn: 'canonicalUrl',
        tier: 2,
        otherCandidateId: 'DC:FX-FUND-001:FX-GR-201',
        titleKey: 'fixture open call for community innovators',
        corroboratingSignals: ['similar-title'],
      }),
    }),
    // 5. A procurement item already flagged as an exact duplicate (Phase C).
    makeCandidate({
      sourceId: 'FX-PROC-001',
      sourceName: 'Fixture Procurement Portal (test)',
      domain: 'procurement',
      sourceRecordId: 'FX-PRF-103',
      sourceUrl: `${FX_PROC_URL}/PRF-103`,
      sourceTitle: 'Fixture - Cloud Services Framework Agreement (Phase F test)',
      sourcePublicationDate: '2026-09-22',
      sourceDeadline: '2026-10-30',
      sourceOrganization: 'CloudCorp Procurement Office',
      sourceCountry: 'India',
      sourceRawType: 'Notice',
      candidateStatus: 'DUPLICATE',
      normalization: unchangedNorm({
        status: 'NORMALIZED',
        ruleVersion: RULE_VERSION,
        changedFields: ['sourceCountry'],
        title: 'Fixture - Cloud Services Framework Agreement (Phase F test)',
        url: `${FX_PROC_URL}/PRF-103`,
        canonicalUrl: `${FX_PROC_URL}/PRF-103`,
        summary: 'Fixture - resubmission of the framework agreement listing.',
        publicationDate: '2026-09-22',
        deadline: '2026-10-30',
        organization: 'CloudCorp Procurement Office',
        country: 'India',
        rawType: 'Notice',
      }),
      classification: classify({
        state: 'CLASSIFIED',
        type: 'Notice',
        certainty: 'HIGH',
        domain: 'procurement',
        sourceId: 'FX-PROC-001',
        sourceRawType: 'Notice',
        titleHints: ['framework', 'agreement'],
        matchedRule: 'title-keyword-and-raw-type',
      }),
      duplicate: dup({
        verdict: 'EXACT_DUPLICATE',
        matchedOn: 'sourceRecordId',
        tier: 1,
        otherCandidateId: 'DC:FX-PROC-001:FX-PRF-101',
        titleKey: 'fixture cloud services framework agreement phase f test',
        corroboratingSignals: ['same-source-record', 'same-canonical-url'],
      }),
    }),
    // 6. A funding item blocked by normalization (blank title).
    makeCandidate({
      sourceId: 'FX-FUND-001',
      sourceName: 'Fixture Grant Finder (test)',
      domain: 'funding',
      sourceRecordId: 'FX-GR-203',
      sourceUrl: `${FX_FUND_URL}/GR-203`,
      sourceTitle: '',
      sourcePublicationDate: null,
      sourceDeadline: null,
      sourceOrganization: null,
      sourceCountry: null,
      sourceRawType: null,
      candidateStatus: 'BLOCKED',
      stageHistory: ['transform', 'normalize'],
      normalization: normalizationMeta({
        status: 'FAILED',
        ruleVersion: RULE_VERSION,
        changedFields: [],
        warnings: ['Listing has no title'],
        title: { original: '', normalized: '' },
        sourceUrl: sameText(`${FX_FUND_URL}/GR-203`),
        canonicalUrl: null,
        summary: sameValue(null),
        publicationDate: sameValue(null),
        deadline: sameValue(null),
        organization: sameValue(null),
        country: sameValue(null),
        rawType: sameValue(null),
      }),
      classification: null,
      duplicate: null,
    }),
    // 7. A funding Grant that a reviewer already approved. The store materialises
    //    the approval through the real decision path so the item carries genuine
    //    audit history.
    makeCandidate({
      sourceId: 'FX-FUND-001',
      sourceName: 'Fixture Grant Finder (test)',
      domain: 'funding',
      sourceRecordId: 'FX-GR-204',
      sourceUrl: `${FX_FUND_URL}/GR-204`,
      sourceTitle: 'Fixture - Battery Storage Innovation Grant (Phase F test)',
      sourcePublicationDate: '2026-09-25',
      sourceDeadline: '2026-12-01',
      sourceOrganization: 'Clean Energy Council',
      sourceCountry: 'India',
      sourceRawType: 'Grant',
      candidateStatus: 'NORMALIZED',
      normalization: unchangedNorm({
        status: 'UNCHANGED',
        ruleVersion: RULE_VERSION,
        changedFields: [],
        title: 'Fixture - Battery Storage Innovation Grant (Phase F test)',
        url: `${FX_FUND_URL}/GR-204`,
        canonicalUrl: `${FX_FUND_URL}/GR-204`,
        summary: 'Fixture - grant call for battery storage innovation.',
        publicationDate: '2026-09-25',
        deadline: '2026-12-01',
        organization: 'Clean Energy Council',
        country: 'India',
        rawType: 'Grant',
      }),
      classification: classify({
        state: 'CLASSIFIED',
        type: 'Grant',
        certainty: 'HIGH',
        domain: 'funding',
        sourceId: 'FX-FUND-001',
        sourceRawType: 'Grant',
        titleHints: ['grant', 'innovation'],
        matchedRule: 'title-keyword-and-raw-type',
      }),
      duplicate: dup({
        verdict: 'DISTINCT',
        matchedOn: 'source identity',
        tier: 1,
      }),
    }),
    // 8. A procurement RFB item that a reviewer already rejected.
    makeCandidate({
      sourceId: 'FX-PROC-001',
      sourceName: 'Fixture Procurement Portal (test)',
      domain: 'procurement',
      sourceRecordId: 'FX-PRF-104',
      sourceUrl: `${FX_PROC_URL}/PRF-104`,
      sourceTitle: 'Fixture - Harbour Dredging Services RFB (Phase F test)',
      sourcePublicationDate: '2026-09-26',
      sourceDeadline: '2026-11-02',
      sourceOrganization: 'Port Authority',
      sourceCountry: 'India',
      sourceRawType: 'RFB',
      candidateStatus: 'NORMALIZED',
      normalization: unchangedNorm({
        status: 'NORMALIZED',
        ruleVersion: RULE_VERSION,
        changedFields: ['sourceCountry'],
        title: 'Fixture - Harbour Dredging Services RFB (Phase F test)',
        url: `${FX_PROC_URL}/PRF-104`,
        canonicalUrl: `${FX_PROC_URL}/PRF-104`,
        summary: 'Fixture - request for bids on harbour dredging services.',
        publicationDate: '2026-09-26',
        deadline: '2026-11-02',
        organization: 'Port Authority',
        country: 'India',
        rawType: 'RFB',
      }),
      classification: classify({
        state: 'CLASSIFIED',
        type: 'RFB',
        certainty: 'MEDIUM',
        domain: 'procurement',
        sourceId: 'FX-PROC-001',
        sourceRawType: 'RFB',
        titleHints: ['dredging', 'rfb'],
        matchedRule: 'raw-type-regex',
      }),
      duplicate: dup({
        verdict: 'DISTINCT',
        matchedOn: 'source identity',
        tier: 1,
      }),
    }),
  ])
}

/* ------------------------------------------------------------------ */
/* Queue build and the in-memory store                                 */
/* ------------------------------------------------------------------ */

/**
 * Builds the initial review queue: converts every fixture candidate through the
 * real Phase E queue, then applies the two already-recorded human decisions
 * through the real decision path (so APPROVED / REJECTED items carry genuine
 * audit history, exactly as a live queue would).
 */
export function buildInitialReviewItems(): readonly ReviewItem[] {
  const queue = createReviewQueue(fixtureCandidates(), { createdAt: QUEUE_CREATED_AT })

  const approvalTarget = queue.find((entry) => entry.sourceRecordId === 'FX-GR-204')
  if (!approvalTarget) throw new Error('fixture approval target missing')
  const approved = deepFreeze(
    queue.map((entry) =>
      entry.reviewId === approvalTarget.reviewId
        ? applyReviewDecision(entry, {
            reviewId: entry.reviewId,
            decision: 'APPROVED',
            reviewerId: REVIEWER_ID,
            decidedAt: DECIDED_AT,
            reason: null,
            evidenceNotes: 'Verified against the source listing.',
          })
        : entry,
    ),
  )

  const rejectionTarget = approved.find((entry) => entry.sourceRecordId === 'FX-PRF-104')
  if (!rejectionTarget) throw new Error('fixture rejection target missing')
  return deepFreeze(
    approved.map((entry) =>
      entry.reviewId === rejectionTarget.reviewId
        ? applyReviewDecision(entry, {
            reviewId: entry.reviewId,
            decision: 'REJECTED',
            reviewerId: REVIEWER_ID,
            decidedAt: DECIDED_LATER_AT,
            reason: 'Opportunity outside our operating region.',
            evidenceNotes: null,
          })
        : entry,
    ),
  )
}

export interface ReviewFixtureStore {
  items(): readonly ReviewItem[]
  item(reviewId: string): ReviewItem | undefined
  apply(input: ReviewDecisionInput): ReviewItem
  /**
   * Appends review items produced by another part of the app (currently the
   * Phase G discovery control panel). Identical reviewIds never appear twice;
   * the items themselves are created by the real Phase E queue, so the store
   * only ever holds contract-valid items.
   */
  addReviewItems(items: readonly ReviewItem[]): void
  reset(): void
}

let state: readonly ReviewItem[] = buildInitialReviewItems()

/**
 * The local mock store. `apply` routes every decision through the real Phase E
 * `applyReviewDecision` — there is no second state machine in the UI.
 */
export const reviewFixtureStore: ReviewFixtureStore = {
  items(): readonly ReviewItem[] {
    return state
  },
  item(reviewId: string): ReviewItem | undefined {
    return state.find((entry) => entry.reviewId === reviewId)
  },
  apply(input: ReviewDecisionInput): ReviewItem {
    const current = state.find((entry) => entry.reviewId === input.reviewId)
    if (!current) throw new Error(`review item not found: ${input.reviewId}`)
    const updated = applyReviewDecision(current, input)
    state = deepFreeze(state.map((entry) => (entry.reviewId === updated.reviewId ? updated : entry)))
    return updated
  },
  addReviewItems(items: readonly ReviewItem[]): void {
    if (items.length === 0) return
    for (const item of items) {
      if (typeof item.reviewId !== 'string' || item.reviewId.length === 0) {
        throw new Error('review items must carry a reviewId')
      }
    }
    const existing = new Set(state.map((entry) => entry.reviewId))
    const fresh = items.filter((item) => !existing.has(item.reviewId))
    if (fresh.length === 0) return
    state = deepFreeze([...state, ...fresh])
  },
  reset(): void {
    state = buildInitialReviewItems()
  },
}