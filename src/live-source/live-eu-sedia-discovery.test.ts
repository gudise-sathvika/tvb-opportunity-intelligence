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
import { classifyOpportunityState } from '../automation/opportunity-status'
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

test('the live run-scoped registry marks the EU source AVAILABLE and never mutates the global registry', () => {
  // Phase 02: a verified read-only search promoted the EU source to AVAILABLE globally.
  assert.equal(DEFAULT_SOURCE_REGISTRY.get(EU_SEDIA_SOURCE_ID)?.accessState, 'AVAILABLE')
  const live = euSediaLiveRegistry()
  assert.equal(live.get(EU_SEDIA_SOURCE_ID)?.accessState, 'AVAILABLE')
  assert.equal(live.size, DEFAULT_SOURCE_REGISTRY.size)
  // The global registry is untouched (same value before and after building the view).
  assert.equal(DEFAULT_SOURCE_REGISTRY.get(EU_SEDIA_SOURCE_ID)?.accessState, 'AVAILABLE')
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

test('Phase 01B: the shared ingest gate admits only open calls and preserves the rest', async () => {
  // One record per classifier state. Only `open` + a future deadline is
  // actionable; forthcoming/closed/expired and unknown are preserved excluded.
  const results = [
    record('OPEN', { type: ['1'], status: ['31094502'], title: ['Open call'], deadlineDate: ['2027-01-01T17:00:00.000+01:00'] }),
    record('FORTHCOMING', { type: ['1'], status: ['31094501'], title: ['Forthcoming call'], deadlineDate: ['2027-01-01T17:00:00.000+01:00'] }),
    record('EXPIRED', { type: ['1'], status: ['31094502'], title: ['Expired call'], deadlineDate: ['2026-01-01T17:00:00.000+01:00'] }),
    record('CLOSED', { type: ['1'], status: ['31094503'], title: ['Closed call'], deadlineDate: ['2027-01-01T17:00:00.000+01:00'] }),
    record('NO-DEADLINE', { type: ['1'], status: ['31094502'], title: ['Open call with no deadline'] }),
    record('BAD-STATUS', { type: ['1'], status: ['99999999'], title: ['Unrecognized status'], deadlineDate: ['2027-01-01T17:00:00.000+01:00'] }),
  ]
  const store = createLiveEuSediaDiscovery({
    bridge: async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ apiVersion: '1.0', totalResults: results.length, results }),
    }),
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({ keyword: '', sector: 'all', location: 'all' })
  const company = await store.runCompany(context, 'Aavo')

  // The raw pool keeps every returned record (nothing is dropped at ingest).
  assert.equal(company.candidates.length, 6)
  const states = company.candidates.map((c) => classifyOpportunityState(c, REQUESTED_AT).state)
  assert.deepEqual(states, ['open', 'forthcoming', 'expired', 'closed', 'unknown', 'unknown'])

  assert.deepEqual(company.actionableCandidates?.map((c) => c.sourceRecordId), ['OPEN'])
  assert.deepEqual(
    company.excludedCandidates?.map((c) => c.sourceRecordId),
    ['FORTHCOMING', 'EXPIRED', 'CLOSED', 'NO-DEADLINE', 'BAD-STATUS'],
  )
  for (const candidate of company.excludedCandidates ?? []) {
    assert.equal(candidate.provenance.sourceId, EU_SEDIA_SOURCE_ID, 'excluded records keep full provenance')
  }
  assert.equal(
    (company.actionableCandidates?.length ?? 0) + (company.excludedCandidates?.length ?? 0),
    company.candidates.length,
    'each candidate is counted exactly once',
  )
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
