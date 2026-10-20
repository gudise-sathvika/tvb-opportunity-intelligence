import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadTargetApplicationSelections, saveTargetApplicationSelection, updateTargetApplicationStatus } from './application-selection'

const store = new Map<string, string>()
const localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value)
  },
  removeItem: (key: string) => {
    store.delete(key)
  },
}
;(globalThis as any).localStorage = localStorage

function reset() {
  store.clear()
}

test('duplicate selections are prevented', () => {
  reset()
  const selection = {
    companyId: 'C1',
    companyName: 'ContextQA',
    opportunityId: 'O1',
    opportunityTitle: 'Grant',
    sourceUrl: 'https://example.org/o1',
    opportunityType: 'funding' as const,
    status: 'planned' as const,
    createdAt: '2026-10-20T00:00:00.000Z',
  }
  assert.equal(saveTargetApplicationSelection(selection), true)
  assert.equal(saveTargetApplicationSelection(selection), false)
  assert.equal(loadTargetApplicationSelections().length, 1)
})

test('status updates persist', () => {
  reset()
  const selection = {
    companyId: 'C2',
    companyName: 'flareAI',
    opportunityId: 'O2',
    opportunityTitle: 'Bid',
    sourceUrl: 'https://example.org/o2',
    opportunityType: 'procurement' as const,
    status: 'planned' as const,
    createdAt: '2026-10-20T00:00:00.000Z',
  }
  saveTargetApplicationSelection(selection)
  updateTargetApplicationStatus('C2', 'O2', 'submitted')
  assert.equal(loadTargetApplicationSelections()[0].status, 'submitted')
})