/**
 * Phase 21C live EU SEDIA discovery — offline unit tests.
 *
 * Exercises the store end-to-end through the REAL EU adapter, the REAL Phase D
 * orchestrator, and the REAL Phase E review queue, with the bridge injected to
 * answer a SEDIA-shaped body — no network is touched.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_SOURCE_REGISTRY, EU_SEDIA_SOURCE_ID } from '../automation/registry'
import { EU_SEDIA_LIVE_POOL_COMPANY_ID, createLiveEuSediaDiscovery, euSediaLiveRegistry } from './live-eu-sedia-discovery'
import type { EuSediaBridgeSearchRequest, EuSediaBridgeSearchResponse } from './eu-sedia-bridge/contract'

const REQUESTED_AT = '2026-10-09T00:00:00.000Z'

function record(reference: string, meta: Record<string, unknown>): Record<string, unknown> {
  return {
    reference,
    url: `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${reference}`,
    metadata: { DATASOURCE: ['SEDIA'], ...meta },
  }
}

const RESULTS = [
  record('HORIZON-A', {
    type: ['1'],
    status: ['31094502'],
    title: ['AI research grant'],
    callIdentifier: ['HORIZON-CL4'],
    deadlineDate: ['2026-12-01T17:00:00.000+01:00'],
  }),
  record('CASCADE-B', {
    type: ['8'],
    status: ['31094501'],
    title: ['Cascade funding call'],
    deadlineDate: ['2027-02-01T17:00:00.000+01:00'],
  }),
]

function capturingBridge(onRequest?: (request: EuSediaBridgeSearchRequest) => void) {
  return async (request: EuSediaBridgeSearchRequest): Promise<EuSediaBridgeSearchResponse> => {
    onRequest?.(request)
    return { ok: true, status: 200, body: JSON.stringify({ apiVersion: '1.0', totalResults: RESULTS.length, results: RESULTS }) }
  }
}

test('the live run-scoped registry marks ONLY the EU source AVAILABLE and never mutates the global registry', () => {
  assert.equal(DEFAULT_SOURCE_REGISTRY.get(EU_SEDIA_SOURCE_ID)?.accessState, 'UNKNOWN')
  const live = euSediaLiveRegistry()
  assert.equal(live.get(EU_SEDIA_SOURCE_ID)?.accessState, 'AVAILABLE')
  assert.equal(live.size, DEFAULT_SOURCE_REGISTRY.size)
  assert.equal(DEFAULT_SOURCE_REGISTRY.get(EU_SEDIA_SOURCE_ID)?.accessState, 'UNKNOWN')
})

test('a live run goes through the real adapter and pipeline, preserving EU status and raw type', async () => {
  const requests: EuSediaBridgeSearchRequest[] = []
  const store = createLiveEuSediaDiscovery({
    bridge: capturingBridge((request) => requests.push(request)),
    requestedAt: REQUESTED_AT,
  })

  const context = store.beginRun({ keyword: 'ai', sector: 'all', location: 'all' })
  assert.equal(context.runId, 'RUN-EU-0001')

  const company = await store.runCompany(context, 'Aavo')
  assert.equal(company.outcome, 'SUCCESS')
  assert.equal(company.sourceResults[0]?.sourceId, EU_SEDIA_SOURCE_ID)
  assert.equal(company.candidates.length, 2)
  const types = company.candidates.map((c) => c.sourceRawType).sort()
  assert.deepEqual(types, ['CASCADE_FUNDING_CALL', 'GRANT_TOPIC'])
  const statuses = company.candidates.map((c) => c.sourceStatus).sort()
  assert.deepEqual(statuses, ['forthcoming', 'open'])

  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.companyId, EU_SEDIA_LIVE_POOL_COMPANY_ID)

  const outcome = store.finishRun(context, [company])
  assert.equal(outcome.outcome, 'SUCCESS')
  assert.equal(outcome.counts.candidatesCreated, 2)
})

test('a run issues ONE shared search for every selected company without a match claim', async () => {
  const requests: EuSediaBridgeSearchRequest[] = []
  const store = createLiveEuSediaDiscovery({ bridge: capturingBridge((r) => requests.push(r)), requestedAt: REQUESTED_AT })
  const context = store.beginRun({ keyword: '', sector: 'all', location: 'all' })

  const a = await store.runCompany(context, 'Aavo')
  const b = await store.runCompany(context, 'Cisco')

  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.keyword, '')
  assert.equal(a.candidates[0]?.companyId, 'Aavo')
  assert.equal(b.candidates[0]?.companyId, 'Cisco')

  const outcome = store.finishRun(context, [a, b])
  assert.equal(outcome.counts.candidatesCreated, 4)
})

test('a bridge failure is a real FAILED run, never an invented empty success', async () => {
  const store = createLiveEuSediaDiscovery({
    bridge: async () => ({
      ok: false,
      status: 502,
      body: null,
      errors: [{ code: 'source_failure', message: 'live EU SEDIA search failed: source unreachable' }],
    }),
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({ keyword: 'ai' })
  const company = await store.runCompany(context, 'Aavo')
  assert.equal(company.outcome, 'FAILED')
  assert.equal(company.candidates.length, 0)
  const outcome = store.finishRun(context, [company])
  assert.equal(outcome.counts.failedSources, 1)
})
