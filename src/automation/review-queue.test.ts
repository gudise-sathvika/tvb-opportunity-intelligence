/**
 * Phase E human review queue tests (Phase E brief §12, §14, §15).
 *
 * Behavior under test:
 *  - candidate → review item conversion and the status mapping;
 *  - the review decision contract and its required reviewer/decidedAt fields;
 *  - the allowed state-transition table and rejection of every other move;
 *  - audit history accumulation (never overwritten);
 *  - immutability: the candidate is never mutated and decisions return new items;
 *  - funding/procurement separation and the no-vault / no-network boundary.
 *
 * All candidates are produced deterministically through the real Phase C
 * pipeline over synthetic fixture results — no network, no files, no clock.
 * Note: the Phase C pipeline collapses exact-duplicate twins onto the shared
 * candidateId, so a NORMALIZED candidate is built from distinct record ids
 * while a DUPLICATE candidate comes from its own identical-pair run.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { FIXTURE_FUNDING_SOURCE_ID, FIXTURE_PROCUREMENT_SOURCE_ID } from './registry'
import { buildPipelineResult } from './pipeline'
import { syntheticAdapterResult, makeRaw, fixtureRequest } from './phase-c-fixtures'
import { candidateFromRawResult } from './transform'
import {
  REVIEW_DECISIONS,
  REVIEW_STATUSES,
  TERMINAL_REVIEW_STATUSES,
  applyReviewDecision,
  canTransition,
  createReviewItem,
  createReviewQueue,
  filterReviewItemsByRun,
  nextReviewStatuses,
  reviewIdFor,
  validateReviewDecision,
  type ReviewAuditEntry,
  type ReviewDecisionInput,
  type ReviewItem,
} from './review-queue'

const REQUESTED_AT = '2026-10-07T00:00:00.000Z'
const DECIDED_AT = '2026-10-08T00:00:00.000Z'
const REVIEWER = 'USR-REVIEWER-1'

/** Distinct procurement candidates: two NORMALIZED RFB notices plus one BLOCKED blank. */
function procurementCandidates() {
  const request = fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID, runId: 'RUN-PHASEE-P', requestedAt: REQUESTED_AT })
  return buildPipelineResult(
    syntheticAdapterResult({
      request,
      sourceName: 'Fixture Procurement Portal (test)',
      adapterType: 'fixture',
      results: [
        makeRaw({
          sourceUrl: 'https://fixture.invalid/tenders/FX-P-1001',
          title: 'Fixture Framework Agreement for Construction Services',
          sourceRecordId: 'FX-P-1001',
          rawType: 'RFB',
          queryTerm: 'fixture',
        }),
        makeRaw({
          sourceUrl: 'https://fixture.invalid/tenders/FX-P-1002',
          title: 'Fixture Supply of Laboratory Equipment',
          sourceRecordId: 'FX-P-1002',
          rawType: 'RFB',
          queryTerm: 'fixture',
        }),
        makeRaw({
          sourceUrl: 'https://fixture.invalid/tenders/FX-P-BLANK',
          title: '   ',
          sourceRecordId: 'FX-P-BLANK',
          queryTerm: 'fixture',
        }),
      ],
    }),
  ).candidates
}

/** A DUPLICATE candidate produced by the pipeline from an identical record-id pair. */
function duplicateCandidates() {
  const request = fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID, runId: 'RUN-PHASEE-D', requestedAt: REQUESTED_AT })
  return buildPipelineResult(
    syntheticAdapterResult({
      request,
      sourceName: 'Fixture Procurement Portal (test)',
      adapterType: 'fixture',
      results: [
        makeRaw({
          sourceUrl: 'https://fixture.invalid/tenders/FX-D-3001',
          title: 'Fixture Framework Agreement for Construction Services',
          sourceRecordId: 'FX-D-3001',
          rawType: 'RFB',
          queryTerm: 'fixture',
        }),
        makeRaw({
          sourceUrl: 'https://fixture.invalid/tenders/FX-D-3001',
          title: 'Fixture Framework Agreement for Construction Services',
          sourceRecordId: 'FX-D-3001',
          rawType: 'RFB',
          queryTerm: 'fixture',
        }),
      ],
    }),
  ).candidates
}

/** Funding candidates: NORMALIZED Grant, REVIEW open call, BLOCKED blank. */
function fundingCandidates() {
  const request = fixtureRequest({ sourceId: FIXTURE_FUNDING_SOURCE_ID, domain: 'funding', runId: 'RUN-PHASEE-F', requestedAt: REQUESTED_AT })
  return buildPipelineResult(
    syntheticAdapterResult({
      request,
      sourceName: 'Fixture Grants Portal (test)',
      adapterType: 'fixture',
      results: [
        makeRaw({
          sourceUrl: 'https://fixture.invalid/grants/FX-F-2001',
          title: 'Fixture Climate Innovation Grant Programme',
          sourceRecordId: 'FX-F-2001',
          rawType: 'grant',
          queryTerm: 'fixture',
        }),
        makeRaw({
          sourceUrl: 'https://fixture.invalid/grants/FX-F-NR-1',
          title: 'Fixture Open Call for Community Innovators',
          rawType: null,
          sourceRecordId: 'FX-F-NR-1',
          queryTerm: 'fixture',
        }),
        makeRaw({
          sourceUrl: 'https://fixture.invalid/grants/FX-F-BLANK',
          title: '   ',
          sourceRecordId: 'FX-F-BLANK',
          queryTerm: 'fixture',
        }),
      ],
    }),
  ).candidates
}

/** A decision whose reviewId defaults to the item being decided. */
function decision(item: Pick<ReviewItem, 'reviewId'>, overrides: Partial<ReviewDecisionInput> = {}): ReviewDecisionInput {
  return {
    reviewId: overrides.reviewId ?? item.reviewId,
    decision: overrides.decision ?? 'APPROVED',
    reviewerId: overrides.reviewerId ?? REVIEWER,
    decidedAt: overrides.decidedAt ?? DECIDED_AT,
    ...(overrides.reason !== undefined ? { reason: overrides.reason } : {}),
    ...(overrides.evidenceNotes !== undefined ? { evidenceNotes: overrides.evidenceNotes } : {}),
  }
}

test('a NORMALIZED candidate converts to a NEEDS_REVIEW item preserving every candidate field', () => {
  const candidate = procurementCandidates()[0] ?? assert.fail('expected a candidate')
  assert.equal(candidate.candidateStatus, 'NORMALIZED')

  const item = createReviewItem(candidate)

  assert.equal(item.reviewStatus, 'NEEDS_REVIEW')
  assert.equal(item.candidateStatus, 'NORMALIZED')
  assert.equal(item.reviewId, 'RI:DC:SU-FX-001:FX-P-1001:NORMALIZED')
  assert.deepEqual(item.audit, [])
  assert.equal(item.createdAt, REQUESTED_AT)
  assert.equal(item.updatedAt, REQUESTED_AT)
  assert.equal(item.candidateId, candidate.candidateId)
  assert.equal(item.discoveryRunId, candidate.discoveryRunId)
  assert.equal(item.companyId, candidate.companyId)
  assert.equal(item.discoveryProfileId, candidate.discoveryProfileId)
  assert.equal(item.domain, 'procurement')
  assert.equal(item.sourceId, candidate.sourceId)
  assert.equal(item.sourceRecordId, 'FX-P-1001')
  assert.equal(item.sourceUrl, candidate.sourceUrl)
  assert.equal(item.sourceTitle, candidate.sourceTitle)
  assert.equal(item.candidateType, 'opportunity')
  assert.equal(item.classification?.state, candidate.classification?.state)
  assert.deepEqual(item.normalization, candidate.normalization)
  assert.equal(item.duplicate?.verdict, 'DISTINCT')
  assert.deepEqual(item.provenance, candidate.provenance, 'provenance is preserved exactly')
})

test('a REVIEW candidate converts to a NEEDS_REVIEW item', () => {
  const candidate = fundingCandidates()[1] ?? assert.fail('expected a candidate')
  assert.equal(candidate.candidateStatus, 'REVIEW')
  assert.equal(candidate.classification?.state, 'NEEDS_REVIEW')

  const item = createReviewItem(candidate)
  assert.equal(item.reviewStatus, 'NEEDS_REVIEW')
  assert.equal(item.candidateStatus, 'REVIEW')
})

test('a candidate already marked DUPLICATE converts to a terminal DUPLICATE item', () => {
  const candidate = duplicateCandidates()[0] ?? assert.fail('expected a candidate')
  assert.equal(candidate.candidateStatus, 'DUPLICATE')

  const item = createReviewItem(candidate)
  assert.equal(item.reviewStatus, 'DUPLICATE')
  assert.equal(item.duplicate?.verdict, 'EXACT_DUPLICATE', 'Phase C duplicate evidence is preserved')
  assert.ok((TERMINAL_REVIEW_STATUSES as readonly string[]).includes(item.reviewStatus))
})

test('a BLOCKED candidate converts to a terminal BLOCKED item', () => {
  const candidate = procurementCandidates()[2] ?? assert.fail('expected a candidate')
  assert.equal(candidate.candidateStatus, 'BLOCKED')

  const item = createReviewItem(candidate)
  assert.equal(item.reviewStatus, 'BLOCKED')
  assert.equal(item.candidateStatus, 'BLOCKED')
  assert.equal(item.classification, null)
})

test('a NEW candidate enters the queue as NEEDS_REVIEW', () => {
  const request = fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID })
  const adapterResult = syntheticAdapterResult({
    request,
    sourceName: 'Fixture Procurement Portal (test)',
    adapterType: 'fixture',
    results: [
      makeRaw({
        sourceUrl: 'https://fixture.invalid/tenders/FX-P-NEW',
        title: 'Fixture Fresh Tender',
        sourceRecordId: 'FX-P-NEW',
        queryTerm: 'fixture',
      }),
    ],
  })
  const candidate = candidateFromRawResult(adapterResult, adapterResult.results[0] ?? assert.fail('expected a raw result'))
  assert.equal(candidate.candidateStatus, 'NEW')

  const item = createReviewItem(candidate)
  assert.equal(item.reviewStatus, 'NEEDS_REVIEW')
  assert.equal(item.candidateStatus, 'NEW')
})

test('an APPROVED or REJECTED candidate never silently returns to NEW', () => {
  const candidate = procurementCandidates()[0] ?? assert.fail('expected a candidate')

  const approved = createReviewItem({ ...candidate, candidateStatus: 'APPROVED' })
  const rejected = createReviewItem({ ...candidate, candidateStatus: 'REJECTED' })

  assert.equal(approved.reviewStatus, 'APPROVED')
  assert.equal(rejected.reviewStatus, 'REJECTED')
  assert.notEqual(approved.reviewStatus, 'NEW')
  assert.notEqual(rejected.reviewStatus, 'NEW')
  assert.equal(canTransition('APPROVED', 'NEEDS_REVIEW'), false)
  assert.equal(canTransition('REJECTED', 'NEEDS_REVIEW'), false)
})

test('queue creation is deterministic, order-preserving, and never merges candidates', () => {
  const candidates = procurementCandidates()
  const items = createReviewQueue(candidates)

  assert.equal(items.length, 3)
  assert.deepEqual(
    items.map((item) => item.reviewStatus),
    ['NEEDS_REVIEW', 'NEEDS_REVIEW', 'BLOCKED'],
  )
  assert.deepEqual(
    items.map((item) => item.candidateStatus),
    ['NORMALIZED', 'NORMALIZED', 'BLOCKED'],
  )
  assert.deepEqual(
    items.map((item) => item.reviewId),
    [
      'RI:DC:SU-FX-001:FX-P-1001:NORMALIZED',
      'RI:DC:SU-FX-001:FX-P-1002:NORMALIZED',
      'RI:DC:SU-FX-001:FX-P-BLANK:BLOCKED',
    ],
  )

  const rebuilt = createReviewQueue(candidates)
  assert.deepEqual(items, rebuilt, 'identical inputs produce identical queues')
})

test('duplicate twins keep their own queue items and any identical snapshot gets a unique review id', () => {
  const candidates = duplicateCandidates()
  const items = createReviewQueue(candidates)

  assert.equal(items.length, 2)
  for (const item of items) {
    assert.equal(item.reviewStatus, 'DUPLICATE')
    assert.equal(item.candidateStatus, 'DUPLICATE')
  }
  const ids = items.map((item) => item.reviewId)
  assert.equal(new Set(ids).size, 2, 'every review id is unique')
  assert.deepEqual(ids, [
    'RI:DC:SU-FX-001:FX-D-3001:DUPLICATE',
    'RI:DC:SU-FX-001:FX-D-3001:DUPLICATE#1',
  ])

  const candidate = procurementCandidates()[0] ?? assert.fail('expected a candidate')
  assert.equal(reviewIdFor(candidate.candidateId, 'NORMALIZED'), 'RI:DC:SU-FX-001:FX-P-1001:NORMALIZED')
  assert.equal(reviewIdFor(candidate.candidateId, 'NORMALIZED', 2), 'RI:DC:SU-FX-001:FX-P-1001:NORMALIZED#2')
})

test('filterReviewItemsByRun scopes a cumulative store to exactly one run', () => {
  const procItems = createReviewQueue(procurementCandidates())
  const fundItems = createReviewQueue(fundingCandidates())
  const store = [...procItems, ...fundItems]

  const procScoped = filterReviewItemsByRun(store, 'RUN-PHASEE-P')
  assert.equal(procScoped.length, procItems.length)
  assert.ok(procScoped.every((item) => item.discoveryRunId === 'RUN-PHASEE-P'))

  const fundScoped = filterReviewItemsByRun(store, 'RUN-PHASEE-F')
  assert.equal(fundScoped.length, fundItems.length)
  assert.ok(fundScoped.every((item) => item.discoveryRunId === 'RUN-PHASEE-F'))

  assert.equal(filterReviewItemsByRun(store, 'RUN-DOES-NOT-EXIST').length, 0)
})

test('filterReviewItemsByRun matches a run\'s per-company child ids and never mutates its input', () => {
  const [item] = createReviewQueue(procurementCandidates())
  if (item === undefined) assert.fail('expected a review item')
  const childItem: ReviewItem = { ...item, discoveryRunId: 'RUN-EU-0001-ACME' }
  const store: readonly ReviewItem[] = [item, childItem]
  const snapshot = JSON.stringify(store)

  const scoped = filterReviewItemsByRun(store, 'RUN-EU-0001')
  assert.equal(scoped.length, 1, 'the child-id item matches its parent run')
  assert.equal(scoped[0]?.discoveryRunId, 'RUN-EU-0001-ACME')

  assert.equal(filterReviewItemsByRun(store, '  ').length, 2, 'blank run id returns the whole store')
  assert.equal(filterReviewItemsByRun(store, '').length, 2, 'empty run id returns the whole store')
  assert.equal(JSON.stringify(store), snapshot, 'the input store is never mutated')
})

test('an approval decision applies and records the full audit entry', () => {
  const item = createReviewQueue(procurementCandidates())[0] ?? assert.fail('expected an item')
  assert.equal(item.reviewStatus, 'NEEDS_REVIEW')

  const approved = applyReviewDecision(item, decision(item, {
    reason: 'eligibility confirmed',
    evidenceNotes: 'evidence source on file; organization matches',
  }))

  assert.equal(approved.reviewStatus, 'APPROVED')
  assert.equal(approved.updatedAt, DECIDED_AT)
  assert.equal(approved.candidateStatus, 'NORMALIZED', 'a decision never rewrites the candidate snapshot')
  assert.equal(approved.audit.length, 1)
  assert.deepEqual(approved.audit[0], {
    previousStatus: 'NEEDS_REVIEW',
    newStatus: 'APPROVED',
    reviewerId: REVIEWER,
    decidedAt: DECIDED_AT,
    reason: 'eligibility confirmed',
    evidenceNotes: 'evidence source on file; organization matches',
  })
})

test('a rejection decision applies and records reviewer and evidence', () => {
  const item = createReviewQueue(fundingCandidates())[0] ?? assert.fail('expected an item')

  const rejected = applyReviewDecision(item, decision(item, { decision: 'REJECTED', reason: 'no longer solicited' }))

  assert.equal(rejected.reviewStatus, 'REJECTED')
  assert.equal(rejected.audit[0]?.newStatus, 'REJECTED')
  assert.equal(rejected.audit[0]?.reviewerId, REVIEWER)
  assert.equal(rejected.audit[0]?.reason, 'no longer solicited')
  assert.equal(rejected.audit[0]?.evidenceNotes, null)
})

test('a duplicate decision resolves a needs-review item to DUPLICATE', () => {
  const item = createReviewQueue(fundingCandidates())[0] ?? assert.fail('expected an item')

  const dup = applyReviewDecision(item, decision(item, { decision: 'DUPLICATE', evidenceNotes: 'same notice as FX-F-2001' }))

  assert.equal(dup.reviewStatus, 'DUPLICATE')
  assert.equal(dup.audit[0]?.previousStatus, 'NEEDS_REVIEW')
  assert.equal(dup.audit[0]?.evidenceNotes, 'same notice as FX-F-2001')
})

test('a blocked decision applies from a needs-review item', () => {
  const item = createReviewQueue(fundingCandidates())[1] ?? assert.fail('expected an item')
  assert.equal(item.reviewStatus, 'NEEDS_REVIEW')

  const blocked = applyReviewDecision(item, decision(item, { decision: 'BLOCKED', reason: 'source access lapsed' }))

  assert.equal(blocked.reviewStatus, 'BLOCKED')
  assert.equal(blocked.audit[0]?.newStatus, 'BLOCKED')
})

test('a decision without a reviewerId is rejected', () => {
  const item = createReviewQueue(procurementCandidates())[0] ?? assert.fail('expected an item')

  const result = validateReviewDecision(decision(item, { reviewerId: '' }))
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.errors.some((error) => error.includes('reviewerId')))
  assert.throws(() => applyReviewDecision(item, decision(item, { reviewerId: '' })), /reviewerId/)
})

test('a decision without decidedAt is rejected', () => {
  const item = createReviewQueue(procurementCandidates())[0] ?? assert.fail('expected an item')

  const result = validateReviewDecision(decision(item, { decidedAt: '' }))
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.errors.some((error) => error.includes('decidedAt')))
  assert.throws(() => applyReviewDecision(item, decision(item, { decidedAt: '' })), /decidedAt/)
})

test('an invalid decision value is rejected', () => {
  const item = createReviewQueue(procurementCandidates())[0] ?? assert.fail('expected an item')

  const result = validateReviewDecision(decision(item, { decision: 'RECONSIDER' as ReviewDecisionInput['decision'] }))
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.errors.some((error) => error.includes('invalid decision')))
  assert.throws(
    () => applyReviewDecision(item, decision(item, { decision: 'RECONSIDER' as ReviewDecisionInput['decision'] })),
    /invalid decision/,
  )
})

test('a decision with a mismatched reviewId is rejected', () => {
  const item = createReviewQueue(procurementCandidates())[0] ?? assert.fail('expected an item')

  assert.throws(() => applyReviewDecision(item, decision(item, { reviewId: 'RI:some-other-item' })), /does not match/)
})

test('a decision on a terminal item is rejected as an invalid transition', () => {
  const items = createReviewQueue(procurementCandidates())
  const duplicateItem = createReviewQueue(duplicateCandidates())[0] ?? assert.fail('expected a DUPLICATE item')
  const blockedItem = items[2] ?? assert.fail('expected a BLOCKED item')

  assert.equal(duplicateItem.reviewStatus, 'DUPLICATE')
  assert.equal(blockedItem.reviewStatus, 'BLOCKED')
  assert.throws(() => applyReviewDecision(duplicateItem, decision(duplicateItem)), /invalid review transition/)
  assert.throws(() => applyReviewDecision(blockedItem, decision(blockedItem)), /invalid review transition/)
})

test('a terminal review status cannot be changed', () => {
  const item = createReviewQueue(procurementCandidates())[0] ?? assert.fail('expected an item')
  const approved = applyReviewDecision(item, decision(item, {}))

  assert.throws(
    () => applyReviewDecision(approved, decision(approved, { decision: 'REJECTED' })),
    /invalid review transition/,
  )
  assert.throws(
    () => applyReviewDecision(approved, decision(approved, { decision: 'APPROVED' })),
    /invalid review transition/,
  )
  assert.equal(approved.reviewStatus, 'APPROVED', 'the terminal status is unchanged')
})

test('the allowed transition set is exactly the documented one', () => {
  assert.deepEqual([...REVIEW_STATUSES], ['NEW', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'DUPLICATE', 'BLOCKED'])
  assert.deepEqual([...REVIEW_DECISIONS], ['APPROVED', 'REJECTED', 'DUPLICATE', 'BLOCKED'])
  assert.deepEqual([...TERMINAL_REVIEW_STATUSES], ['APPROVED', 'REJECTED', 'DUPLICATE', 'BLOCKED'])

  assert.deepEqual(nextReviewStatuses('NEW'), ['NEEDS_REVIEW'])
  assert.deepEqual(nextReviewStatuses('NEEDS_REVIEW'), ['APPROVED', 'REJECTED', 'DUPLICATE', 'BLOCKED'])

  assert.equal(canTransition('NEW', 'NEEDS_REVIEW'), true)
  for (const to of REVIEW_DECISIONS) {
    assert.equal(canTransition('NEEDS_REVIEW', to), true)
  }
  for (const from of ['APPROVED', 'REJECTED', 'DUPLICATE', 'BLOCKED'] as const) {
    assert.deepEqual(nextReviewStatuses(from), [], `${from} is terminal`)
    for (const to of REVIEW_STATUSES) {
      assert.equal(canTransition(from, to), false, `${from} -> ${to} must be rejected`)
      assert.equal(canTransition('NEW', to), to === 'NEEDS_REVIEW')
    }
  }
})

test('applying a decision never mutates the input item or overwrites its audit history', () => {
  const item = createReviewQueue(procurementCandidates())[0] ?? assert.fail('expected an item')
  const before = { ...item, audit: [...item.audit] }

  const approved = applyReviewDecision(item, decision(item, {}))

  assert.equal(item.reviewStatus, 'NEEDS_REVIEW', 'input item still needs review')
  assert.deepEqual(item.audit, [], 'input audit history is untouched')
  assert.deepEqual(item, before, 'input item is byte-identical after the decision')
  assert.notEqual(approved, item, 'a new item is returned')
  assert.equal(approved.audit.length, before.audit.length + 1, 'history appends, never replaces')

  const priorEntry: ReviewAuditEntry = { previousStatus: 'NEW', newStatus: 'NEEDS_REVIEW', reviewerId: REVIEWER, decidedAt: REQUESTED_AT, reason: null, evidenceNotes: null }
  const again = applyReviewDecision({ ...item, audit: [...item.audit, priorEntry] }, decision(item, {}))
  assert.equal(again.audit.length, 2, 'a second decision appends rather than rewrites history')
  assert.deepEqual(again.audit[0], priorEntry, 'the original history is preserved verbatim')
})

test('creating a review item never mutates the candidate', () => {
  const candidate = procurementCandidates()[0] ?? assert.fail('expected a candidate')
  const snapshot = structuredClone(candidate)

  const item = createReviewItem(candidate)

  assert.deepEqual(candidate, snapshot, 'the candidate object is unchanged')
  assert.ok(Object.isFrozen(candidate))
  assert.ok(Object.isFrozen(item))
  assert.ok(Object.isFrozen(item.provenance))
})

test('a candidate whose provenance domain disagrees is rejected, never silently relabeled', () => {
  const candidate = fundingCandidates()[0] ?? assert.fail('expected a candidate')
  const relabeled = { ...candidate, domain: 'procurement' as const }

  assert.throws(() => createReviewItem(relabeled), /domain/)
})

test('review items are frozen to the deepest level', () => {
  const item = createReviewQueue(fundingCandidates())[0] ?? assert.fail('expected an item')
  assert.ok(Object.isFrozen(item))
  assert.ok(Object.isFrozen(item.audit))
  assert.ok(Object.isFrozen(item.provenance))
  assert.ok(Object.isFrozen(item.normalization))
  assert.ok(Object.isFrozen(item.classification))
})

test('funding and procurement review items stay in their own sealed domains', () => {
  const funding = createReviewQueue(fundingCandidates())
  const procurement = createReviewQueue(procurementCandidates())

  for (const item of funding) {
    assert.equal(item.domain, 'funding')
    assert.equal(item.provenance.domain, 'funding')
    assert.equal(item.candidateType, 'opportunity')
    assert.ok(!['Notice', 'RFB'].includes(item.classification?.type ?? ''), 'funding items never become Notices')
  }
  for (const item of procurement) {
    assert.equal(item.domain, 'procurement')
    assert.equal(item.provenance.domain, 'procurement')
    assert.equal(item.candidateType, 'opportunity')
    assert.ok(!['Grant', 'Fund', 'Subsidy', 'Incentive', 'Program'].includes(item.classification?.type ?? ''))
  }
})

test('the review contract carries no vault record identity', () => {
  const source = readFileSync(new URL('./review-queue.ts', import.meta.url), 'utf8')
  const lowered = source.toLowerCase()
  for (const identity of ['opportunity_id', 'notice_id', 'match_id', 'bid_id', 'contract_id', 'vault_id']) {
    assert.equal(
      lowered.includes(identity.replace(/_/g, '')),
      false,
      `review contract must not leak a vault record identity: ${identity}`,
    )
  }
})

test('the review queue module performs no network, crypto, fs, scheduler, or vault-writer work', () => {
  const source = readFileSync(new URL('./review-queue.ts', import.meta.url), 'utf8')
  for (const token of [
    'fetch(',
    'axios',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'node:http',
    'node:https',
    'node:net',
    'node:fs',
    'node:crypto',
    'createHash',
    'crypto.',
    'child_process',
    'writeFile(',
    'appendFile(',
    'createWriteStream',
    'localStorage',
    'sessionStorage',
    'navigator.',
    'setInterval(',
    'setTimeout(',
    'import(',
  ]) {
    assert.equal(source.includes(token), false, `review-queue.ts must not contain "${token}"`)
  }
})

test('review queue creation and the decision path are pure and deterministic', () => {
  const input = fundingCandidates()
  const first = createReviewQueue(input)
  const second = createReviewQueue(input)
  assert.deepEqual(first, second)

  const item = first[0] ?? assert.fail('expected an item')
  const approvedA = applyReviewDecision(item, decision(item, {}))
  const approvedB = applyReviewDecision(item, decision(item, {}))
  assert.deepEqual(approvedA, approvedB)
})

test('a needs-review item with possible-duplicate evidence stays reviewable', () => {
  const item = createReviewQueue(fundingCandidates())[1] ?? assert.fail('expected the REVIEW item')
  assert.equal(item.reviewStatus, 'NEEDS_REVIEW', 'a possible-duplicate/REVIEW candidate remains NEEDS_REVIEW')

  const approved = applyReviewDecision(item, decision(item, {}))
  assert.equal(approved.reviewStatus, 'APPROVED', 'the reviewer may resolve a needs-review item')
})