/**
 * Phase 24 tests: fixture/demo proposals are isolated from the production
 * Match Review queue, and the production queue is honestly empty while no real
 * company records exist.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MATCH_REVIEW_DEMO_PARAM,
  MATCH_REVIEW_DEMO_VALUE,
  demoMatchReviewItems,
  isDemoMatchReviewRequest,
  realMatchReviewItems,
  resolveMatchReviewSource,
} from './match-review-source'
import { matchReviewFixtureStore } from './match-review-fixture'

test('the production queue is empty — no real proposals can be generated yet', () => {
  assert.deepEqual(realMatchReviewItems(), [])
  for (const flag of [null, undefined, '', '0', 'true', 'demo']) {
    const resolved = resolveMatchReviewSource(flag)
    assert.equal(resolved.mode, 'real', `flag ${String(flag)} stays in real mode`)
    assert.equal(resolved.demo, false)
    assert.deepEqual(resolved.items, [], `flag ${String(flag)} never returns fixtures`)
  }
})

test('only the explicit ?demo=1 flag reveals the fixture proposals', () => {
  assert.equal(isDemoMatchReviewRequest('1'), true)
  assert.equal(isDemoMatchReviewRequest('0'), false)
  assert.equal(MATCH_REVIEW_DEMO_PARAM, 'demo')
  assert.equal(MATCH_REVIEW_DEMO_VALUE, '1')

  const resolved = resolveMatchReviewSource(MATCH_REVIEW_DEMO_VALUE)
  assert.equal(resolved.mode, 'demo')
  assert.equal(resolved.demo, true)
  assert.equal(resolved.items.length, 4)
  assert.equal(resolved.items, demoMatchReviewItems())
})

test('every demo proposal is unmistakably fictional and fixture-scoped', () => {
  matchReviewFixtureStore.reset()
  const demo = demoMatchReviewItems()
  assert.equal(demo.length, 4)
  for (const item of demo) {
    assert.ok(
      (item.companyName ?? '').startsWith('DEMO —'),
      `${item.proposal.proposalId} must carry a DEMO company label`,
    )
    assert.match(item.proposal.sourceRecordId, /^FX-M-\d+$/, 'demo proposals reference fixture source records only')
    assert.ok(item.proposal.proposalId.includes(':FX-M-'), 'demo proposal id is fixture-scoped')
  }
  // The fixtures survive for tests and demo mode — nothing is deleted.
  assert.equal(matchReviewFixtureStore.items().length, 4)
})

test('no demo proposal references a real vault opportunity id', () => {
  for (const item of demoMatchReviewItems()) {
    assert.equal(
      item.proposal.sourceRecordId.startsWith('OPP-'),
      false,
      'a fixture proposal must never claim a real opportunity id',
    )
  }
})
