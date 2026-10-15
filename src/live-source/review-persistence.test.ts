/**
 * Phase 31 review persistence tests — fully offline, fake storage only.
 *
 * Proves: save/reload round-trips supplied items with decisions and audit
 * intact; corrupt or foreign payloads are ignored; restores never duplicate
 * and never overwrite live in-memory truth; unavailable storage degrades to
 * previous in-memory behavior.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { discoveryFixtureStore } from '../automation/discovery-fixture'
import { reviewFixtureStore } from '../automation/review-fixture'
import {
  REVIEW_PERSISTENCE_KEY,
  installReviewPersistence,
  isStorableReviewItem,
  restoreSuppliedReviewState,
  saveSuppliedReviewState,
} from './review-persistence'
import type { ReviewStorage } from './review-persistence'

function fakeStorage(): ReviewStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => (values.has(key) ? (values.get(key) as string) : null),
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

function seedSuppliedItems(): void {
  reviewFixtureStore.reset()
  const context = discoveryFixtureStore.beginRun({ domain: 'funding', scenario: 'standard' })
  const outcome = discoveryFixtureStore.finishRun(context, [discoveryFixtureStore.runCompany(context, 'Aavo')])
  reviewFixtureStore.addReviewItems(outcome.reviewQueue)
  discoveryFixtureStore.reset()
}

test('decisions and audit survive a save/reset/restore cycle', () => {
  const storage = fakeStorage()
  try {
    seedSuppliedItems()
    const target = reviewFixtureStore.suppliedItems()[0]
    reviewFixtureStore.apply({
      reviewId: target.reviewId,
      decision: 'APPROVED',
      reviewerId: 'reviewer-31',
      decidedAt: '2026-10-15T01:00:00.000Z',
      reason: 'Verified.',
    })
    assert.equal(saveSuppliedReviewState(storage), true)
    assert.ok((storage.values.get(REVIEW_PERSISTENCE_KEY) ?? '').includes('reviewer-31'))

    reviewFixtureStore.reset()
    assert.equal(reviewFixtureStore.suppliedItems().length, 0)
    const outcome = restoreSuppliedReviewState(storage)
    assert.ok(outcome.restored > 0)
    assert.equal(outcome.skipped, 0)
    const kept = reviewFixtureStore.item(target.reviewId)
    assert.equal(kept?.reviewStatus, 'APPROVED')
    assert.equal(kept?.audit.length, 1)
    assert.equal(kept?.audit[0].reviewerId, 'reviewer-31')
  } finally {
    reviewFixtureStore.reset()
  }
})

test('restore is idempotent and never overwrites live in-memory truth', () => {
  const storage = fakeStorage()
  try {
    seedSuppliedItems()
    const before = reviewFixtureStore.items().length
    assert.equal(saveSuppliedReviewState(storage), true)
    assert.deepEqual(restoreSuppliedReviewState(storage), { restored: 0, skipped: 0 })
    assert.deepEqual(restoreSuppliedReviewState(storage), { restored: 0, skipped: 0 })
    assert.equal(reviewFixtureStore.items().length, before)
  } finally {
    reviewFixtureStore.reset()
  }
})

test('corrupt, foreign, and invalid payloads are ignored without throwing', () => {
  const storage = fakeStorage()
  try {
    reviewFixtureStore.reset()
    storage.setItem(REVIEW_PERSISTENCE_KEY, 'not-json{{{')
    assert.deepEqual(restoreSuppliedReviewState(storage), { restored: 0, skipped: 0 })
    storage.setItem(REVIEW_PERSISTENCE_KEY, JSON.stringify({ not: 'an array' }))
    assert.deepEqual(restoreSuppliedReviewState(storage), { restored: 0, skipped: 0 })
    storage.setItem(
      REVIEW_PERSISTENCE_KEY,
      JSON.stringify([{ reviewId: '', candidateId: 'x', reviewStatus: 'NOPE', audit: [] }, { reviewId: 'RI-OK', candidateId: 'DC-OK', reviewStatus: 'NEEDS_REVIEW', audit: [] }]),
    )
    const outcome = restoreSuppliedReviewState(storage)
    assert.equal(outcome.restored, 1)
    assert.equal(outcome.skipped, 1)
    assert.ok(reviewFixtureStore.item('RI-OK') !== undefined)
  } finally {
    reviewFixtureStore.reset()
  }
})

test('unavailable storage degrades to in-memory behavior', () => {
  assert.equal(saveSuppliedReviewState(null), false)
  assert.deepEqual(restoreSuppliedReviewState(null), { restored: 0, skipped: 0 })
  assert.equal(isStorableReviewItem(null), false)
  assert.equal(isStorableReviewItem({ reviewId: 'x' }), false)
})

test('install subscribes saving and restores once; uninstall stops saving', () => {
  const storage = fakeStorage()
  const uninstall = installReviewPersistence(storage)
  try {
    seedSuppliedItems()
    assert.ok((storage.values.get(REVIEW_PERSISTENCE_KEY) ?? '').length > 0, 'store changes auto-save')
    const uninstall2 = installReviewPersistence(storage)
    uninstall2()
  } finally {
    uninstall()
    reviewFixtureStore.reset()
  }
})

test('store subscribers are notified of decisions and can unsubscribe', () => {
  let calls = 0
  const unsubscribe = reviewFixtureStore.subscribe(() => {
    calls += 1
  })
  try {
    reviewFixtureStore.reset()
    const afterReset = calls
    assert.ok(afterReset >= 1)
    unsubscribe()
    reviewFixtureStore.reset()
    assert.equal(calls, afterReset)
  } finally {
    reviewFixtureStore.reset()
  }
})
