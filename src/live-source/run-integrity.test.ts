/**
 * Phase 11 Discovery run integrity audit — fully offline, recorded bodies.
 *
 * Proves per-run integrity through the REAL live store: historical runs keep
 * their own selection/filters/results after later runs, shared-pool notices
 * are fetched once yet attributed honestly, run-level counts reconcile with
 * the stored candidates, and the review handoff carries unique stable
 * identities with run-scoped links.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { FTS_SOURCE_ID, TED_SOURCE_ID } from '../automation/registry'
import { TED_SEARCH_RESPONSE_RECORDING } from '../automation/ted-fixture'
import { reviewFixtureStore } from '../automation/review-fixture'
import { filterReviewItemsByRun } from '../automation/review-queue'
import { FTS_LIVE_POOL_COMPANY_ID, createLiveTedDiscovery, dedupeHandoffCandidates } from './live-discovery'
import type { TedBridgeSearchRequest, TedBridgeSearchResponse } from './ted-bridge/contract'
import type { FtsBridgeSearchRequest, FtsBridgeSearchResponse } from './fts-bridge/contract'

const REQUESTED_AT = '2026-10-09T00:00:00.000Z'

const TED_OK: TedBridgeSearchResponse = { ok: true, status: 200, body: TED_SEARCH_RESPONSE_RECORDING }
const FTS_OK: FtsBridgeSearchResponse = {
  ok: true,
  status: 200,
  body: JSON.stringify({
    uri: 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=10',
    publishedDate: '2026-10-09T00:00:00+01:00',
    releases: [
      {
        ocid: 'ocds-h6vhtk-AUDIT1',
        id: '000101-2026',
        date: '2026-10-09T00:00:00+01:00',
        tender: {
          id: 'T-A1',
          title: 'Audit Solar Energy Services',
          status: 'active',
          tenderPeriod: { endDate: '2026-12-31T12:00:00Z' },
          procurementMethod: 'open',
        },
        buyer: { name: 'Audit Buyer' },
      },
      {
        ocid: 'ocds-h6vhtk-AUDIT2',
        id: '000102-2026',
        date: '2026-10-09T00:00:00+01:00',
        tender: { id: 'T-A2', title: 'Audit Solar Energy Works', status: 'complete', procurementMethod: 'open' },
        buyer: { name: 'Audit Buyer' },
      },
    ],
  }),
}

function store(tedCalls: TedBridgeSearchRequest[], ftsCalls: FtsBridgeSearchRequest[]) {
  return createLiveTedDiscovery({
    bridge: async (request: TedBridgeSearchRequest): Promise<TedBridgeSearchResponse> => {
      tedCalls.push(request)
      return TED_OK
    },
    ftsBridge: async (request: FtsBridgeSearchRequest): Promise<FtsBridgeSearchResponse> => {
      ftsCalls.push(request)
      return FTS_OK
    },
    requestedAt: REQUESTED_AT,
  })
}

test('a historical run keeps its own selection, filters, and results after later runs', async () => {
  const live = store([], [])
  const first = live.beginRun({ keyword: 'solar energy' })
  const firstOutcome = live.finishRun(first, [await live.runCompany(first, 'Aavo')])

  const second = live.beginRun({ keyword: 'wind' })
  const secondOutcome = live.finishRun(second, [await live.runCompany(second, 'Arka VC'), await live.runCompany(second, 'Avasant')])

  assert.deepEqual(firstOutcome.companyIds, ['Aavo'])
  assert.equal(firstOutcome.keyword, 'solar energy')
  assert.deepEqual(secondOutcome.companyIds, ['Arka VC', 'Avasant'])
  assert.equal(secondOutcome.keyword, 'wind')
  assert.equal(firstOutcome.runId, 'RUN-T-0001')
  assert.equal(secondOutcome.runId, 'RUN-T-0002')
  assert.equal(live.history().length, 2)
  assert.deepEqual(live.history()[0].companyIds, ['Aavo'])
})

test('one broad FTS fetch per run; per-company results share it without refetching', async () => {
  const tedCalls: TedBridgeSearchRequest[] = []
  const ftsCalls: FtsBridgeSearchRequest[] = []
  const live = store(tedCalls, ftsCalls)
  const context = live.beginRun({ keyword: 'solar energy' })
  await live.runCompany(context, 'Aavo')
  await live.runCompany(context, 'Arka VC')
  await live.runCompany(context, 'Avasant')
  assert.equal(tedCalls.length, 3)
  assert.equal(ftsCalls.length, 1)
  assert.equal(ftsCalls[0].companyId, FTS_LIVE_POOL_COMPANY_ID)
})

test('run-level counts reconcile: company sums vs unique review handoff', async () => {
  const live = store([], [])
  const context = live.beginRun({ keyword: 'solar energy' })
  const companies = [await live.runCompany(context, 'Aavo'), await live.runCompany(context, 'Arka VC')]
  const outcome = live.finishRun(context, companies)

  // Sources attempted counts every company×source execution (shared pool included).
  assert.equal(outcome.counts.totalSources, 4)
  // Candidates found sums company-specific results (shared notices appear per company).
  const companyCandidateSum = companies.reduce((sum, company) => sum + company.candidates.length, 0)
  assert.equal(outcome.counts.candidatesCreated, companyCandidateSum)
  assert.ok(companyCandidateSum > outcome.reviewQueue.length)
  // The handoff carries one item per source notice, independent of how many
  // company searches surfaced it.
  const ftsHandoff = outcome.reviewQueue.filter((item) => item.sourceId === FTS_SOURCE_ID)
  assert.equal(ftsHandoff.length, 2)
  assert.equal(new Set(ftsHandoff.map((item) => item.candidateId)).size, 2)
  assert.ok(ftsHandoff.every((item) => item.companyId === FTS_LIVE_POOL_COMPANY_ID))
  // TED searches are company-directed, but a repeated notice is one source
  // record in Human Review and is unassigned rather than attributed to the
  // first company that found it.
  const tedItems = outcome.reviewQueue.filter((item) => item.sourceId === TED_SOURCE_ID)
  assert.equal(tedItems.length, 3)
  assert.equal(new Set(tedItems.map((item) => item.sourceRecordId)).size, 3)
  assert.ok(tedItems.every((item) => item.companyId === FTS_LIVE_POOL_COMPANY_ID))
  assert.ok(tedItems.every((item) => item.provenance.companyId === FTS_LIVE_POOL_COMPANY_ID))
  // needsReview counts the deduped queue, matching what review will show.
  assert.equal(outcome.needsReview, outcome.reviewQueue.filter((item) => item.reviewStatus === 'NEEDS_REVIEW').length)
})

test('canonical shared items stay reachable under the run-scoped review link', async () => {
  const live = store([], [])
  const context = live.beginRun({ keyword: 'solar energy' })
  const outcome = live.finishRun(context, [await live.runCompany(context, 'Aavo')])
  try {
    reviewFixtureStore.addReviewItems(outcome.reviewQueue)
    const scoped = filterReviewItemsByRun(reviewFixtureStore.items(), context.runId)
    const scopedIds = new Set(scoped.map((item) => item.reviewId))
    for (const item of outcome.reviewQueue) {
      assert.ok(scopedIds.has(item.reviewId), `run-scoped link must include ${item.reviewId}`)
    }
  } finally {
    reviewFixtureStore.reset()
  }
})

test('repeated handoff processing never duplicates notices, including company-directed searches', async () => {
  const live = store([], [])
  const context = live.beginRun({ keyword: 'solar energy' })
  const companies = [await live.runCompany(context, 'Aavo'), await live.runCompany(context, 'Arka VC')]
  const all = companies.flatMap((company) => company.candidates)
  const once = dedupeHandoffCandidates(all)
  const twice = dedupeHandoffCandidates([...all, ...all])
  const ftsIds = (list: readonly { candidateId: string }[]): string[] =>
    list.filter((candidate) => candidate.candidateId.startsWith('DC:SU-FTS-001:')).map((candidate) => candidate.candidateId)
  // Shared-pool identities are stable no matter how often the handoff repeats.
  assert.deepEqual(ftsIds(twice), ftsIds(once))
  assert.equal(new Set(ftsIds(once)).size, ftsIds(once).length)
  const tedIds = (list: readonly { candidateId: string }[]): string[] =>
    list.filter((candidate) => candidate.candidateId.startsWith('DC:SU-TED-001:')).map((candidate) => candidate.candidateId)
  assert.equal(tedIds(twice).length, tedIds(once).length)
  assert.equal(new Set(tedIds(once)).size, tedIds(once).length)
})

test('a successful empty source stays distinct from failure in the same run', async () => {
  const live = createLiveTedDiscovery({
    bridge: async (): Promise<TedBridgeSearchResponse> => ({ ok: true, status: 200, body: JSON.stringify({ notices: [], totalNoticeCount: 0 }) }),
    ftsBridge: async (): Promise<FtsBridgeSearchResponse> => FTS_OK,
    requestedAt: REQUESTED_AT,
  })
  const context = live.beginRun({ keyword: 'solar energy' })
  const company = await live.runCompany(context, 'Aavo')
  const ted = company.sourceResults.find((result) => result.sourceId === TED_SOURCE_ID)
  const fts = company.sourceResults.find((result) => result.sourceId === FTS_SOURCE_ID)
  assert.equal(ted?.outcome, 'NO_RESULTS')
  assert.equal(fts?.outcome, 'SUCCESS')
  assert.equal(company.outcome, 'SUCCESS')
  assert.equal(company.counts.failedSources, 0)
  assert.equal(company.counts.blockedSources, 0)
})
