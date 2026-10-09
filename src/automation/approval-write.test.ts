/**
 * Phase K approved-candidate Vault write boundary tests (dry-run proposer).
 *
 * Every approval below travels the REAL chain — engine → queue → human
 * decision — so the proofs hold for genuine APPROVED items, not hand-built
 * shapes: funding/procurement reach their boundary, non-approved states and
 * incomplete approval metadata are rejected, existing records conflict without
 * overwrite, provenance survives, nothing but opportunity/notice payloads can
 * come out, approval is never automatic, repeats are identical, and the
 * dry-run mutates nothing.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NOTICE_TYPE_VOCABULARY, proposeVaultWrite } from './approval-write'
import { discoveryFixtureStore } from './discovery-fixture'
import type { ReviewItem } from './review-queue'
import { applyReviewDecision } from './review-queue'
import { CONTROLLED_VALUES } from '../import/controlled-values'
import { SCHEMAS } from '../import/schema'

const REVIEWER = 'RVW-900'
const DECIDED_AT = '2026-10-09T00:00:00.000Z'
const EMPTY: readonly string[] = []

function approvedItem(domain: 'funding' | 'procurement', evidenceNotes: string | null = null): ReviewItem {
  discoveryFixtureStore.reset()
  const context = discoveryFixtureStore.beginRun({ domain })
  const company = discoveryFixtureStore.runCompany(context, 'COMP-001')
  const run = discoveryFixtureStore.finishRun(context, [company])
  const item = run.reviewQueue[0]
  assert.equal(item.reviewStatus, 'NEEDS_REVIEW', 'fixtures arrive needing a human — never pre-approved')
  return applyReviewDecision(item, {
    reviewId: item.reviewId,
    decision: 'APPROVED',
    reviewerId: REVIEWER,
    decidedAt: DECIDED_AT,
    ...(evidenceNotes === null ? {} : { evidenceNotes }),
  })
}

function decidedItem(domain: 'funding' | 'procurement', decision: 'REJECTED' | 'DUPLICATE' | 'BLOCKED'): ReviewItem {
  discoveryFixtureStore.reset()
  const context = discoveryFixtureStore.beginRun({ domain })
  const company = discoveryFixtureStore.runCompany(context, 'COMP-001')
  const run = discoveryFixtureStore.finishRun(context, [company])
  return applyReviewDecision(run.reviewQueue[0], {
    reviewId: run.reviewQueue[0].reviewId,
    decision,
    reviewerId: REVIEWER,
    decidedAt: DECIDED_AT,
    reason: 'phase-k test',
  })
}

test('an approved funding candidate reaches the Opportunity write boundary', () => {
  const item = approvedItem('funding', 'phase-k evidence')
  const result = proposeVaultWrite({ item, existingOpportunityIds: EMPTY, existingNoticeIds: EMPTY })
  assert.equal(result.decision, 'proposed')
  if (result.decision !== 'proposed') return
  assert.equal(result.targetType, 'opportunity')
  assert.match(result.recordId, /^OPP-\d{3}$/)
  assert.equal(result.payload.opportunity_id, result.recordId)
  assert.equal(result.payload.opportunity_name, 'Fixture Climate Innovation Grant Programme')
  assert.equal(result.payload.opportunity_type, 'Grant')
  assert.equal(result.payload.verification_status, 'Unverified')
  assert.equal(result.payload.source_url, item.sourceUrl)
  assert.ok(String(result.payload.notes).includes(item.reviewId))
  assert.ok(String(result.payload.notes).includes(item.candidateId))
  assert.ok(String(result.payload.notes).includes(item.sourceId))
  assert.ok(String(result.payload.notes).includes(REVIEWER))
  assert.ok(String(result.payload.notes).includes(DECIDED_AT))
  assert.ok(String(result.payload.notes).includes('phase-k evidence'))
  assert.ok(result.missingRequiredFields.includes('country'), 'no country on the item — stays missing')
  assert.ok(result.missingRequiredFields.includes('record_status'), 'lifecycle fact — never defaulted')
  assert.deepEqual(result.approval, { reviewId: item.reviewId, reviewerId: REVIEWER, decidedAt: DECIDED_AT })
  assert.ok(Object.isFrozen(result))
})

test('an approved procurement candidate reaches the Notice write boundary', () => {
  const item = approvedItem('procurement')
  const result = proposeVaultWrite({ item, existingOpportunityIds: EMPTY, existingNoticeIds: EMPTY })
  assert.equal(result.decision, 'proposed')
  if (result.decision !== 'proposed') return
  assert.equal(result.targetType, 'notice')
  assert.match(result.recordId, /^RFB-\d{3}$/)
  assert.equal(result.payload.notice_id, result.recordId)
  assert.equal(result.payload.notice_name, 'Fixture Framework Agreement for Construction Services')
  assert.equal(result.payload.notice_number, 'FX-P-1001', 'the source’s own number, not an invention')
  assert.equal(result.payload.notice_url, item.sourceUrl, 'the canonical location, per the schema')
  assert.equal(result.payload.notice_status, 'Draft')
  assert.ok(String(result.payload.notes).includes(REVIEWER))
  // Fills that travel from item facts only.
  assert.equal(result.payload.notice_type, 'RFB', 'a raw type that already is a schema value passes verbatim')
  assert.equal(
    result.payload.country,
    'Wonderland',
    'the source’s own country travels; the writer validates it against the vocabulary',
  )
  assert.ok(
    String(result.payload.description).startsWith('A deterministic local fixture listing'),
    'description comes from the source summary, verbatim',
  )
  assert.equal(result.payload.issue_date, '2026-09-01', 'publication date, ISO')
  assert.equal(result.payload.contract_type, 'Unknown', 'explicit absence — discovery carries no contract-nature fact')
  assert.equal(result.payload.lot_structure, 'Unknown', 'explicit absence — discovery carries no lot fact')
  // Facts the item and the vault do not carry stay missing.
  for (const field of ['procurement_method', 'procuring_entity']) {
    assert.ok(
      result.missingRequiredFields.includes(field),
      `${field} stays missing without a source fact or a real vault organization`,
    )
  }
  assert.ok(String(result.payload.notes).includes('Recorded values:'), 'defaults are disclosed in the provenance note')
})

test('every non-APPROVED state is rejected at the boundary', () => {
  const needs = approvedItem('funding')
  const pending: ReviewItem = { ...needs, reviewStatus: 'NEEDS_REVIEW', audit: [] }
  for (const item of [
    pending,
    { ...pending, reviewStatus: 'NEW' as const, audit: [] },
    decidedItem('funding', 'REJECTED'),
    decidedItem('funding', 'DUPLICATE'),
    decidedItem('procurement', 'BLOCKED'),
  ]) {
    const result = proposeVaultWrite({ item, existingOpportunityIds: EMPTY, existingNoticeIds: EMPTY })
    assert.equal(result.decision, 'rejected')
    assert.ok(result.decision === 'rejected' && result.reason.length > 0)
  }
})

test('APPROVED status alone is not enough without the human metadata', () => {
  const item = approvedItem('funding')
  const entry = item.audit[item.audit.length - 1]

  const noReviewer: ReviewItem = { ...item, audit: [{ ...entry, reviewerId: '' }] }
  assert.equal(
    proposeVaultWrite({ item: noReviewer, existingOpportunityIds: EMPTY, existingNoticeIds: EMPTY }).decision,
    'rejected',
  )

  const noTimestamp: ReviewItem = { ...item, audit: [{ ...entry, decidedAt: '' }] }
  assert.equal(
    proposeVaultWrite({ item: noTimestamp, existingOpportunityIds: EMPTY, existingNoticeIds: EMPTY }).decision,
    'rejected',
  )

  const noAudit: ReviewItem = { ...item, audit: [] }
  assert.equal(
    proposeVaultWrite({ item: noAudit, existingOpportunityIds: EMPTY, existingNoticeIds: EMPTY }).decision,
    'rejected',
  )
})

test('an existing record identity returns a conflict, never an overwrite', () => {
  for (const domain of ['funding', 'procurement'] as const) {
    const item = approvedItem(domain)
    const first = proposeVaultWrite({ item, existingOpportunityIds: EMPTY, existingNoticeIds: EMPTY })
    assert.equal(first.decision, 'proposed')
    if (first.decision !== 'proposed') continue
    const existing =
      domain === 'funding'
        ? { existingOpportunityIds: [first.recordId] as readonly string[], existingNoticeIds: EMPTY }
        : { existingOpportunityIds: EMPTY, existingNoticeIds: [first.recordId] as readonly string[] }
    const second = proposeVaultWrite({ item, ...existing })
    assert.equal(second.decision, 'conflict')
    if (second.decision !== 'conflict') continue
    assert.equal(second.recordId, first.recordId)
    assert.ok(second.reason.includes('already exists'))
  }
})

test('the boundary approves nothing and creates only opportunity/notice shapes', () => {
  const item = approvedItem('procurement')
  const before = { reviewStatus: item.reviewStatus, auditLength: item.audit.length }
  const rejected = proposeVaultWrite({ item: { ...item, reviewStatus: 'NEEDS_REVIEW', audit: [] }, existingOpportunityIds: EMPTY, existingNoticeIds: EMPTY })
  assert.equal(rejected.decision, 'rejected')
  assert.equal(item.reviewStatus, before.reviewStatus, 'the input item is untouched')
  assert.equal(item.audit.length, before.auditLength)

  const result = proposeVaultWrite({ item, existingOpportunityIds: EMPTY, existingNoticeIds: EMPTY })
  assert.equal(result.decision, 'proposed')
  if (result.decision !== 'proposed') return
  assert.ok(result.targetType === 'opportunity' || result.targetType === 'notice')
  // Every payload key is a declared field of the proposed record's own schema:
  // no Bid/Contract/Match/Application shape can leak out of this boundary.
  const allowed = new Set(SCHEMAS[result.targetType].map((field) => field.name))
  for (const key of Object.keys(result.payload)) {
    assert.ok(allowed.has(key), `field "${key}" is not part of the ${result.targetType} schema`)
  }
})

test('repeated proposals are identical and the dry-run mutates nothing', () => {
  const item = approvedItem('funding')
  const first = proposeVaultWrite({ item, existingOpportunityIds: EMPTY, existingNoticeIds: EMPTY })
  const second = proposeVaultWrite({ item, existingOpportunityIds: EMPTY, existingNoticeIds: EMPTY })
  assert.deepEqual(second, first)
  assert.ok(Object.isFrozen(first))
  if (first.decision === 'proposed') {
    assert.ok(Object.isFrozen(first.payload))
    assert.ok(Object.isFrozen(first.missingRequiredFields))
  }
})

test('the mirrored notice_type vocabulary stays identical to the schema', () => {
  assert.deepEqual([...NOTICE_TYPE_VOCABULARY], [...CONTROLLED_VALUES.notice_type])
})

test('raw notice types map to schema values only through documented rules', () => {
  const base = approvedItem('procurement')
  const withRawType = (rawType: string | null): ReviewItem => {
    assert.ok(base.normalization, 'the fixture pipeline normalizes')
    return {
      ...base,
      normalization: { ...base.normalization, rawType: { original: rawType, normalized: rawType } },
    }
  }
  const cases: ReadonlyArray<readonly [string | null, string | null, string | null]> = [
    ['cn-standard', 'Tender', 'Open'],
    ['cn-restricted', 'Tender', 'Limited'],
    ['cn-limited', 'Tender', 'Limited'],
    ['pin-competition', 'EOI', null],
    ['RFB', 'RFB', null],
    ['open-procedure', null, null],
    ['grant', null, null],
    [null, null, null],
  ]
  for (const [rawType, noticeType, method] of cases) {
    const result = proposeVaultWrite({
      item: withRawType(rawType),
      existingOpportunityIds: EMPTY,
      existingNoticeIds: EMPTY,
    })
    assert.equal(result.decision, 'proposed')
    if (result.decision !== 'proposed') continue
    if (noticeType === null) {
      assert.ok(result.missingRequiredFields.includes('notice_type'), `raw ${String(rawType)} → notice_type missing`)
    } else {
      assert.equal(result.payload.notice_type, noticeType, `raw ${String(rawType)}`)
    }
    if (method === null) {
      assert.ok(
        result.missingRequiredFields.includes('procurement_method'),
        `raw ${String(rawType)} → procurement_method missing`,
      )
    } else {
      assert.equal(result.payload.procurement_method, method, `raw ${String(rawType)}`)
    }
  }
})

test('procuring_entity resolves only against real vault organization records', () => {
  const item = approvedItem('procurement')
  const wrong = proposeVaultWrite({
    item,
    existingOpportunityIds: EMPTY,
    existingNoticeIds: EMPTY,
    existingOrganizationRefs: [{ id: 'ORG-101', name: 'Someone Else Entirely' }],
  })
  assert.equal(wrong.decision, 'proposed')
  if (wrong.decision === 'proposed') {
    assert.ok(wrong.missingRequiredFields.includes('procuring_entity'), 'no name match → no link')
    assert.equal(wrong.payload.procuring_entity, undefined)
  }

  const right = proposeVaultWrite({
    item,
    existingOpportunityIds: EMPTY,
    existingNoticeIds: EMPTY,
    existingOrganizationRefs: [{ id: 'ORG-900', name: 'Fixture Public Procurement Authority' }],
  })
  assert.equal(right.decision, 'proposed')
  if (right.decision === 'proposed') {
    assert.equal(
      right.payload.procuring_entity,
      '[[ORG-900 — Fixture Public Procurement Authority]]',
      "the vault's own record name, so the wikilink matches the file",
    )
    assert.ok(!right.missingRequiredFields.includes('procuring_entity'))
  }
})

test('notice fills without a source fact stay missing or fall back — never invented', () => {
  const base = approvedItem('procurement')
  assert.ok(base.normalization)
  const bare: ReviewItem = {
    ...base,
    normalization: {
      ...base.normalization,
      country: { original: null, normalized: null },
      summary: { original: null, normalized: null },
      publicationDate: { original: null, normalized: null },
      organization: { original: null, normalized: null },
      rawType: { original: null, normalized: null },
    },
  }
  const result = proposeVaultWrite({ item: bare, existingOpportunityIds: EMPTY, existingNoticeIds: EMPTY })
  assert.equal(result.decision, 'proposed')
  if (result.decision !== 'proposed') return
  for (const field of ['country', 'issue_date', 'notice_type', 'procurement_method', 'procuring_entity']) {
    assert.ok(result.missingRequiredFields.includes(field), `${field} has no source fact → missing`)
  }
  assert.equal(
    result.payload.description,
    bare.sourceTitle,
    'description falls back to the source title, disclosed — never left blank silently',
  )
  assert.ok(
    String(result.payload.notes).includes('Description recorded from the notice title'),
    'the fallback is disclosed in the provenance note',
  )
  assert.equal(result.payload.contract_type, 'Unknown')
  assert.equal(result.payload.lot_structure, 'Unknown')
})
