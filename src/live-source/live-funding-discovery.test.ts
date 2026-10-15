/**
 * Phase 01B live USAspending discovery — actionability regression.
 *
 * USAspending returns obligated federal award HISTORY, not open solicitations.
 * The shared classifier must treat every record as `historical`, so the store
 * never builds an actionable-open pool and no record can be presented as open.
 * The bridge is injected with the recorded response — no network is touched.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { USA_SPENDING_SOURCE_ID } from '../automation/registry'
import { USA_SPENDING_SEARCH_RESPONSE_RECORDING } from '../automation/usaspending-fixture'
import { classifyOpportunityState, isActionableOpen } from '../automation/opportunity-status'
import { createLiveUsaSpendingDiscovery } from './live-funding-discovery'

const REQUESTED_AT = '2026-10-09T00:00:00.000Z'

test('Phase 01B: USAspending awards are always historical and never actionable open', async () => {
  const store = createLiveUsaSpendingDiscovery({
    bridge: async () => ({ ok: true, status: 200, body: USA_SPENDING_SEARCH_RESPONSE_RECORDING }),
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({ keyword: '', sector: 'all', location: 'all' })
  const company = await store.runCompany(context, 'Aavo')

  assert.equal(company.outcome, 'SUCCESS')
  assert.equal(company.candidates.length, 3)
  for (const candidate of company.candidates) {
    assert.equal(candidate.sourceId, USA_SPENDING_SOURCE_ID)
    assert.equal(classifyOpportunityState(candidate, REQUESTED_AT).state, 'historical')
    assert.equal(isActionableOpen(candidate, REQUESTED_AT), false)
  }

  // The store deliberately exposes no actionable-open pool for historical awards.
  assert.equal(company.actionableCandidates, undefined)
  assert.equal(company.excludedCandidates, undefined)
})
