/**
 * Phase 4 live TED discovery — unit tests (fully offline).
 *
 * The store is exercised end-to-end through the REAL TED adapter, the REAL
 * Phase D orchestrator, and the REAL Phase E review queue, but with the bridge
 * injected to answer a byte-for-byte recorded TED response — so no script
 * touches the network, the server, or the source.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { TED_SOURCE_ID } from '../automation/registry'
import { TED_SEARCH_RESPONSE_RECORDING } from '../automation/ted-fixture'
import { createLiveTedDiscovery } from './live-discovery'
import type { TedBridgeSearchRequest, TedBridgeSearchResponse } from './ted-bridge/contract'

const REQUESTED_AT = '2026-10-09T00:00:00.000Z'
const LIVE_RECORDING: TedBridgeSearchResponse = { ok: true, status: 200, body: TED_SEARCH_RESPONSE_RECORDING }

function capturingBridge(onRequest?: (request: TedBridgeSearchRequest) => void) {
  return async (request: TedBridgeSearchRequest): Promise<TedBridgeSearchResponse> => {
    onRequest?.(request)
    return LIVE_RECORDING
  }
}

test('a live run with a recorded TED response goes through the real adapter and pipeline', async () => {
  const requests: TedBridgeSearchRequest[] = []
  const store = createLiveTedDiscovery({
    bridge: capturingBridge((request) => requests.push(request)),
    requestedAt: REQUESTED_AT,
  })

  const context = store.beginRun({ keyword: 'solar energy', sector: 'energy', location: 'all' })
  assert.equal(context.runId, 'RUN-T-0001')
  assert.equal(context.domain, 'procurement')
  assert.equal(context.scenario, 'live')
  assert.equal(context.keyword, 'solar energy')
  assert.equal(context.limit, 10)
  assert.match(context.publishedSince, /^20[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$/)

  const company = await store.runCompany(context, 'Aavo')
  assert.equal(company.companyId, 'Aavo')
  assert.equal(company.runId, 'RUN-T-0001-Aavo')
  assert.equal(company.scenario, 'live')
  assert.equal(company.outcome, 'SUCCESS')
  assert.equal(company.counts.candidatesReceived, 3)
  assert.equal(company.counts.candidatesCreated, 3)
  assert.equal(company.counts.duplicates, 0)
  assert.equal(company.needsReview, 3)
  assert.equal(company.sourceResults.length, 1)
  assert.equal(company.sourceResults[0].sourceId, TED_SOURCE_ID)
  assert.equal(company.sourceResults[0].outcome, 'SUCCESS')
  assert.equal(company.sourceResults[0].adapterType, 'ted')
  assert.equal(company.sourceResults[0].accessState, 'AVAILABLE')
  assert.deepEqual(
    company.candidates.map((candidate) => candidate.sourceRecordId),
    ['534463-2026', '535503-2026', '536878-2026'],
  )
  for (const candidate of company.candidates) {
    assert.equal(candidate.provenance.sourceId, TED_SOURCE_ID)
    assert.equal(candidate.provenance.observedAt, REQUESTED_AT)
  }

  assert.equal(requests.length, 1)
  assert.equal(requests[0].runId, 'RUN-T-0001')
  assert.equal(requests[0].companyId, 'Aavo')
  assert.equal(requests[0].keyword, 'solar energy')
  assert.equal(requests[0].limit, 10)
})

test('finishRun hands every live candidate into the real review queue', async () => {
  const store = createLiveTedDiscovery({ bridge: capturingBridge(), requestedAt: REQUESTED_AT })
  const context = store.beginRun({ keyword: 'solar energy' })

  const first = await store.runCompany(context, 'Aavo')
  const second = await store.runCompany(context, 'UT Austin')
  const outcome = store.finishRun(context, [first, second])

  assert.equal(outcome.runId, 'RUN-T-0001')
  assert.equal(outcome.scenario, 'live')
  assert.equal(outcome.domain, 'procurement')
  assert.equal(outcome.counts.candidatesReceived, 6)
  assert.equal(outcome.counts.candidatesCreated, 6)
  assert.equal(outcome.counts.duplicates, 0)
  assert.equal(outcome.needsReview, 6)
  assert.equal(outcome.outcome, 'SUCCESS')
  assert.equal(outcome.reviewQueue.length, 6)
  assert.equal(outcome.companyIds.length, 2)
  assert.equal(outcome.keyword, 'solar energy')

  const history = store.history()
  assert.equal(history.length, 1)
  assert.equal(history[0].runId, 'RUN-T-0001')
  assert.deepEqual(history[0].reviewQueue.map((item) => item.sourceRecordId), [
    '534463-2026',
    '535503-2026',
    '536878-2026',
    '534463-2026',
    '535503-2026',
    '536878-2026',
  ])
})

test('the ingest gate keeps only open notices actionable and preserves the rest', async () => {
  const openNotice = {
    'notice-type': 'cn-standard',
    'publication-number': '700001-2026',
    'notice-title': { eng: 'Open contract notice' },
    deadline: '2099-01-01',
    links: { html: { eng: 'https://ted.europa.eu/en/notice/-/detail/700001-2026' } },
  }
  const awardNotice = {
    'notice-type': 'can-standard',
    'publication-number': '700002-2026',
    'notice-title': { eng: 'Award notice' },
    links: { html: { eng: 'https://ted.europa.eu/en/notice/-/detail/700002-2026' } },
  }
  const noDeadlineNotice = {
    'notice-type': 'cn-standard',
    'publication-number': '700003-2026',
    'notice-title': { eng: 'Contract notice without a deadline' },
    links: { html: { eng: 'https://ted.europa.eu/en/notice/-/detail/700003-2026' } },
  }
  const body = JSON.stringify({ notices: [openNotice, awardNotice, noDeadlineNotice], totalNoticeCount: 3, timedOut: false })

  const store = createLiveTedDiscovery({
    bridge: async () => ({ ok: true, status: 200, body }),
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({})
  const company = await store.runCompany(context, 'Aavo')

  // All three records are preserved on the raw candidate pool...
  assert.equal(company.candidates.length, 3)
  // ...but only the future-deadline contract notice is actionable-open.
  assert.deepEqual(
    company.actionableCandidates?.map((candidate) => candidate.sourceRecordId),
    ['700001-2026'],
  )
  assert.deepEqual(
    company.excludedCandidates?.map((candidate) => candidate.sourceRecordId),
    ['700002-2026', '700003-2026'],
  )
  for (const candidate of company.excludedCandidates ?? []) {
    assert.equal(candidate.provenance.sourceId, TED_SOURCE_ID, 'excluded records keep full provenance')
  }
})

test('the no-deadline recorded TED notices are all excluded from the actionable pool', async () => {
  const store = createLiveTedDiscovery({ bridge: capturingBridge(), requestedAt: REQUESTED_AT })
  const context = store.beginRun({ keyword: 'solar energy' })
  const company = await store.runCompany(context, 'Aavo')
  assert.equal(company.candidates.length, 3)
  assert.equal(company.actionableCandidates?.length, 0, 'no recorded notice has a published deadline')
  assert.equal(company.excludedCandidates?.length, 3)
})

test('reset clears live history and restarts the run id counter', async () => {
  const store = createLiveTedDiscovery({ bridge: capturingBridge(), requestedAt: REQUESTED_AT })
  const context = store.beginRun({ keyword: 'solar energy' })
  const company = await store.runCompany(context, 'Aavo')
  store.finishRun(context, [company])
  assert.equal(store.history().length, 1)

  store.reset()
  assert.deepEqual(store.history(), [])
  assert.equal(store.beginRun({ keyword: 'solar energy' }).runId, 'RUN-T-0001')
})

test('an empty keyword falls back to the company name as the honest search term', async () => {
  const requests: TedBridgeSearchRequest[] = []
  const store = createLiveTedDiscovery({ bridge: capturingBridge((request) => requests.push(request)), requestedAt: REQUESTED_AT })
  const context = store.beginRun({})
  await store.runCompany(context, 'Aavo')
  assert.equal(requests[0].keyword, 'Aavo')
})

test('a bridge failure is a REAL FAILED source result, never an invented empty success', async () => {
  const store = createLiveTedDiscovery({
    bridge: async () => ({
      ok: false,
      status: 502,
      body: null,
      errors: [{ code: 'source_failure', message: 'live TED search failed: source unreachable' }],
    }),
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({ keyword: 'solar energy' })
  const company = await store.runCompany(context, 'Aavo')

  assert.equal(company.outcome, 'FAILED')
  assert.equal(company.needsReview, 0)
  assert.equal(company.candidates.length, 0)
  assert.equal(company.counts.candidatesReceived, 0)
  assert.equal(company.counts.failedSources, 1)
  assert.match(company.sourceResults[0].errors[0], /source unreachable/)

  const outcome = store.finishRun(context, [company])
  assert.equal(outcome.outcome, 'FAILED')
  assert.equal(outcome.counts.failedSources, 1)
})

test('a throwing bridge is reported as a failed source as well', async () => {
  const store = createLiveTedDiscovery({
    bridge: async () => {
      throw new Error('connection refused')
    },
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({ keyword: 'solar energy' })
  const company = await store.runCompany(context, 'Aavo')
  assert.equal(company.outcome, 'FAILED')
  assert.match(company.sourceResults[0].errors[0], /live TED search failed: connection refused/)
})

test('a source error status surfaces through the adapter as FAILED', async () => {
  const store = createLiveTedDiscovery({
    bridge: async () => ({ ok: true, status: 429, body: 'rate limited' }),
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({ keyword: 'solar energy' })
  const company = await store.runCompany(context, 'Aavo')
  assert.equal(company.outcome, 'FAILED')
  assert.equal(company.candidates.length, 0)
  assert.match(company.sourceResults[0].errors[0], /rate-limited/)
})

test('beginRun rejects an out-of-range limit', () => {
  const store = createLiveTedDiscovery({ bridge: capturingBridge(), requestedAt: REQUESTED_AT })
  assert.throws(() => store.beginRun({ keyword: 'solar energy', limit: 0 }), /between 1 and 100/)
  assert.throws(() => store.beginRun({ keyword: 'solar energy', limit: 101 }), /between 1 and 100/)
})

test('finishRun validates run membership, domain, and timestamps', async () => {
  const store = createLiveTedDiscovery({ bridge: capturingBridge(), requestedAt: REQUESTED_AT })
  const context = store.beginRun({ keyword: 'solar energy' })
  const company = await store.runCompany(context, 'Aavo')
  await assert.rejects(
    (async () => {
      const foreign = { ...company, runId: 'RUN-T-XXXX-Aavo' }
      store.finishRun(context, [foreign] as never)
    })(),
  )
})