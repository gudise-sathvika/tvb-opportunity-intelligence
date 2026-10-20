import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createTargetContract, loadTargetContracts } from './contract-selection'

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
;(globalThis as unknown as { localStorage: typeof localStorage }).localStorage = localStorage

function reset() {
  store.clear()
}

const award = {
  applicationId: 'C1:NOTICE-1',
  companyId: 'C1',
  companyName: 'Solar Works',
  opportunityId: 'NOTICE-1',
  opportunityTitle: 'Solar installation',
  sourceUrl: 'https://example.org/notices/1',
  status: 'draft' as const,
  awardConfirmedAt: '2026-10-20T13:00:00.000Z',
}

test('contract creation requires an explicit confirmed award timestamp', () => {
  reset()
  assert.equal(createTargetContract({ ...award, awardConfirmedAt: '' }), false)
  assert.deepEqual(loadTargetContracts(), [])
})

test('contract creation is explicit and duplicate award contracts are prevented', () => {
  reset()
  assert.equal(createTargetContract(award), true)
  assert.equal(loadTargetContracts().length, 1)
  assert.equal(
    createTargetContract({ ...award, applicationId: 'another-pursuit-id' }),
    false,
    'one company and underlying notice award cannot produce a duplicate contract',
  )
  assert.equal(loadTargetContracts().length, 1)
})
