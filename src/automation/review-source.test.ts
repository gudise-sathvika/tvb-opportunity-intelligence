/**
 * Phase 01A tests: the human review queue keeps demonstration fixtures out of
 * production. Real mode shows only genuine supplied items (empty by default);
 * fixtures are reachable only through explicit demo mode.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { reviewFixtureStore } from './review-fixture'
import {
  demoReviewItems,
  isDemoReviewRequest,
  realReviewItems,
  resolveReviewItem,
  resolveReviewSource,
} from './review-source'

test('the default review queue is empty and never returns seed fixtures', () => {
  reviewFixtureStore.reset()
  try {
    assert.deepEqual(realReviewItems(), [])
    for (const flag of [null, undefined, '', '0', 'true', 'demo']) {
      const resolved = resolveReviewSource(flag)
      assert.equal(resolved.mode, 'real', `flag ${String(flag)} stays real`)
      assert.deepEqual(resolved.items, [])
    }
    assert.equal(isDemoReviewRequest('1'), true)
    assert.equal(isDemoReviewRequest(null), false)
  } finally {
    reviewFixtureStore.reset()
  }
})

test('only ?demo=1 reveals the seed fixtures', () => {
  reviewFixtureStore.reset()
  try {
    const resolved = resolveReviewSource('1')
    assert.equal(resolved.mode, 'demo')
    assert.equal(resolved.demo, true)
    assert.equal(resolved.items.length, 8, 'the demonstration seed is preserved')
    assert.equal(resolved.items, demoReviewItems())
    assert.ok(resolved.items.length > 0)
  } finally {
    reviewFixtureStore.reset()
  }
})

test('a supplied item appears in real mode; fixtures still do not', () => {
  reviewFixtureStore.reset()
  try {
    const fixture = reviewFixtureStore.fixtureItems()[0]
    assert.ok(fixture, 'a fixture seed exists')
    const supplied = { ...fixture, reviewId: 'RI:SUPPLIED-1' }
    reviewFixtureStore.addReviewItems([supplied])

    const real = realReviewItems()
    assert.equal(real.length, 1)
    assert.equal(real[0].reviewId, 'RI:SUPPLIED-1')
    assert.equal(real.includes(fixture), false, 'a fixture seed is never in the real queue')

    const demo = demoReviewItems()
    assert.equal(demo.length, 9, 'demo mode keeps fixtures and supplied items')
  } finally {
    reviewFixtureStore.reset()
  }
})

test('detail resolution is demo-gated for fixtures and real for supplied items', () => {
  reviewFixtureStore.reset()
  try {
    const fixture = reviewFixtureStore.fixtureItems()[0]
    const supplied = { ...fixture, reviewId: 'RI:SUPPLIED-2' }
    reviewFixtureStore.addReviewItems([supplied])

    assert.equal(resolveReviewItem(fixture.reviewId, null), undefined, 'fixture id is not-found in real mode')
    assert.equal(resolveReviewItem(fixture.reviewId, '1'), fixture, 'fixture id resolves in demo mode')
    assert.equal(resolveReviewItem('RI:SUPPLIED-2', null)?.reviewId, 'RI:SUPPLIED-2')
    assert.equal(resolveReviewItem(undefined, '1'), undefined)
  } finally {
    reviewFixtureStore.reset()
  }
})
