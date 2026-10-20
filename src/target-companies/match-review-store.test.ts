import assert from 'node:assert/strict'
import { test } from 'node:test'

import { matchReviewFixtureStore } from '../automation/match-review-fixture'
import { procurementMatchReviewFixtureStore } from '../automation/procurement-match-fixture'
import {
  loadMatchReviewItems,
  saveMatchReviewItems,
  updateMatchReviewItem,
} from './match-review-store'
import {
  loadProcurementMatchReviewItems,
  saveProcurementMatchReviewItems,
  updateProcurementMatchReviewItem,
} from './procurement-match-review-store'

function memoryStorage() {
  const entries = new Map<string, string>()
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
  }
}

test('funding proposal persistence preserves human decisions when proposals are refreshed', () => {
  const storage = memoryStorage()
  const approved = matchReviewFixtureStore.items().find((item) => item.reviewStatus === 'APPROVED')
  assert.ok(approved)
  const refreshed = { ...approved, reviewStatus: 'PENDING' as const, audit: [] }

  assert.equal(saveMatchReviewItems([approved], storage), true)
  assert.equal(saveMatchReviewItems([refreshed], storage), true)
  assert.equal(loadMatchReviewItems(storage)[0].reviewStatus, 'APPROVED')

  const rejected = { ...approved, reviewStatus: 'REJECTED' as const }
  assert.equal(updateMatchReviewItem(rejected, storage), true)
  assert.equal(loadMatchReviewItems(storage)[0].reviewStatus, 'REJECTED')
})

test('procurement proposal persistence preserves review decisions across refreshes', () => {
  const storage = memoryStorage()
  const approved = procurementMatchReviewFixtureStore.items().find((item) => item.reviewStatus === 'APPROVED')
  assert.ok(approved)
  const refreshed = { ...approved, reviewStatus: 'PENDING' as const, audit: [] }

  assert.equal(saveProcurementMatchReviewItems([approved], storage), true)
  assert.equal(saveProcurementMatchReviewItems([refreshed], storage), true)
  assert.equal(loadProcurementMatchReviewItems(storage)[0].reviewStatus, 'APPROVED')

  const rejected = { ...approved, reviewStatus: 'REJECTED' as const }
  assert.equal(updateProcurementMatchReviewItem(rejected, storage), true)
  assert.equal(loadProcurementMatchReviewItems(storage)[0].reviewStatus, 'REJECTED')
})
