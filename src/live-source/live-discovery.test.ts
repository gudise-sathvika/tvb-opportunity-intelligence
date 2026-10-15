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

import { FTS_SOURCE_ID, TED_SOURCE_ID } from '../automation/registry'
import { TED_SEARCH_RESPONSE_RECORDING } from '../automation/ted-fixture'
import { FTS_LIVE_POOL_COMPANY_ID, createLiveTedDiscovery } from './live-discovery'
import type { TedBridgeSearchRequest, TedBridgeSearchResponse } from './ted-bridge/contract'
import type { FtsBridgeSearchRequest, FtsBridgeSearchResponse } from './fts-bridge/contract'

const REQUESTED_AT = '2026-10-09T00:00:00.000Z'
const LIVE_RECORDING: TedBridgeSearchResponse = { ok: true, status: 200, body: TED_SEARCH_RESPONSE_RECORDING }

/** Recorded-shape FTS OCDS body: one active tender with a future deadline, one completed record. */
const FTS_LIVE_RECORDING: FtsBridgeSearchResponse = {
  ok: true,
  status: 200,
  body: JSON.stringify({
    uri: 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=10',
    publishedDate: '2026-10-09T00:00:00+01:00',
    releases: [
      {
        ocid: 'ocds-h6vhtk-TEST01',
        id: '000001-2026',
        date: '2026-10-09T00:00:00+01:00',
        tender: {
          id: 'T-1',
          title: 'Testable Solar Energy Services Lot',
          description: 'A recorded test tender.',
          status: 'active',
          tenderPeriod: { endDate: '2026-12-31T12:00:00Z' },
          procurementMethod: 'open',
        },
        buyer: { name: 'Test Buyer' },
      },
      {
        ocid: 'ocds-h6vhtk-TEST02',
        id: '000002-2026',
        date: '2026-10-08T00:00:00+01:00',
        tender: {
          id: 'T-2',
          title: 'Completed Test Framework',
          status: 'complete',
          procurementMethod: 'selective',
        },
        buyer: { name: 'Test Buyer' },
      },
    ],
  }),
}

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
    'notice-title': { eng: 'Open solar contract notice' },
    deadline: '2099-01-01',
    links: { html: { eng: 'https://ted.europa.eu/en/notice/-/detail/700001-2026' } },
  }
  const awardNotice = {
    'notice-type': 'can-standard',
    'publication-number': '700002-2026',
    'notice-title': { eng: 'Solar award notice' },
    links: { html: { eng: 'https://ted.europa.eu/en/notice/-/detail/700002-2026' } },
  }
  const noDeadlineNotice = {
    'notice-type': 'cn-standard',
    'publication-number': '700003-2026',
    'notice-title': { eng: 'Solar contract notice without a deadline' },
    links: { html: { eng: 'https://ted.europa.eu/en/notice/-/detail/700003-2026' } },
  }
  const body = JSON.stringify({ notices: [openNotice, awardNotice, noDeadlineNotice], totalNoticeCount: 3, timedOut: false })

  const store = createLiveTedDiscovery({
    bridge: async () => ({ ok: true, status: 200, body }),
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({ keyword: 'solar' })
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

test('a blank keyword never becomes a company-name TED query', async () => {
  const requests: TedBridgeSearchRequest[] = []
  const store = createLiveTedDiscovery({
    bridge: capturingBridge((request) => requests.push(request)),
    ftsBridge: async (): Promise<FtsBridgeSearchResponse> => FTS_LIVE_RECORDING,
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({})
  // A company name must never stand in as a procurement-topic keyword: with no
  // keyword the run issues zero TED requests instead of confident-looking
  // zero-result company-name searches.
  await store.runCompany(context, 'CapitalstackAI')
  await store.runCompany(context, 'Centralogic')
  assert.equal(requests.length, 0)
})

test('a blank keyword without an FTS bridge refuses TED explicitly instead of guessing', async () => {
  const store = createLiveTedDiscovery({ bridge: capturingBridge(), requestedAt: REQUESTED_AT })
  const context = store.beginRun({})
  await assert.rejects(store.runCompany(context, 'Aavo'), /explicit procurement keyword/)
})

test('an explicit keyword still drives one TED title search per company', async () => {
  const requests: TedBridgeSearchRequest[] = []
  const store = createLiveTedDiscovery({ bridge: capturingBridge((request) => requests.push(request)), requestedAt: REQUESTED_AT })
  const context = store.beginRun({ keyword: 'solar energy' })
  await store.runCompany(context, 'Aavo')
  await store.runCompany(context, 'Arka VC')
  assert.equal(requests.length, 2)
  assert.ok(requests.every((request) => request.keyword === 'solar energy'))
})

test('a successful empty TED response is NO_RESULTS, never a failure', async () => {
  const store = createLiveTedDiscovery({
    bridge: async (): Promise<TedBridgeSearchResponse> => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ notices: [], totalNoticeCount: 0, timedOut: false }),
    }),
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({ keyword: 'CapitalstackAI' })
  const company = await store.runCompany(context, 'CapitalstackAI')
  assert.equal(company.outcome, 'NO_RESULTS')
  assert.equal(company.counts.failedSources, 0)
  assert.equal(company.counts.blockedSources, 0)
  assert.equal(company.sourceResults[0].outcome, 'NO_RESULTS')
  assert.equal(company.sourceResults[0].candidatesCreated, 0)
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
test('a run with an FTS bridge queries both TED and Find a Tender, sharing one FTS search', async () => {
  const tedRequests: TedBridgeSearchRequest[] = []
  const ftsRequests: FtsBridgeSearchRequest[] = []
  const store = createLiveTedDiscovery({
    bridge: capturingBridge((request) => tedRequests.push(request)),
    ftsBridge: async (request: FtsBridgeSearchRequest): Promise<FtsBridgeSearchResponse> => {
      ftsRequests.push(request)
      return FTS_LIVE_RECORDING
    },
    requestedAt: REQUESTED_AT,
  })

  const context = store.beginRun({ keyword: 'solar energy' })
  const first = await store.runCompany(context, 'Aavo')
  const second = await store.runCompany(context, 'Arka VC')

  // TED is still per-company; the broad FTS feed is fetched once per run.
  assert.equal(tedRequests.length, 2)
  assert.equal(ftsRequests.length, 1)
  assert.equal(ftsRequests[0].runId, 'RUN-T-0001')
  assert.equal(ftsRequests[0].companyId, FTS_LIVE_POOL_COMPANY_ID)

  for (const company of [first, second]) {
    assert.equal(company.outcome, 'SUCCESS')
    assert.equal(company.sourceResults.length, 2)
    assert.deepEqual(
      company.sourceResults.map((result) => result.sourceId),
      [TED_SOURCE_ID, FTS_SOURCE_ID],
    )
    const fts = company.sourceResults[1]
    assert.equal(fts.outcome, 'SUCCESS')
    assert.equal(fts.adapterType, 'fts')
    assert.equal(fts.accessState, 'AVAILABLE')
    // 3 recorded TED candidates + 2 recorded FTS candidates.
    assert.equal(company.counts.candidatesReceived, 5)
    assert.ok(company.candidates.some((candidate) => candidate.sourceRecordId === 'ocds-h6vhtk-TEST01'))
    // The active FTS tender with a future deadline passes the shared gate.
    assert.ok(
      (company.actionableCandidates ?? []).some((candidate) => candidate.sourceRecordId === 'ocds-h6vhtk-TEST01'),
      'expected the active FTS tender to be actionable',
    )
  }

  const outcome = store.finishRun(context, [first, second])
  assert.equal(outcome.outcome, 'SUCCESS')
  assert.equal(outcome.counts.totalSources, 4)
})

test('an FTS bridge failure is a REAL FAILED source result alongside the TED result', async () => {
  const store = createLiveTedDiscovery({
    bridge: capturingBridge(),
    ftsBridge: async () => ({
      ok: false,
      status: 502,
      body: null,
      errors: [{ code: 'source_failure', message: 'live Find a Tender search failed: source unreachable' }],
    }),
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({ keyword: 'solar energy' })
  const company = await store.runCompany(context, 'Aavo')

  assert.equal(company.sourceResults.length, 2)
  assert.equal(company.sourceResults[1].sourceId, FTS_SOURCE_ID)
  assert.equal(company.sourceResults[1].outcome, 'FAILED')
  assert.match(company.sourceResults[1].errors[0], /source unreachable/)
  assert.equal(company.counts.failedSources, 1)
  // TED candidates still flow; one failed source never erases the other.
  assert.ok(company.candidates.length > 0)
})

test('without an FTS bridge the run stays TED-only', async () => {
  const store = createLiveTedDiscovery({ bridge: capturingBridge(), requestedAt: REQUESTED_AT })
  const context = store.beginRun({ keyword: 'solar energy' })
  const company = await store.runCompany(context, 'Aavo')
  assert.equal(company.sourceResults.length, 1)
  assert.equal(company.sourceResults[0].sourceId, TED_SOURCE_ID)
})

test('finishRun hands one canonical unassigned FTS item per notice, never one per company', async () => {
  const tedRequests: TedBridgeSearchRequest[] = []
  const store = createLiveTedDiscovery({
    bridge: capturingBridge((request) => tedRequests.push(request)),
    ftsBridge: async (): Promise<FtsBridgeSearchResponse> => FTS_LIVE_RECORDING,
    requestedAt: REQUESTED_AT,
  })
  // Three companies replay the SAME shared FTS response — the screenshot's 6x3 shape.
  // Blank keyword: TED is skipped as insufficiently specified (no company-name
  // fallback), so no TED bridge call happens at all.
  const context = store.beginRun({})
  const companies = [await store.runCompany(context, 'Aavo'), await store.runCompany(context, 'Arka VC'), await store.runCompany(context, 'Avasant')]
  const outcome = store.finishRun(context, companies)
  assert.equal(tedRequests.length, 0)

  const ftsItems = outcome.reviewQueue.filter((item) => item.sourceId === FTS_SOURCE_ID)
  // Two recorded FTS notices -> exactly two review items (was six: #0, #1, #2 per notice).
  assert.equal(ftsItems.length, 2)
  assert.deepEqual(
    ftsItems.map((item) => item.sourceRecordId).sort(),
    ['ocds-h6vhtk-TEST01', 'ocds-h6vhtk-TEST02'],
  )
  for (const item of ftsItems) {
    assert.ok(!item.reviewId.includes('#'), `expected no collision suffix, got ${item.reviewId}`)
    assert.equal(item.companyId, FTS_LIVE_POOL_COMPANY_ID)
    assert.equal(item.provenance.companyId, FTS_LIVE_POOL_COMPANY_ID)
  }
  // TED did not run: no TED items, and every company result is FTS-only.
  assert.equal(outcome.reviewQueue.filter((item) => item.sourceId === TED_SOURCE_ID).length, 0)
  for (const company of companies) {
    assert.deepEqual(company.sourceResults.map((result) => result.sourceId), [FTS_SOURCE_ID])
  }
})

test('canonical FTS review ids are stable across runs with different company sets', async () => {
  const fts = async (): Promise<FtsBridgeSearchResponse> => FTS_LIVE_RECORDING
  const first = createLiveTedDiscovery({ bridge: capturingBridge(), ftsBridge: fts, requestedAt: REQUESTED_AT })
  const c1 = first.beginRun({})
  const o1 = first.finishRun(c1, [await first.runCompany(c1, 'Aavo'), await first.runCompany(c1, 'Arka VC')])

  const second = createLiveTedDiscovery({ bridge: capturingBridge(), ftsBridge: fts, requestedAt: REQUESTED_AT })
  const c2 = second.beginRun({})
  const o2 = second.finishRun(c2, [await second.runCompany(c2, 'Avasant')])

  const ids = (o: typeof o1) => o.reviewQueue.filter((i) => i.sourceId === FTS_SOURCE_ID).map((i) => i.reviewId).sort()
  assert.deepEqual(ids(o1), ids(o2))
  assert.deepEqual(ids(o1), [
    'RI:DC:SU-FTS-001:ocds-h6vhtk-TEST01:NORMALIZED',
    'RI:DC:SU-FTS-001:ocds-h6vhtk-TEST02:NORMALIZED',
  ])
})

test('re-adding an identical handoff creates no new items and preserves human decisions', async () => {
  const { reviewFixtureStore } = await import('../automation/review-fixture')
  const store = createLiveTedDiscovery({
    bridge: capturingBridge(),
    ftsBridge: async (): Promise<FtsBridgeSearchResponse> => FTS_LIVE_RECORDING,
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({})
  const outcome = store.finishRun(context, [await store.runCompany(context, 'Aavo')])
  try {
    // Earlier tests in this file already handed identical recorded queues to
    // the global store — which itself proves cross-run idempotency. Here we
    // assert the re-add path directly: adding twice never grows the store.
    reviewFixtureStore.addReviewItems(outcome.reviewQueue)
    const afterFirstAdd = reviewFixtureStore.items().length

    // A human decides on the canonical FTS item...
    const target = reviewFixtureStore.suppliedItems().find((i) => i.sourceRecordId === 'ocds-h6vhtk-TEST01')
    assert.ok(target)
    reviewFixtureStore.apply({
      reviewId: target.reviewId,
      decision: 'APPROVED',
      reviewerId: 'reviewer-9',
      decidedAt: REQUESTED_AT,
      reason: 'Verified against the source listing.',
    })

    // ...then the same notice is retrieved again: nothing new appears, and the
    // decision (with its audit entry) is intact.
    reviewFixtureStore.addReviewItems(outcome.reviewQueue)
    assert.equal(reviewFixtureStore.items().length, afterFirstAdd)
    const kept = reviewFixtureStore.item(target.reviewId)
    assert.equal(kept?.reviewStatus, 'APPROVED')
    assert.equal(kept?.audit.length, 1)
    assert.equal(kept?.audit[0].reviewerId, 'reviewer-9')
  } finally {
    reviewFixtureStore.reset()
  }
})

test('two distinct notices with identical titles are both preserved, never merged', async () => {
  const sameTitle: FtsBridgeSearchResponse = {
    ok: true,
    status: 200,
    body: JSON.stringify({
      uri: 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=2',
      publishedDate: '2026-10-09T00:00:00+01:00',
      releases: [
        {
          ocid: 'ocds-h6vhtk-SAME-A',
          id: '000010-2026',
          date: '2026-10-09T00:00:00+01:00',
          tender: { id: 'T-A', title: 'Solar Energy Maintenance', status: 'active', tenderPeriod: { endDate: '2026-12-31T12:00:00Z' }, procurementMethod: 'open' },
          buyer: { name: 'North Buyer' },
        },
        {
          ocid: 'ocds-h6vhtk-SAME-B',
          id: '000011-2026',
          date: '2026-10-09T00:00:00+01:00',
          tender: { id: 'T-B', title: 'Solar Energy Maintenance', status: 'active', tenderPeriod: { endDate: '2026-12-31T12:00:00Z' }, procurementMethod: 'open' },
          buyer: { name: 'South Buyer' },
        },
      ],
    }),
  }
  const store = createLiveTedDiscovery({
    bridge: capturingBridge(),
    ftsBridge: async (): Promise<FtsBridgeSearchResponse> => sameTitle,
    requestedAt: REQUESTED_AT,
  })
  const context = store.beginRun({ keyword: 'solar energy' })
  const outcome = store.finishRun(context, [await store.runCompany(context, 'Aavo')])
  const ftsItems = outcome.reviewQueue.filter((item) => item.sourceId === FTS_SOURCE_ID)
  // Both notices survive with distinct stable identities (different ocids);
  // the shared title+country+deadline is surfaced as a possible duplicate for
  // human confirmation — never silently merged or dropped.
  assert.equal(ftsItems.length, 2)
  assert.deepEqual(
    ftsItems.map((item) => item.candidateId).sort(),
    ['DC:SU-FTS-001:ocds-h6vhtk-SAME-A', 'DC:SU-FTS-001:ocds-h6vhtk-SAME-B'],
  )
  assert.ok(ftsItems.every((item) => item.reviewStatus === 'NEEDS_REVIEW'))
})
