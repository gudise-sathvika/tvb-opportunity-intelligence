/**
 * Phase M match review fixture tests: deterministic demo queue built through
 * the real engine and decision path — pending/approved/rejected counts,
 * frozen items, genuine MATCH-RULES-v1 proposals, and store reset.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MATCH_REVIEW_FIXTURE_CREATED_AT, matchReviewFixtureStore } from './match-review-fixture'

function counts() {
  const items = matchReviewFixtureStore.items()
  return {
    pending: items.filter((item) => item.reviewStatus === 'PENDING').length,
    approved: items.filter((item) => item.reviewStatus === 'APPROVED').length,
    rejected: items.filter((item) => item.reviewStatus === 'REJECTED').length,
  }
}

test('the fixture holds two pending, one approved, and one rejected review', () => {
  matchReviewFixtureStore.reset()
  const items = matchReviewFixtureStore.items()
  assert.equal(items.length, 4)
  assert.deepEqual(counts(), { pending: 2, approved: 1, rejected: 1 })
  assert.ok(Object.isFrozen(items))
  for (const item of items) {
    assert.equal(item.createdAt, MATCH_REVIEW_FIXTURE_CREATED_AT)
    assert.ok(Object.isFrozen(item))
    assert.ok(item.proposal.proposalId.startsWith('MP:MATCH-RULES-v1:'))
  }
})

test('approved and rejected items carry genuine human decisions', () => {
  matchReviewFixtureStore.reset()
  const approved = matchReviewFixtureStore.items().find((item) => item.reviewStatus === 'APPROVED')!
  assert.equal(approved.audit.length, 1)
  assert.equal(approved.audit[0].previousStatus, 'PENDING')
  assert.equal(approved.audit[0].newStatus, 'APPROVED')
  assert.equal(approved.audit[0].reviewerId, 'RVW-100')
  assert.equal(approved.proposal.status, 'PROPOSED')

  const rejected = matchReviewFixtureStore.items().find((item) => item.reviewStatus === 'REJECTED')!
  assert.equal(rejected.audit[0].reviewerId, 'RVW-101')
  assert.equal(rejected.proposal.status, 'NOT_A_MATCH', 'a human explicitly rejected the non-match')
})

test('store decisions land on pending items and reset restores the fixture', () => {
  matchReviewFixtureStore.reset()
  const pending = matchReviewFixtureStore.items().find((item) => item.reviewStatus === 'PENDING')!
  const updated = matchReviewFixtureStore.apply({
    proposalId: pending.proposal.proposalId,
    decision: 'APPROVED',
    reviewerId: 'RVW-900',
    decidedAt: '2026-10-12T00:00:00.000Z',
  })
  assert.equal(updated.reviewStatus, 'APPROVED')
  assert.deepEqual(counts(), { pending: 1, approved: 2, rejected: 1 })
  assert.throws(
    () => matchReviewFixtureStore.apply({ proposalId: 'MP:missing', decision: 'APPROVED', reviewerId: 'R', decidedAt: 'D' }),
    /unknown match review proposal/,
  )

  matchReviewFixtureStore.reset()
  assert.deepEqual(counts(), { pending: 2, approved: 1, rejected: 1 })
})
