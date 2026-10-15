/**
 * UK Find a Tender Service (FTS) adapter tests — Phase 03.
 *
 * Fully offline: every case injects a synchronous in-memory transport.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildFtsQueryPlan,
  buildFtsSearchUrl,
  createFtsAdapter,
  FTS_SOURCE_ID,
  parseFtsBody,
} from './fts-adapter'
import { createDiscoveryRequest } from './request'

const OBSERVED_AT = '2026-10-14T12:00:00.000Z'

const SAMPLE = JSON.stringify({
  uri: 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=1',
  publishedDate: '2026-10-14T17:59:11+01:00',
  releases: [
    {
      ocid: 'ocds-h6vhtk-077a00',
      id: '097235-2026',
      date: '2026-10-14T17:59:11+01:00',
      tender: {
        id: 'SHS-CLN-2026-01',
        title: 'Cleaning Services - Shipston High School',
        description: 'Provision of cleaning services.',
        status: 'active',
        tenderPeriod: { endDate: '2026-10-26T12:00:00Z' },
        procurementMethod: 'open',
      },
      buyer: { name: 'SHIPSTON HIGH SCHOOL' },
    },
  ],
})

test('buildFtsSearchUrl includes limit', () => {
  const plan = buildFtsQueryPlan(createDiscoveryRequest({ runId: 'r', companyId: 'c', discoveryProfileId: 'dp', sourceId: FTS_SOURCE_ID, domain: 'procurement', queryTerms: ['cleaning'], exclusions: [], requestedAt: OBSERVED_AT }))
  assert.equal(plan.ok, true)
  const url = buildFtsSearchUrl((plan as any).plan)
  assert.ok(url.includes('limit=10'))
})

test('parseFtsBody maps active tender to raw result', () => {
  const outcome = parseFtsBody(SAMPLE, { sourceId: FTS_SOURCE_ID, observedAt: OBSERVED_AT, queryTerm: 'cleaning' })
  assert.equal(outcome.results.length, 1)
  const r = outcome.results[0]
  assert.equal(r.sourceRecordId, 'ocds-h6vhtk-077a00')
  assert.equal(r.sourceUrl, 'https://www.find-tender.service.gov.uk/Notice/097235-2026')
  assert.equal(r.sourceStatus, 'active')
  assert.equal(r.deadline, '2026-10-26T12:00:00Z')
  assert.equal(r.country, 'GB')
})

test('parseFtsBody skips release without tender', () => {
  const noTender = JSON.stringify({ releases: [{ ocid: 'x', date: '2026-10-14T00:00:00Z' }] })
  const outcome = parseFtsBody(noTender, { sourceId: FTS_SOURCE_ID, observedAt: OBSERVED_AT, queryTerm: null })
  assert.equal(outcome.results.length, 0)
  assert.equal(outcome.errors.length >= 1, true)
})

test('adapter discover with injected transport', () => {
  const adapter = createFtsAdapter({ transport: () => ({ status: 200, body: SAMPLE }) })
  const req = createDiscoveryRequest({ runId: 'r1', companyId: 'c1', discoveryProfileId: 'dp', sourceId: FTS_SOURCE_ID, domain: 'procurement', queryTerms: ['x'], exclusions: [], requestedAt: OBSERVED_AT })
  const res = adapter.discover(req)
  assert.equal(res.status, 'SUCCESS')
  assert.equal(res.results.length, 1)
})

test('parseFtsBody excludes a release with no usable identity, never fabricating one', () => {
  const noIdentity = JSON.stringify({
    releases: [
      {
        date: '2026-10-14T00:00:00+01:00',
        tender: { id: 'T-X', title: 'Untraceable Test Tender', status: 'active', tenderPeriod: { endDate: '2026-12-31T12:00:00Z' } },
        buyer: { name: 'Test Buyer' },
      },
    ],
  })
  const outcome = parseFtsBody(noIdentity, { sourceId: FTS_SOURCE_ID, observedAt: OBSERVED_AT, queryTerm: null })
  assert.equal(outcome.results.length, 0)
  assert.ok(outcome.errors.some((e) => e.code === 'item_error'))
})

test('the detail URL uses the FT notice number, never the ocid (ocid URLs 404)', () => {
  const noOcid = JSON.stringify({
    releases: [
      {
        id: '000099-2026',
        date: '2026-10-14T00:00:00+01:00',
        tender: { id: 'T-X', title: 'Untraceable Test Tender', status: 'active', tenderPeriod: { endDate: '2026-12-31T12:00:00Z' } },
        buyer: { name: 'Test Buyer' },
      },
    ],
  })
  const outcome = parseFtsBody(noOcid, { sourceId: FTS_SOURCE_ID, observedAt: OBSERVED_AT, queryTerm: null })
  assert.equal(outcome.results.length, 1)
  assert.equal(outcome.results[0].sourceUrl, 'https://www.find-tender.service.gov.uk/Notice/000099-2026')
  assert.equal(outcome.results[0].sourceRecordId, '000099-2026')
})

test('parseFtsBody preserves a missing deadline as null for the classifier to judge', () => {
  const noDeadline = JSON.stringify({
    releases: [
      {
        ocid: 'ocds-h6vhtk-NODEAD',
        id: '000098-2026',
        date: '2026-10-14T00:00:00+01:00',
        tender: { id: 'T-Y', title: 'Deadline-free Test Tender', status: 'active', procurementMethod: 'open' },
        buyer: { name: 'Test Buyer' },
      },
    ],
  })
  const outcome = parseFtsBody(noDeadline, { sourceId: FTS_SOURCE_ID, observedAt: OBSERVED_AT, queryTerm: null })
  assert.equal(outcome.results.length, 1)
  assert.equal(outcome.results[0].deadline, null)
  assert.equal(outcome.results[0].sourceStatus, 'active')
})

test('Phase 35: a live-shaped active notice keeps its deadline into review with an open gate', async () => {
  const { parseFtsBody } = await import('./fts-adapter')
  const { candidateFromRawResult } = await import('./transform')
  const { normalizeCandidate } = await import('./normalize')
  const { createReviewItem } = await import('./review-queue')
  const { classifyOpportunityState } = await import('./opportunity-status')
  const body = JSON.stringify({
    releases: [
      {
        ocid: 'ocds-h6vhtk-078855',
        id: '097376-2026',
        date: '2026-10-15T11:33:35+01:00',
        tender: { id: 'T-1', title: 'Traced live notice', status: 'active', tenderPeriod: { endDate: '2026-11-09T15:00:00+00:00' }, procurementMethod: 'open' },
        buyer: { name: 'Northern Ireland Housing Executive' },
      },
    ],
  })
  const parsed = parseFtsBody(body, { sourceId: FTS_SOURCE_ID, observedAt: '2026-10-15T00:00:00.000Z', queryTerm: null })
  assert.equal(parsed.results.length, 1)
  const raw = parsed.results[0]
  assert.equal(raw.deadline, '2026-11-09T15:00:00+00:00')
  const envelope = {
    status: 'SUCCESS', sourceId: FTS_SOURCE_ID, adapterType: 'fts', runId: 'RUN-T-1', domain: 'procurement',
    accessState: 'AVAILABLE', requestedAt: '2026-10-15T00:00:00.000Z', observedAt: '2026-10-15T00:00:00.000Z',
    blockedReason: null, results: [raw], errors: [], warnings: [],
    provenance: { runId: 'RUN-T-1', companyId: 'RUN', discoveryProfileId: 'DP', sourceId: FTS_SOURCE_ID, sourceName: 'FTS', sourceUrl: raw.sourceUrl, adapterType: 'fts', domain: 'procurement', accessState: 'AVAILABLE', requestedAt: '2026-10-15T00:00:00.000Z', observedAt: '2026-10-15T00:00:00.000Z', stageHistory: [] },
  } as never
  const candidate = normalizeCandidate(candidateFromRawResult(envelope, raw))
  assert.equal(candidate.sourceDeadline, '2026-11-09T15:00:00+00:00')
  assert.equal(candidate.sourceUrl, 'https://www.find-tender.service.gov.uk/Notice/097376-2026')
  const item = createReviewItem({ ...candidate, discoveryRunId: 'RUN-T-1', companyId: 'RUN' })
  assert.equal(item.candidateId, 'DC:SU-FTS-001:ocds-h6vhtk-078855')
  assert.equal(item.companyId, 'RUN')
  assert.deepEqual(classifyOpportunityState({ ...candidate, discoveryRunId: 'RUN-T-1', companyId: 'RUN' } as never, '2026-10-15T00:00:00.000Z'), {
    state: 'open',
    reason: 'active tender with a future submission deadline',
  })
})
