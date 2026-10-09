/**
 * Phase 20B live Grants.gov funding-opportunity discovery — unit tests (offline).
 *
 * The store is exercised end-to-end through the REAL Grants.gov adapter, the
 * REAL Phase D orchestrator, and the REAL Phase E review queue, with the bridge
 * injected to answer a Grants.gov `search2`-shaped body — so no script touches
 * the network, the server, or the source.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_SOURCE_REGISTRY, GRANTS_GOV_SOURCE_ID } from '../automation/registry'
import {
  GRANTS_GOV_LIVE_POOL_COMPANY_ID,
  createLiveGrantsGovDiscovery,
  grantsGovLiveRegistry,
} from './live-grantsgov-discovery'
import type { GrantsGovBridgeSearchRequest, GrantsGovBridgeSearchResponse } from './grantsgov-bridge/contract'

const REQUESTED_AT = '2026-10-09T00:00:00.000Z'

function grantBody(oppHits: readonly unknown[]): string {
  return JSON.stringify({ errorcode: 0, msg: 'success', data: { hitCount: oppHits.length, oppHits, errorMsgs: [] } })
}

const HITS = [
  {
    id: '1001',
    number: 'DOE-A',
    title: 'SOLAR ENERGY RESEARCH GRANT',
    agencyName: 'Department of Energy',
    openDate: '2026-01-15',
    closeDate: '2026-04-30',
    oppStatus: 'posted',
  },
  {
    id: '1002',
    number: 'DOE-B',
    title: 'SOLAR ENERGY WORKFORCE OPPORTUNITY',
    agencyName: 'Department of Energy',
    openDate: '2026-02-01',
    closeDate: '2026-05-15',
    oppStatus: 'forecasted',
  },
]

function capturingBridge(onRequest?: (request: GrantsGovBridgeSearchRequest) => void) {
  return async (request: GrantsGovBridgeSearchRequest): Promise<GrantsGovBridgeSearchResponse> => {
    onRequest?.(request)
    return { ok: true, status: 200, body: grantBody(HITS) }
  }
}

test('the live run-scoped registry marks ONLY Grants.gov AVAILABLE and never mutates the global registry', () => {
  assert.equal(DEFAULT_SOURCE_REGISTRY.get(GRANTS_GOV_SOURCE_ID)?.accessState, 'UNKNOWN')

  const live = grantsGovLiveRegistry()
  assert.equal(live.get(GRANTS_GOV_SOURCE_ID)?.accessState, 'AVAILABLE')
  assert.equal(live.size, DEFAULT_SOURCE_REGISTRY.size)
  assert.equal(live.get('SU-US-001')?.accessState, DEFAULT_SOURCE_REGISTRY.get('SU-US-001')?.accessState)

  // The global registry is untouched.
  assert.equal(DEFAULT_SOURCE_REGISTRY.get(GRANTS_GOV_SOURCE_ID)?.accessState, 'UNKNOWN')
})

test('a live run with a recorded Grants.gov body goes through the real adapter, pipeline, and preserves source status', async () => {
  const requests: GrantsGovBridgeSearchRequest[] = []
  const store = createLiveGrantsGovDiscovery({
    bridge: capturingBridge((request) => requests.push(request)),
    requestedAt: REQUESTED_AT,
  })

  const context = store.beginRun({ keyword: 'solar energy', sector: 'energy', location: 'all' })
  assert.equal(context.runId, 'RUN-G-0001')
  assert.equal(context.domain, 'funding')
  assert.equal(context.oppStatuses, 'posted')
  assert.equal(context.limit, 10)

  const company = await store.runCompany(context, 'Aavo')
  assert.equal(company.runId, 'RUN-G-0001-Aavo')
  assert.equal(company.outcome, 'SUCCESS')
  assert.equal(company.sourceResults[0]?.sourceId, GRANTS_GOV_SOURCE_ID)
  assert.equal(company.sourceResults[0]?.sourceName, DEFAULT_SOURCE_REGISTRY.get(GRANTS_GOV_SOURCE_ID)?.name)
  assert.equal(company.candidates.length, 2)

  const statuses = company.candidates.map((candidate) => candidate.sourceStatus).sort()
  assert.deepEqual(statuses, ['forecasted', 'posted'])
  assert.equal(company.candidates[0]?.sourceUrl, 'https://www.grants.gov/search-results-detail/1001')

  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.runId, 'RUN-G-0001')
  assert.equal(requests[0]?.keyword, 'solar energy')
  assert.equal(requests[0]?.oppStatuses, 'posted')
  assert.equal(requests[0]?.limit, 10)

  const outcome = store.finishRun(context, [company])
  assert.equal(outcome.outcome, 'SUCCESS')
  assert.equal(outcome.counts.blockedSources, 0)
  assert.equal(outcome.counts.failedSources, 0)
  assert.equal(outcome.counts.candidatesCreated, 2)
})

test('the source applies the keyword: the store never drops returned records by a title substring (Phase 20E)', async () => {
  const store = createLiveGrantsGovDiscovery({ bridge: capturingBridge(), requestedAt: REQUESTED_AT })
  const context = store.beginRun({ keyword: 'wind', sector: 'all', location: 'all' })
  const company = await store.runCompany(context, 'Aavo')
  // The keyword is sent to the source; the adapter's results are authoritative.
  // A client-side title filter is NOT applied (it dropped real matches live).
  assert.equal(company.candidates.length, 2)
  assert.equal(company.candidates[0]?.provenance.queryTerm, 'wind')
})

test('a blank keyword runs a broad posted search, never a company-name substitution', async () => {
  const requests: GrantsGovBridgeSearchRequest[] = []
  const store = createLiveGrantsGovDiscovery({ bridge: capturingBridge((request) => requests.push(request)), requestedAt: REQUESTED_AT })
  const context = store.beginRun({ keyword: '', sector: 'all', location: 'all' })
  assert.equal(context.keyword, '')

  const company = await store.runCompany(context, 'Aavo')
  assert.equal(requests[0]?.keyword, '')
  assert.equal(requests[0]?.oppStatuses, 'posted')
  // All recorded hits are returned: broad discovery is not restricted by the company name.
  assert.equal(company.candidates.length, 2)
  assert.equal(company.candidates[0]?.provenance.queryTerm, null)
})

test('a run issues ONE shared search for every selected company and shares the pool without a match claim', async () => {
  const requests: GrantsGovBridgeSearchRequest[] = []
  const store = createLiveGrantsGovDiscovery({ bridge: capturingBridge((request) => requests.push(request)), requestedAt: REQUESTED_AT })
  const context = store.beginRun({ keyword: '', sector: 'all', location: 'all' })

  const a = await store.runCompany(context, 'Aavo')
  const b = await store.runCompany(context, 'Cisco')
  const c = await store.runCompany(context, 'EnergyX')

  // One network search for the whole run, carrying the run-level marker id.
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.runId, 'RUN-G-0001')
  assert.equal(requests[0]?.companyId, GRANTS_GOV_LIVE_POOL_COMPANY_ID)
  assert.equal(requests[0]?.keyword, '')

  // The same source pool for every company, but each candidate keeps its own
  // company provenance — the pool is shared, not attributed to a real company.
  const ids = (company: typeof a) => company.candidates.map((candidate) => candidate.candidateId)
  assert.deepEqual(ids(b), ids(a))
  assert.deepEqual(ids(c), ids(a))
  assert.equal(a.candidates[0]?.companyId, 'Aavo')
  assert.equal(b.candidates[0]?.companyId, 'Cisco')
  assert.equal(c.candidates[0]?.companyId, 'EnergyX')

  const outcome = store.finishRun(context, [a, b, c])
  assert.deepEqual(outcome.companyIds, ['Aavo', 'Cisco', 'EnergyX'])
  assert.equal(outcome.counts.candidatesCreated, 6)
})

test('a bridge failure is a real FAILED run, never an invented empty success', async () => {
  const store = createLiveGrantsGovDiscovery({
    bridge: async () => ({
      ok: false,
      status: 502,
      body: null,
      errors: [{ code: 'source_failure', message: 'live Grants.gov search failed: source unreachable' }],
    }),
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({ keyword: 'solar energy' })
  const company = await store.runCompany(context, 'Aavo')
  assert.equal(company.outcome, 'FAILED')
  assert.equal(company.candidates.length, 0)

  const outcome = store.finishRun(context, [company])
  assert.equal(outcome.outcome, 'FAILED')
  assert.equal(outcome.counts.failedSources, 1)
})
