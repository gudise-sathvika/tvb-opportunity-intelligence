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
import { classifyOpportunityState } from '../automation/opportunity-status'
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

function capturingBridge(onRequest?: (request: GrantsGovBridgeSearchRequest) => void, hits: readonly unknown[] = HITS) {
  return async (request: GrantsGovBridgeSearchRequest): Promise<GrantsGovBridgeSearchResponse> => {
    onRequest?.(request)
    return { ok: true, status: 200, body: grantBody(hits) }
  }
}

test('the live run-scoped registry marks Grants.gov AVAILABLE and never mutates the global registry', () => {
  // Phase 02: a verified read-only search promoted Grants.gov to AVAILABLE globally.
  assert.equal(DEFAULT_SOURCE_REGISTRY.get(GRANTS_GOV_SOURCE_ID)?.accessState, 'AVAILABLE')

  const live = grantsGovLiveRegistry()
  assert.equal(live.get(GRANTS_GOV_SOURCE_ID)?.accessState, 'AVAILABLE')
  assert.equal(live.size, DEFAULT_SOURCE_REGISTRY.size)
  assert.equal(live.get('SU-US-001')?.accessState, DEFAULT_SOURCE_REGISTRY.get('SU-US-001')?.accessState)

  // The global registry is untouched (same value before and after building the view).
  assert.equal(DEFAULT_SOURCE_REGISTRY.get(GRANTS_GOV_SOURCE_ID)?.accessState, 'AVAILABLE')
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

test('Phase 01B: the shared ingest gate admits only open opportunities and preserves the rest', async () => {
  // One record per classifier state. `posted` with a future close is open;
  // every other status/date combination must be excluded, never presented open.
  const hits = [
    { id: '2001', title: 'OPEN', agencyName: 'A', openDate: '2026-01-01', closeDate: '2027-01-01', oppStatus: 'posted' },
    { id: '2002', title: 'FORTHCOMING', agencyName: 'A', openDate: '2026-01-01', closeDate: '2027-01-01', oppStatus: 'forecasted' },
    { id: '2003', title: 'EXPIRED', agencyName: 'A', openDate: '2025-01-01', closeDate: '2026-01-01', oppStatus: 'posted' },
    { id: '2004', title: 'CLOSED', agencyName: 'A', openDate: '2026-01-01', closeDate: '2027-01-01', oppStatus: 'closed' },
    { id: '2005', title: 'HISTORICAL', agencyName: 'A', openDate: '2026-01-01', closeDate: '2027-01-01', oppStatus: 'archived' },
    { id: '2006', title: 'UNKNOWN', agencyName: 'A', openDate: '2026-01-01', closeDate: '', oppStatus: 'posted' },
  ]
  const store = createLiveGrantsGovDiscovery({
    bridge: async () => ({ ok: true, status: 200, body: grantBody(hits) }),
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({ keyword: '', sector: 'all', location: 'all' })
  const company = await store.runCompany(context, 'Aavo')

  // The raw pool keeps every returned record (nothing is dropped at ingest).
  assert.deepEqual(company.candidates.map((c) => c.sourceRecordId), ['2001', '2002', '2003', '2004', '2005', '2006'])

  const states = company.candidates.map((c) => classifyOpportunityState(c, REQUESTED_AT).state)
  assert.deepEqual(states, ['open', 'forthcoming', 'expired', 'closed', 'historical', 'unknown'])

  // Only the single open record is actionable; the rest are preserved excluded.
  assert.deepEqual(company.actionableCandidates?.map((c) => c.sourceRecordId), ['2001'])
  assert.deepEqual(
    company.excludedCandidates?.map((c) => c.sourceRecordId),
    ['2002', '2003', '2004', '2005', '2006'],
  )
  for (const candidate of company.excludedCandidates ?? []) {
    assert.equal(candidate.provenance.sourceId, GRANTS_GOV_SOURCE_ID, 'excluded records keep full provenance')
  }
  assert.equal(
    (company.actionableCandidates?.length ?? 0) + (company.excludedCandidates?.length ?? 0),
    company.candidates.length,
    'each candidate is counted exactly once',
  )
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

const OPEN_HITS = [
  {
    id: '2001',
    number: 'DOE-C',
    title: 'OPEN SOLAR RESEARCH GRANT',
    agencyName: 'Department of Energy',
    openDate: '2026-01-15',
    closeDate: '12/01/2026',
    oppStatus: 'posted',
  },
  {
    id: '2002',
    number: 'DOE-D',
    title: 'OPEN WIND RESEARCH GRANT',
    agencyName: 'Department of Energy',
    openDate: '2026-02-01',
    closeDate: '12/15/2026',
    oppStatus: 'posted',
  },
]

test('Phase 15A: one shared pool yields canonical unassigned items, not company triplets', async () => {
  const requests: GrantsGovBridgeSearchRequest[] = []
  const store = createLiveGrantsGovDiscovery({
    bridge: capturingBridge((request) => requests.push(request), OPEN_HITS),
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({})
  const companies = [
    await store.runCompany(context, 'COSCI'),
    await store.runCompany(context, 'Datacolor AI'),
    await store.runCompany(context, 'DedicateusIT'),
  ]
  // One shared bridge request for the whole run, replayed per company.
  assert.equal(requests.length, 1)
  assert.equal(requests[0].companyId, GRANTS_GOV_LIVE_POOL_COMPANY_ID)
  const outcome = store.finishRun(context, companies)
  // Per-company display lists still show the shared pool each company saw…
  for (const company of companies) assert.equal(company.candidates.length, 2)
  // …but the review handoff carries one canonical item per unique record.
  assert.equal(outcome.reviewQueue.length, 2)
  assert.deepEqual(
    outcome.reviewQueue.map((item) => item.reviewId).sort(),
    ['RI:DC:SU-GRANTS-001:2001:NORMALIZED', 'RI:DC:SU-GRANTS-001:2002:NORMALIZED'],
  )
  for (const item of outcome.reviewQueue) {
    assert.equal(item.companyId, GRANTS_GOV_LIVE_POOL_COMPANY_ID)
    assert.ok(!item.reviewId.includes('#'), 'no occurrence suffix on canonical items')
  }
  assert.equal(outcome.needsReview, 2)
})

test('Phase 15A: approving a canonical item keeps queue, detail, and counts consistent', async () => {
  const { reviewFixtureStore } = await import('../automation/review-fixture')
  const { resolveReviewItem } = await import('../automation/review-source')
  const store = createLiveGrantsGovDiscovery({ bridge: capturingBridge(undefined, OPEN_HITS), requestedAt: REQUESTED_AT })
  const context = store.beginRun({})
  const outcome = store.finishRun(context, [await store.runCompany(context, 'COSCI')])
  try {
    reviewFixtureStore.addReviewItems(outcome.reviewQueue)
    const target = outcome.reviewQueue[0]
    reviewFixtureStore.apply({
      reviewId: target.reviewId,
      decision: 'APPROVED',
      reviewerId: 'reviewer-15a',
      decidedAt: REQUESTED_AT,
      reason: 'Verified against the live listing.',
    })
    const runIds = new Set(outcome.reviewQueue.map((item) => item.reviewId))
    const supplied = reviewFixtureStore.suppliedItems().filter((item) => runIds.has(item.reviewId))
    assert.equal(
      supplied.filter((item) => item.reviewStatus === 'NEEDS_REVIEW').length,
      1,
    )
    assert.equal(
      supplied.filter((item) => item.reviewStatus === 'APPROVED').length,
      1,
    )
    const detail = resolveReviewItem(target.reviewId, undefined)
    assert.ok(detail !== undefined && detail !== null)
    assert.equal(detail.reviewStatus, 'APPROVED')
    assert.equal(detail.candidateId, target.candidateId)
    assert.equal(detail.audit.length, 1)
  } finally {
    reviewFixtureStore.reset()
  }
})

test('Phase 15A: a historical run keeps its selection after later runs', async () => {
  const store = createLiveGrantsGovDiscovery({ bridge: capturingBridge(undefined, OPEN_HITS), requestedAt: REQUESTED_AT })
  const first = store.beginRun({ keyword: 'solar' })
  const firstOutcome = store.finishRun(first, [await store.runCompany(first, 'COSCI')])
  const second = store.beginRun({ keyword: 'wind' })
  const secondOutcome = store.finishRun(second, [await store.runCompany(second, 'DedicateusIT')])
  assert.deepEqual(firstOutcome.companyIds, ['COSCI'])
  assert.equal(firstOutcome.keyword, 'solar')
  assert.deepEqual(secondOutcome.companyIds, ['DedicateusIT'])
  assert.equal(secondOutcome.keyword, 'wind')
  assert.deepEqual(store.history().map((run) => run.runId), [firstOutcome.runId, secondOutcome.runId])
})
