/**
 * Phase 25 tests: the procurement queue keeps demo fixtures out of production.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  demoProcurementMatchReviewItems,
  realProcurementMatchReviewItems,
  resolveProcurementMatchSource,
} from './procurement-match-source'
import { procurementMatchReviewFixtureStore } from './procurement-match-fixture'

test('the production procurement queue is empty and never returns fixtures', () => {
  assert.deepEqual(realProcurementMatchReviewItems(), [])
  for (const flag of [null, undefined, '', '0', 'true', 'demo']) {
    const resolved = resolveProcurementMatchSource(flag)
    assert.equal(resolved.mode, 'real', `flag ${String(flag)} stays real`)
    assert.deepEqual(resolved.items, [])
  }
})

test('only ?demo=1 reveals the procurement fixtures, which remain intact', () => {
  const resolved = resolveProcurementMatchSource('1')
  assert.equal(resolved.mode, 'demo')
  assert.equal(resolved.demo, true)
  assert.equal(resolved.items.length, 4)
  assert.equal(resolved.items, demoProcurementMatchReviewItems())

  for (const item of resolved.items) {
    assert.ok((item.companyName ?? '').startsWith('DEMO —'), 'demo rows are labelled')
  }
  assert.equal(procurementMatchReviewFixtureStore.items().length, 4, 'fixtures preserved')
})
