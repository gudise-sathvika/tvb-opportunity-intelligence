/**
 * Phase 21C EU Funding & Tenders Portal (SEDIA) adapter — offline unit tests.
 *
 * Covers the Phase 21B classification contract (DATASOURCE + type), FAQ
 * exclusion, unknown codes staying UNKNOWN, deadline/status normalization,
 * reference deduplication, multipart body construction, and response parsing.
 * No network is touched.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createDiscoveryRequest } from './request'
import {
  buildEuSediaQueryPlan,
  buildEuSediaSearchBody,
  buildEuSediaSearchUrl,
  classifyEuSediaRecord,
  normalizeEuSediaDate,
  normalizeEuSediaStatus,
  parseEuSediaBody,
  EU_SEDIA_TYPE_CODES,
  EU_SEDIA_STATUS_CODES,
} from './eu-sedia-adapter'
import { EU_SEDIA_SOURCE_ID } from './registry'

const OBSERVED_AT = '2026-10-09T00:00:00.000Z'

function metadata(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    DATASOURCE: ['SEDIA'],
    type: ['1'],
    status: ['31094502'],
    title: ['AI grant topic'],
    callIdentifier: ['HORIZON-CL4-2026'],
    deadlineDate: ['2026-12-01T17:00:00.000+01:00'],
    es_SortDate: ['2026-01-05T10:00:00.000+01:00'],
    ...overrides,
  }
}

function sediaBody(results: readonly unknown[], totalResults = results.length): string {
  return JSON.stringify({ apiVersion: '1.0', totalResults, results })
}

function record(reference: string, meta: Record<string, unknown>, url?: string): Record<string, unknown> {
  return {
    reference,
    url: url ?? `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${reference}`,
    contentType: 'application/json',
    metadata: meta,
  }
}

test('classification keys on DATASOURCE + type and never guesses', () => {
  assert.equal(classifyEuSediaRecord('SEDIA', EU_SEDIA_TYPE_CODES.GRANT_TOPIC), 'GRANT_TOPIC')
  assert.equal(classifyEuSediaRecord('SEDIA', EU_SEDIA_TYPE_CODES.EXTERNAL_ACTION_GRANT), 'EXTERNAL_ACTION_GRANT')
  assert.equal(classifyEuSediaRecord('SEDIA', EU_SEDIA_TYPE_CODES.CASCADE_FUNDING_CALL), 'CASCADE_FUNDING_CALL')
  assert.equal(classifyEuSediaRecord('SEDIA', EU_SEDIA_TYPE_CODES.TENDER), 'TENDER')
  // The FAQ collection reuses `type`; DATASOURCE wins.
  assert.equal(classifyEuSediaRecord('SEDIA_FAQ', EU_SEDIA_TYPE_CODES.GRANT_TOPIC), 'FAQ_DOCUMENT')
  // Phase 21B: SEDIA_PRD_CENTRICITY is a centroid duplicate of SEDIA.
  assert.equal(classifyEuSediaRecord('SEDIA_PRD_CENTRICITY', EU_SEDIA_TYPE_CODES.GRANT_TOPIC), 'GRANT_TOPIC')
  // Non-SEDIA database and unknown code stay UNKNOWN.
  assert.equal(classifyEuSediaRecord('PROSPECTS', '0'), null)
  assert.equal(classifyEuSediaRecord('SEDIA', '99'), null)
})

test('status normalization maps verified codes and treats everything else as unknown', () => {
  assert.equal(normalizeEuSediaStatus(EU_SEDIA_STATUS_CODES.OPEN), 'open')
  assert.equal(normalizeEuSediaStatus(EU_SEDIA_STATUS_CODES.FORTHCOMING), 'forthcoming')
  assert.equal(normalizeEuSediaStatus(EU_SEDIA_STATUS_CODES.CLOSED), 'closed')
  assert.equal(normalizeEuSediaStatus('310945031'), 'unknown')
  assert.equal(normalizeEuSediaStatus('99999998'), 'unknown')
  assert.equal(normalizeEuSediaStatus(undefined), 'unknown')
})

test('date normalization accepts ISO datetime/date and DD/MM/YYYY, else null', () => {
  assert.equal(normalizeEuSediaDate('2026-12-01T17:00:00.000+01:00'), '2026-12-01')
  assert.equal(normalizeEuSediaDate('2026-12-01'), '2026-12-01')
  assert.equal(normalizeEuSediaDate('01/12/2026'), '2026-12-01')
  assert.equal(normalizeEuSediaDate('not a date'), null)
  assert.equal(normalizeEuSediaDate(undefined), null)
})

test('parses records, excludes FAQ, keeps unknown codes as UNKNOWN, and dedups by reference', () => {
  const parsed = parseEuSediaBody(
    sediaBody([
      record('HORIZON-1', metadata({})),
      record('HORIZON-1', metadata({})), // duplicate reference
      record('FAQ-1', metadata({ DATASOURCE: ['SEDIA_FAQ'], type: ['8'] })), // FAQ excluded
      record('CASC-1', metadata({ type: ['8'], status: ['31094501'], title: ['Cascade call'] })),
      record('UNK-1', metadata({ type: ['99'], title: ['Mystery'] })),
      record('PROS-1', metadata({ DATASOURCE: ['PROSPECTS'], type: ['0'], title: ['Not ours'] })),
    ]),
    { sourceId: EU_SEDIA_SOURCE_ID, observedAt: OBSERVED_AT, queryTerm: 'ai' },
  )

  assert.equal(parsed.errors.length, 0)
  const refs = parsed.results.map((r) => r.sourceRecordId)
  assert.deepEqual(refs, ['HORIZON-1', 'CASC-1', 'UNK-1', 'PROS-1'])
  assert.equal(parsed.warnings.some((w) => w.includes('duplicate reference')), true)
  assert.equal(parsed.warnings.some((w) => w.includes('FAQ document(s) were excluded')), true)

  const first = parsed.results[0]!
  assert.equal(first.rawType, 'GRANT_TOPIC')
  assert.equal(first.sourceStatus, 'open')
  assert.equal(first.publicationDate, '2026-01-05')
  assert.equal(first.deadline, '2026-12-01')
  assert.equal(first.country, 'EU')
  assert.equal(first.rawProvenance.sourceRecordId, 'HORIZON-1')
  assert.equal(first.rawProvenance.queryTerm, 'ai')

  const unknown = parsed.results[2]!
  assert.equal(unknown.rawType, null)
  assert.equal(unknown.sourceStatus, 'open')
})

test('query plan defaults to grant topic/external-action/cascade types, open+forthcoming, FAQ excluded', () => {
  const request = createDiscoveryRequest({
    runId: 'RUN-EU-1',
    companyId: 'Aavo',
    discoveryProfileId: 'DP-LIVE-004',
    sourceId: EU_SEDIA_SOURCE_ID,
    domain: 'funding',
    queryTerms: ['ai'],
    exclusions: [],
    requestedAt: OBSERVED_AT,
    keyword: '',
    adapterConfig: { broadSearch: true, rows: 5 },
  })
  const plan = buildEuSediaQueryPlan(request)
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.equal(plan.plan.text, '*')
  assert.equal(plan.plan.rows, 5)
  assert.deepEqual(plan.plan.types, ['1', '2', '8'])
  assert.deepEqual(plan.plan.statuses, ['31094501', '31094502'])
  assert.deepEqual(plan.plan.excludeDatasources, ['SEDIA_FAQ'])
})

test('multipart body carries exactly the three SEDIA parts and the URL carries the public apiKey', () => {
  const request = createDiscoveryRequest({
    runId: 'RUN-EU-1',
    companyId: 'Aavo',
    discoveryProfileId: 'DP-LIVE-004',
    sourceId: EU_SEDIA_SOURCE_ID,
    domain: 'funding',
    queryTerms: ['ai'],
    exclusions: [],
    requestedAt: OBSERVED_AT,
    keyword: 'ai',
  })
  const plan = buildEuSediaQueryPlan(request)
  assert.equal(plan.ok, true)
  if (!plan.ok) return

  const body = buildEuSediaSearchBody(plan.plan)
  assert.equal(body.includes('name="query"'), true)
  assert.equal(body.includes('name="languages"'), true)
  assert.equal(body.includes('name="displayLanguage"'), true)
  assert.equal((body.match(/name="query"/g) ?? []).length, 1)
  assert.equal(body.includes('----TVBEuSediaBoundary21C--'), true)
  // The `query` part is the bare ES bool (Phase 21A verified shape), not wrapped.
  assert.equal(body.includes('{"bool":{"must":[{"terms":{"type":["1","2","8"]}}'), true)

  const url = buildEuSediaSearchUrl(plan.plan)
  assert.equal(url.startsWith('https://api.tech.ec.europa.eu/search-api/prod/rest/search?'), true)
  assert.equal(url.includes('apiKey=SEDIA'), true)
  assert.equal(url.includes('text=ai'), true)
})

test('a malformed response body is an adapter error, never a silent empty success', () => {
  const parsed = parseEuSediaBody('<html>not json</html>', {
    sourceId: EU_SEDIA_SOURCE_ID,
    observedAt: OBSERVED_AT,
    queryTerm: null,
  })
  assert.equal(parsed.results.length, 0)
  assert.equal(parsed.errors[0]?.code, 'adapter_error')
})
