/**
 * Phase F local review fixture tests (Phase F brief §10, §16).
 *
 * These cover the deterministic mock store that backs the human review UI:
 * its item population, the contracts it satisfies, and the guarantee that the
 * store routes every decision through the real Phase E decision logic rather
 * than keeping a second state machine.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { reviewIdFor } from './review-queue'
import { buildInitialReviewItems, reviewFixtureStore } from './review-fixture'

const FIXED_DECIDED_AT = '2026-10-07T03:00:00.000Z'

test('the fixture queue is deterministic and carries the planned status mix', () => {
  const first = buildInitialReviewItems()
  const second = buildInitialReviewItems()

  assert.equal(first.length, 8)
  assert.deepEqual(
    first.map((entry) => entry.sourceRecordId),
    second.map((entry) => entry.sourceRecordId),
    'rebuilding the queue yields the same items in the same order',
  )

  const counts: Record<string, number> = {}
  for (const entry of first) counts[entry.reviewStatus] = (counts[entry.reviewStatus] ?? 0) + 1
  assert.deepEqual(counts, {
    NEEDS_REVIEW: 4,
    APPROVED: 1,
    REJECTED: 1,
    DUPLICATE: 1,
    BLOCKED: 1,
  })
})

test('every fixture item is a valid, deeply frozen review item', () => {
  for (const entry of buildInitialReviewItems()) {
    assert.ok(entry.reviewId.length > 0)
    assert.ok(Object.isFrozen(entry), `${entry.reviewId} item is frozen`)
    assert.ok(entry.normalization === null || Object.isFrozen(entry.normalization))
    assert.ok(entry.classification === null || Object.isFrozen(entry.classification))
    assert.ok(entry.duplicate === null || Object.isFrozen(entry.duplicate))
    assert.ok(Object.isFrozen(entry.provenance))
    assert.equal(entry.domain, entry.provenance.domain)
    // Human-decided terminals (APPROVED / REJECTED) always carry audit history;
    // candidate-derived terminals (DUPLICATE / BLOCKED) may not, exactly as the
    // real queue behaves.
    if (entry.reviewStatus === 'APPROVED' || entry.reviewStatus === 'REJECTED') {
      assert.ok(entry.audit.length > 0, `${entry.reviewId} has audit history`)
    }
    assert.ok(Array.isArray(entry.audit))
  }
})

test('the fixture queue derives review ids deterministically and uniquely', () => {
  const items = buildInitialReviewItems()
  const ids = items.map((entry) => entry.reviewId)
  assert.equal(new Set(ids).size, ids.length, 'review ids are unique')
  for (const id of ids) assert.ok(id.startsWith('RI:DC:'), `review id derives from the candidate: ${id}`)
})

test('the fixture exercises funding and procurement, but no other domain', () => {
  const items = buildInitialReviewItems()
  assert.ok(items.some((entry) => entry.domain === 'funding'))
  assert.ok(items.some((entry) => entry.domain === 'procurement'))
  for (const entry of items) assert.ok(['funding', 'procurement'].includes(entry.domain))
})

test('normalized dates and deadline are carried for display', () => {
  const items = buildInitialReviewItems()
  const framework = items.find((entry) => entry.sourceRecordId === 'FX-PRF-101')
  assert.ok(framework, 'FX-PRF-101 is present')
  assert.equal(framework.normalization?.deadline.normalized, '2026-10-30')
  assert.equal(framework.normalization?.deadline.original, '30-10-2026')
  assert.equal(framework.normalization?.publicationDate.normalized, '2026-09-22')

  const noDeadline = items.find((entry) => entry.sourceRecordId === 'FX-PRF-102')
  assert.ok(noDeadline, 'FX-PRF-102 is present')
  assert.equal(noDeadline.normalization?.deadline.normalized, null)
})

test('blocked and duplicate candidates surface their verdicts on the item', () => {
  const items = buildInitialReviewItems()

  const blocked = items.find((entry) => entry.sourceRecordId === 'FX-GR-203')
  assert.equal(blocked?.reviewStatus, 'BLOCKED')
  assert.equal(blocked?.normalization?.status, 'FAILED')
  assert.equal(blocked?.classification, null)
  assert.equal(blocked?.duplicate, null)
  assert.equal(blocked?.sourceTitle, '')

  const twin = items.find((entry) => entry.sourceRecordId === 'FX-PRF-103')
  assert.equal(twin?.reviewStatus, 'DUPLICATE')
  assert.equal(twin?.duplicate?.verdict, 'EXACT_DUPLICATE')
  assert.equal(twin?.duplicate?.evidence.otherCandidateId, 'DC:FX-PROC-001:FX-PRF-101')
  assert.equal(twin?.duplicate?.evidence.tier, 1)
})

test('the already-approved and already-rejected items carry real audit history', () => {
  const items = buildInitialReviewItems()

  const approved = items.find((entry) => entry.reviewStatus === 'APPROVED')
  assert.ok(approved)
  assert.equal(approved.audit.length, 1)
  assert.equal(approved.audit[0].previousStatus, 'NEEDS_REVIEW')
  assert.equal(approved.audit[0].newStatus, 'APPROVED')
  assert.equal(approved.audit[0].evidenceNotes, 'Verified against the source listing.')

  const rejected = items.find((entry) => entry.reviewStatus === 'REJECTED')
  assert.ok(rejected)
  assert.equal(rejected.audit.length, 1)
  assert.equal(rejected.audit[0].previousStatus, 'NEEDS_REVIEW')
  assert.equal(rejected.audit[0].newStatus, 'REJECTED')
  assert.equal(rejected.audit[0].reason, 'Opportunity outside our operating region.')
})

test('the store lists and fetches items by review id', () => {
  reviewFixtureStore.reset()
  const items = reviewFixtureStore.items()
  const first = items[0]
  assert.equal(reviewFixtureStore.item(first.reviewId), first)
  assert.equal(reviewFixtureStore.item('RI:does-not-exist'), undefined)
})

test('applying an approval runs through the real Phase E decision path', () => {
  reviewFixtureStore.reset()
  const target = reviewFixtureStore.items().find((entry) => entry.reviewStatus === 'NEEDS_REVIEW')
  assert.ok(target, 'there is a needs-review item to decide on')
  const idBefore = target.reviewId

  const updated = reviewFixtureStore.apply({
    reviewId: idBefore,
    decision: 'APPROVED',
    reviewerId: 'reviewer-qa',
    decidedAt: FIXED_DECIDED_AT,
    reason: null,
    evidenceNotes: 'QA approval.',
  })

  assert.equal(updated.reviewStatus, 'APPROVED')
  assert.equal(updated.updatedAt, FIXED_DECIDED_AT)
  assert.equal(updated.audit.length, 1)
  assert.equal(updated.audit[0].previousStatus, 'NEEDS_REVIEW')
  assert.equal(updated.audit[0].newStatus, 'APPROVED')
  assert.equal(updated.audit[0].reviewerId, 'reviewer-qa')
  assert.equal(updated.audit[0].evidenceNotes, 'QA approval.')

  const stored = reviewFixtureStore.item(idBefore)
  assert.equal(stored?.reviewStatus, 'APPROVED')
  assert.ok(
    !reviewFixtureStore.items().some((entry) => entry.reviewId === idBefore && entry.reviewStatus === 'NEEDS_REVIEW'),
    'the decided item left the needs-review set',
  )
})

test('a reviewer identity is required before a decision is committed', () => {
  reviewFixtureStore.reset()
  const target = reviewFixtureStore.items().find((entry) => entry.reviewStatus === 'NEEDS_REVIEW')
  assert.ok(target)

  assert.throws(
    () =>
      reviewFixtureStore.apply({
        reviewId: target.reviewId,
        decision: 'APPROVED',
        reviewerId: '',
        decidedAt: FIXED_DECIDED_AT,
        reason: null,
        evidenceNotes: null,
      }),
    /missing required field: reviewerId/,
  )
  assert.equal(reviewFixtureStore.item(target.reviewId)?.reviewStatus, 'NEEDS_REVIEW', 'nothing changed')
})

test('terminal items reject further decisions', () => {
  reviewFixtureStore.reset()
  const twin = reviewFixtureStore.items().find((entry) => entry.reviewStatus === 'DUPLICATE')
  assert.ok(twin)

  assert.throws(
    () =>
      reviewFixtureStore.apply({
        reviewId: twin.reviewId,
        decision: 'APPROVED',
        reviewerId: 'reviewer-qa',
        decidedAt: FIXED_DECIDED_AT,
        reason: null,
        evidenceNotes: null,
      }),
    /invalid review transition/,
  )
  assert.equal(reviewFixtureStore.item(twin.reviewId)?.reviewStatus, 'DUPLICATE', 'terminal status is preserved')
})

test('deciding an unknown review id is an error, not a silent write', () => {
  reviewFixtureStore.reset()
  assert.throws(
    () =>
      reviewFixtureStore.apply({
        reviewId: 'RI:DC:FX-FUND-001:nope',
        decision: 'APPROVED',
        reviewerId: 'reviewer-qa',
        decidedAt: FIXED_DECIDED_AT,
        reason: null,
        evidenceNotes: null,
      }),
    /review item not found/,
  )
  assert.equal(reviewFixtureStore.items().length, 8, 'the store is unchanged')
})

test('the duplicate-flavoured pending item can still be resolved by a human', () => {
  reviewFixtureStore.reset()
  const pending = reviewFixtureStore.items().find((entry) => entry.duplicate?.verdict === 'POSSIBLE_DUPLICATE')
  assert.equal(pending?.reviewStatus, 'NEEDS_REVIEW', 'a possible duplicate still needs the human')

  const resolved = reviewFixtureStore.apply({
    reviewId: pending.reviewId,
    decision: 'DUPLICATE',
    reviewerId: 'reviewer-qa',
    decidedAt: FIXED_DECIDED_AT,
    reason: 'Confirmed alongside the existing grant call.',
    evidenceNotes: null,
  })
  assert.equal(resolved.reviewStatus, 'DUPLICATE')
  assert.equal(resolved.audit[0].reason, 'Confirmed alongside the existing grant call.')
})

test('reset restores the pristine, deterministic queue', () => {
  reviewFixtureStore.reset()
  const target = reviewFixtureStore.items()[0]
  reviewFixtureStore.apply({
    reviewId: target.reviewId,
    decision: 'BLOCKED',
    reviewerId: 'reviewer-qa',
    decidedAt: FIXED_DECIDED_AT,
    reason: 'Test mutation.',
    evidenceNotes: null,
  })
  assert.notEqual(reviewFixtureStore.item(target.reviewId)?.reviewStatus, 'NEEDS_REVIEW')

  reviewFixtureStore.reset()
  const restored = reviewFixtureStore.item(target.reviewId)
  assert.equal(restored?.reviewStatus, 'NEEDS_REVIEW', 'reset restores the pristine queue')
  assert.equal(restored?.audit.length, 0)
})

test('fixture review ids follow the real Phase E derivation', () => {
  const items = buildInitialReviewItems()
  for (const entry of items) {
    assert.equal(entry.reviewId, reviewIdFor(entry.candidateId, entry.candidateStatus))
  }
})

test('addReviewItems appends new items, dedupes by review id, and reset restores the queue', () => {
  reviewFixtureStore.reset()
  assert.equal(reviewFixtureStore.items().length, 8)

  // A stand-in item produced by the real queue shape (the Phase G control panel
  // hands the store real createReviewQueue output; here we clone one item with
  // a fresh identity to exercise the store seam).
  const clone = JSON.parse(JSON.stringify(reviewFixtureStore.items()[0])) as Record<string, unknown>
  const extra = { ...clone, reviewId: 'RI:DC:PLACEHOLDER:EXTRA:NORMALIZED' }

  reviewFixtureStore.addReviewItems([])
  assert.equal(reviewFixtureStore.items().length, 8, 'an empty handoff is a no-op')

  reviewFixtureStore.addReviewItems([extra as never])
  assert.equal(reviewFixtureStore.items().length, 9)
  assert.ok(reviewFixtureStore.item('RI:DC:PLACEHOLDER:EXTRA:NORMALIZED'))

  reviewFixtureStore.addReviewItems([extra as never, ...reviewFixtureStore.items().slice(0, 2) as never[]])
  assert.equal(reviewFixtureStore.items().length, 9, 'identical review ids are never duplicated')

  assert.throws(
    () => reviewFixtureStore.addReviewItems([{ sourceTitle: 'no id' } as never]),
    /carry a reviewId/,
  )

  reviewFixtureStore.reset()
  assert.equal(reviewFixtureStore.item('RI:DC:PLACEHOLDER:EXTRA:NORMALIZED'), undefined)
  assert.equal(reviewFixtureStore.items().length, 8, 'reset restores the pristine queue')
})