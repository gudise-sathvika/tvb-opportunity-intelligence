import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ReviewItem } from '../automation/review-queue'
import { GRANTS_GOV_OPPORTUNITY_PREFIX } from '../automation/grantsgov-adapter'
import { GRANTS_GOV_SOURCE_ID, TED_SOURCE_ID } from '../automation/registry'
import type { CsvPreview } from './csv'
import {
  approvedActionableReviewItems,
  buildTargetCompanyMatchReviewItems,
} from './match-review-bridge'
import { buildTargetCompanyProcurementMatchReviewItems } from './procurement-match-bridge'

const NOW = '2026-10-20T13:30:00.000Z'
const DEADLINE = '2026-12-01'

function reviewItem(options: {
  id: string
  domain: 'funding' | 'procurement'
  reviewStatus: ReviewItem['reviewStatus']
  sourceId?: string
  sourceRecordId?: string
  sourceUrl?: string
  deadline?: string | null
  sourceStatus?: string | null
  rawType?: string | null
}): ReviewItem {
  const sourceId = options.sourceId ?? GRANTS_GOV_SOURCE_ID
  const sourceRecordId = options.sourceRecordId ?? options.id
  const sourceUrl =
    options.sourceUrl ??
    (sourceId === TED_SOURCE_ID
      ? 'https://ted.europa.eu/en/notice/-/detail/12345-2026'
      : `${GRANTS_GOV_OPPORTUNITY_PREFIX}${sourceRecordId}`)
  const title = `Source opportunity ${sourceRecordId}`
  return {
    reviewId: `RI:${options.id}:NORMALIZED`,
    candidateId: options.id,
    discoveryRunId: 'RUN-TEST-001',
    companyId: 'RUN',
    discoveryProfileId: 'DP-TEST',
    domain: options.domain,
    sourceId,
    sourceRecordId,
    sourceUrl,
    sourceTitle: title,
    candidateType: 'opportunity',
    candidateStatus: 'NORMALIZED',
    classification: null,
    normalization: {
      ruleVersion: 'test',
      status: 'UNCHANGED',
      changedFields: [],
      warnings: [],
      title: { original: title, normalized: title },
      sourceUrl: { original: sourceUrl, normalized: sourceUrl },
      canonicalUrl: sourceUrl,
      summary: { original: 'solar irrigation', normalized: 'solar irrigation' },
      publicationDate: { original: null, normalized: null },
      deadline: { original: options.deadline === undefined ? DEADLINE : options.deadline, normalized: options.deadline === undefined ? DEADLINE : options.deadline },
      organization: { original: null, normalized: null },
      country: { original: 'United States', normalized: 'United States' },
      rawType: {
        original: options.rawType ?? (sourceId === TED_SOURCE_ID ? 'cn-standard' : null),
        normalized: options.rawType ?? (sourceId === TED_SOURCE_ID ? 'cn-standard' : null),
      },
      sourceStatus: {
        original: options.sourceStatus === undefined ? 'posted' : options.sourceStatus,
        normalized: options.sourceStatus === undefined ? 'posted' : options.sourceStatus,
      },
    },
    duplicate: null,
    sourceEvidence: {
      version: 'opp-enrich-1',
      programmes: null,
      sectors: ['Renewable energy'],
      categories: null,
      applicantTypes: null,
      budget: null,
      value: null,
      documents: [],
      documentFindings: [],
      lifecycleNotes: [],
      evidence: [],
      checkedAt: NOW,
      notes: [],
    },
    provenance: {
      runId: 'RUN-TEST-001',
      companyId: 'RUN',
      discoveryProfileId: 'DP-TEST',
      sourceId,
      sourceName: sourceId,
      sourceUrl,
      sourceRecordId,
      adapterType: 'test',
      domain: options.domain,
      accessState: 'AVAILABLE',
      queryTerm: null,
      requestedAt: NOW,
      observedAt: NOW,
      stageHistory: ['transform', 'normalize', 'classify', 'dedup'],
    },
    reviewStatus: options.reviewStatus,
    audit: [],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

const importedCompanies: CsvPreview = {
  headers: ['company name', 'company HQ location', 'company sector'],
  rows: [
    ['Solar Works', 'Austin, US', 'Renewable energy'],
    ['Water Labs', 'Austin, US', 'Water technology'],
  ],
  rowCount: 2,
  errors: [],
}

test('matching accepts only approved actionable items in its own domain and deduplicates source identity', () => {
  const approved = reviewItem({ id: 'OPP-1', domain: 'funding', reviewStatus: 'APPROVED' })
  const duplicate = reviewItem({
    id: 'OPP-1-DUP',
    domain: 'funding',
    reviewStatus: 'APPROVED',
    sourceRecordId: approved.sourceRecordId ?? undefined,
  })
  const pending = reviewItem({ id: 'OPP-2', domain: 'funding', reviewStatus: 'NEEDS_REVIEW' })
  const expired = reviewItem({
    id: 'OPP-3',
    domain: 'funding',
    reviewStatus: 'APPROVED',
    deadline: '2026-10-19',
  })
  const procurement = reviewItem({
    id: 'RFP-1',
    domain: 'procurement',
    reviewStatus: 'APPROVED',
  })

  assert.deepEqual(
    approvedActionableReviewItems([approved, duplicate, pending, expired, procurement], 'funding', NOW),
    [approved],
  )
  assert.deepEqual(
    approvedActionableReviewItems([approved, procurement], 'procurement', NOW),
    [procurement],
  )
})

test('funding bridge matches imported CSV profiles without GLEIF and keeps source provenance', () => {
  const item = reviewItem({ id: 'OPP-1', domain: 'funding', reviewStatus: 'APPROVED' })
  const proposals = buildTargetCompanyMatchReviewItems(NOW, NOW, [item], importedCompanies)

  assert.equal(proposals.length, 2)
  assert.ok(proposals.every((proposal) => proposal.proposal.sourceRecordId === item.sourceRecordId))
  assert.ok(proposals.every((proposal) => proposal.sourceUrl === item.sourceUrl))
  assert.deepEqual(
    proposals.map((proposal) => proposal.proposal.companyId),
    ['target-row-2', 'target-row-3'],
  )
  assert.ok(proposals.every((proposal) => proposal.reviewStatus === 'PENDING'))
  assert.ok(proposals.every((proposal) => proposal.proposal.evidence.length > 0))
})

test('procurement matching creates separate company assessments for one approved notice', () => {
  const notice = reviewItem({
    id: 'RFP-1',
    domain: 'procurement',
    reviewStatus: 'APPROVED',
    sourceId: TED_SOURCE_ID,
    sourceRecordId: '12345-2026',
  })
  const proposals = buildTargetCompanyProcurementMatchReviewItems(
    NOW,
    NOW,
    [notice],
    importedCompanies,
  )

  assert.equal(proposals.length, 2)
  assert.deepEqual(
    proposals.map((proposal) => proposal.proposal.noticeId),
    ['12345-2026', '12345-2026'],
  )
  assert.equal(new Set(proposals.map((proposal) => proposal.proposal.companyId)).size, 2)
  assert.ok(proposals.every((proposal) => proposal.noticeSourceUrl === notice.sourceUrl))
  assert.ok(proposals.every((proposal) => proposal.reviewStatus === 'PENDING'))
})

test('no match proposals are generated from pending, rejected, non-actionable, or funding-domain notices', () => {
  const pending = reviewItem({
    id: 'RFP-PENDING',
    domain: 'procurement',
    reviewStatus: 'NEEDS_REVIEW',
    sourceId: TED_SOURCE_ID,
  })
  const closed = reviewItem({
    id: 'RFP-CLOSED',
    domain: 'procurement',
    reviewStatus: 'APPROVED',
    sourceId: TED_SOURCE_ID,
    sourceStatus: 'closed',
    rawType: 'can-award',
  })
  const funding = reviewItem({ id: 'OPP-1', domain: 'funding', reviewStatus: 'APPROVED' })

  assert.deepEqual(
    buildTargetCompanyProcurementMatchReviewItems(
      NOW,
      NOW,
      [pending, closed, funding],
      importedCompanies,
    ),
    [],
  )
})
