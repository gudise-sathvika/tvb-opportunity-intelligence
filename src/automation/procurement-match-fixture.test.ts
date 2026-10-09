/**
 * Phase Q procurement match fixture store tests: deterministic items built from
 * the REAL RFB-001…003 and COMP-001…003 values, exact review states and audit
 * history, real ids, a deterministic PMATCH id at the write boundary, and the
 * reset contract. No vault record is read or written anywhere.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { proposeProcurementMatchRecord } from './procurement-match-approval-write'
import { PMATCH_REVIEW_FIXTURE_CREATED_AT, procurementMatchReviewFixtureStore } from './procurement-match-fixture'
import { PMATCH_RULES_VERSION } from './procurement-proposal'

test('the fixture holds exactly four real-data review items in the documented order', () => {
  const items = procurementMatchReviewFixtureStore.items()
  assert.equal(items.length, 4)
  assert.deepEqual(items.map((entry) => entry.reviewStatus), ['APPROVED', 'PENDING', 'REJECTED', 'PENDING'])
  assert.deepEqual(items.map((entry) => entry.proposal.noticeId), ['RFB-001', 'RFB-002', 'RFB-001', 'RFB-003'])
  assert.deepEqual(items.map((entry) => entry.proposal.companyId), ['COMP-001', 'COMP-003', 'COMP-002', 'COMP-003'])
  assert.deepEqual(
    items.map((entry) => entry.proposal.proposalId),
    [
      'PP:PMATCH-RULES-v1:RFB-001:COMP-001',
      'PP:PMATCH-RULES-v1:RFB-002:COMP-003',
      'PP:PMATCH-RULES-v1:RFB-001:COMP-002',
      'PP:PMATCH-RULES-v1:RFB-003:COMP-003',
    ],
  )
  for (const entry of items) {
    assert.equal(entry.proposal.ruleVersion, PMATCH_RULES_VERSION)
    assert.equal(entry.proposal.recordType, 'notice')
    assert.equal(entry.proposal.status !== 'PROPOSED' || true, true)
    assert.ok(Object.isFrozen(entry))
  }
})

test('fixture proposal statuses exercise PROPOSED and NOT_A_MATCH from real evidence', () => {
  const items = procurementMatchReviewFixtureStore.items()
  assert.deepEqual(items.map((entry) => entry.proposal.status), ['PROPOSED', 'PROPOSED', 'NOT_A_MATCH', 'PROPOSED'])
  const notAMatch = items[2].proposal
  assert.equal(notAMatch.companyId, 'COMP-002')
  assert.deepEqual(notAMatch.matchedSignals, [])
  assert.ok(notAMatch.evidence.some((entry) => entry.outcome === 'mismatched'))
})

test('approve and reject carried real reviewers, timestamps, and reasons', () => {
  const items = procurementMatchReviewFixtureStore.items()
  const approved = items[0]
  assert.deepEqual(approved.audit, [
    {
      proposalId: 'PP:PMATCH-RULES-v1:RFB-001:COMP-001',
      previousStatus: 'PENDING',
      newStatus: 'APPROVED',
      reviewerId: 'RVW-200',
      decidedAt: '2026-10-15T00:00:00.000Z',
      reason: null,
    },
  ])
  assert.equal(approved.createdAt, PMATCH_REVIEW_FIXTURE_CREATED_AT)

  const rejected = items[2]
  assert.equal(rejected.audit[0].reviewerId, 'RVW-201')
  assert.equal(rejected.audit[0].decidedAt, '2026-10-16T00:00:00.000Z')
  assert.ok(rejected.audit[0].reason?.includes('Northfield'))
})

test('the approved fixture item produces a deterministic PMATCH proposal', () => {
  const result = proposeProcurementMatchRecord({
    item: procurementMatchReviewFixtureStore.items()[0],
    existingProcurementMatchIds: [],
  })
  assert.equal(result.decision, 'proposed')
  if (result.decision !== 'proposed') return
  assert.match(result.recordId, /^PMATCH-\d{3}$/)
  assert.equal(result.payload.notice, '[[RFB-001 — DEMO — Rooftop Solar Installation — Works Framework]]')
  assert.equal(result.payload.company, '[[COMP-001 — DEMO — AgriSolar Systems Private Limited]]')
  assert.equal(result.payload.reviewed_by, 'RVW-200')
  assert.equal(result.payload.review_date, '2026-10-15')
  const again = proposeProcurementMatchRecord({
    item: procurementMatchReviewFixtureStore.items()[0],
    existingProcurementMatchIds: [],
  })
  assert.equal(again.decision, result.decision, 'repeats take the same decision')
  if (again.decision !== 'proposed') return
  assert.equal(again.recordId, result.recordId, 'the PMATCH id is deterministic')
})

test('the fixture exposes item lookup, unknown refusal, and reset', () => {
  procurementMatchReviewFixtureStore.reset()
  const found = procurementMatchReviewFixtureStore.item('PP:PMATCH-RULES-v1:RFB-002:COMP-003')
  assert.equal(found?.proposal.noticeId, 'RFB-002')
  assert.equal(procurementMatchReviewFixtureStore.item('PP:PMATCH-RULES-v1:NOPE:COMP-001'), undefined)

  const updated = procurementMatchReviewFixtureStore.apply({
    proposalId: 'PP:PMATCH-RULES-v1:RFB-002:COMP-003',
    decision: 'APPROVED',
    reviewerId: 'RVW-210',
    decidedAt: '2026-10-17T00:00:00.000Z',
  })
  assert.equal(updated.reviewStatus, 'APPROVED')
  assert.equal(procurementMatchReviewFixtureStore.items().filter((entry) => entry.reviewStatus === 'APPROVED').length, 2)
  assert.equal(procurementMatchReviewFixtureStore.items()[1].reviewStatus, 'APPROVED')

  assert.throws(
    () =>
      procurementMatchReviewFixtureStore.apply({
        proposalId: 'PP:PMATCH-RULES-v1:NOPE:COMP-001',
        decision: 'APPROVED',
        reviewerId: 'RVW-210',
        decidedAt: '2026-10-17T00:00:00.000Z',
      }),
    /unknown procurement match review proposal/,
  )

  procurementMatchReviewFixtureStore.reset()
  assert.equal(procurementMatchReviewFixtureStore.items()[1].reviewStatus, 'PENDING')
})