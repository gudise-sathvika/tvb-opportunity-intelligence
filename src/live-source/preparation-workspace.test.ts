/**
 * Phase 33 preparation workspace tests — fully offline, fake storage only.
 *
 * Proves: workspaces open only for APPROVED items; checklist structure is
 * derived (documents included when evidenced); readiness follows the stated
 * rules; states/notes round-trip and survive reload-shaped resets; unknown ids
 * and missing storage fail honestly; two associations stay independent.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { discoveryFixtureStore } from '../automation/discovery-fixture'
import { reviewFixtureStore } from '../automation/review-fixture'
import {
  computeReadiness,
  deriveChecklist,
  loadWorkspace,
  setChecklistState,
  setWorkspaceNotes,
} from './preparation-workspace'
import type { PreparationStorage } from './preparation-workspace'

function fakeStorage(): PreparationStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => (values.has(key) ? (values.get(key) as string) : null),
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

function seedApproved(): string {
  reviewFixtureStore.reset()
  const context = discoveryFixtureStore.beginRun({ domain: 'funding', scenario: 'standard' })
  const outcome = discoveryFixtureStore.finishRun(context, [
    discoveryFixtureStore.runCompany(context, 'Aavo'),
    discoveryFixtureStore.runCompany(context, 'Arka VC'),
  ])
  reviewFixtureStore.addReviewItems(outcome.reviewQueue)
  discoveryFixtureStore.reset()
  const target = reviewFixtureStore.suppliedItems()[0]
  reviewFixtureStore.apply({
    reviewId: target.reviewId,
    decision: 'APPROVED',
    reviewerId: 'reviewer-33',
    decidedAt: '2026-10-15T01:00:00.000Z',
    reason: null,
  })
  return target.reviewId
}

test('readiness follows the stated rules and nothing else', () => {
  assert.equal(computeReadiness([], false, 0), 'unknown')
  assert.equal(computeReadiness(['pending', 'pending'], false, 2), 'unknown')
  assert.equal(computeReadiness(['done', 'pending'], false, 2), 'in_progress')
  assert.equal(computeReadiness(['pending'], true, 1), 'in_progress')
  assert.equal(computeReadiness(['done', 'done'], false, 2), 'ready')
  assert.equal(computeReadiness(['done', 'blocked'], false, 2), 'blocked')
  assert.equal(computeReadiness(['blocked'], false, 1), 'blocked')
})

test('missing and non-approved items are refused without guessing', () => {
  const storage = fakeStorage()
  try {
    reviewFixtureStore.reset()
    assert.equal(loadWorkspace('RI-NOPE', storage).ok, false)
    seedApproved()
    const pending = reviewFixtureStore.suppliedItems().find((item) => item.reviewStatus === 'NEEDS_REVIEW')
    assert.ok(pending !== undefined)
    const refused = loadWorkspace(pending.reviewId, storage)
    assert.equal(refused.ok, false)
  } finally {
    reviewFixtureStore.reset()
  }
})

test('checklist states and notes round-trip and survive reload', () => {
  const storage = fakeStorage()
  try {
    const reviewId = seedApproved()
    const first = loadWorkspace(reviewId, storage)
    assert.equal(first.ok, true)
    if (!first.ok) return
    assert.ok(first.workspace.items.length >= 3)
    assert.equal(first.workspace.readiness, 'unknown')

    const itemId = first.workspace.items[0].id
    assert.deepEqual(setChecklistState(reviewId, itemId, 'done', storage), { ok: true })
    assert.deepEqual(setWorkspaceNotes(reviewId, 'Called the helpdesk.', storage), { ok: true })
    assert.deepEqual(setChecklistState(reviewId, 'no-such-item', 'done', storage).ok, false)

    const second = loadWorkspace(reviewId, storage)
    assert.equal(second.ok, true)
    if (!second.ok) return
    assert.equal(second.workspace.items.find((entry) => entry.id === itemId)?.state, 'done')
    assert.equal(second.workspace.notes, 'Called the helpdesk.')
    assert.equal(second.workspace.readiness, 'in_progress')
  } finally {
    reviewFixtureStore.reset()
  }
})

test('two associations keep independent progress; null storage fails honestly', () => {
  const storage = fakeStorage()
  try {
    seedApproved()
    const [first, second] = reviewFixtureStore.suppliedItems()
    reviewFixtureStore.apply({
      reviewId: second.reviewId,
      decision: 'APPROVED',
      reviewerId: 'reviewer-33',
      decidedAt: '2026-10-15T02:00:00.000Z',
      reason: null,
    })
    const firstId = loadWorkspace(first.reviewId, storage)
    assert.equal(firstId.ok, true)
    if (!firstId.ok) return
    const itemId = firstId.workspace.items[0].id
    assert.deepEqual(setChecklistState(first.reviewId, itemId, 'blocked', storage), { ok: true })
    const other = loadWorkspace(second.reviewId, storage)
    assert.equal(other.ok, true)
    if (!other.ok) return
    assert.equal(other.workspace.items.find((entry) => entry.id === itemId)?.state, 'pending')
    assert.equal(other.workspace.readiness, 'unknown')
    assert.deepEqual(setChecklistState(first.reviewId, itemId, 'done', null).ok, false)
    assert.deepEqual(setWorkspaceNotes(first.reviewId, 'x', null).ok, false)
  } finally {
    reviewFixtureStore.reset()
  }
})

test('deriveChecklist adds one item per official document link', () => {
  const storage = fakeStorage()
  try {
    const reviewId = seedApproved()
    const item = reviewFixtureStore.item(reviewId)
    assert.ok(item !== undefined)
    const withDocs = { ...item, sourceEvidence: { ...(item.sourceEvidence ?? ({} as never)), documents: [{ label: 'Guide', url: 'https://ec.europa.eu/g.pdf' }] } } as typeof item
    void storage
    const list = deriveChecklist(withDocs)
    assert.equal(list.filter((entry) => entry.kind === 'document').length, 1)
    assert.equal(list.filter((entry) => entry.kind === 'verification').length, 3)
  } finally {
    reviewFixtureStore.reset()
  }
})
