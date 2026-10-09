/**
 * Grants.gov adapter tests — Phase 19A.
 *
 * Fully offline: every case injects a synchronous in-memory transport, so no
 * test touches the live internet and none writes to the vault. The response
 * fixtures below are constructed from the official documented `search2` schema
 * (https://www.grants.gov/api/common/search2) plus publicly listed
 * opportunities; this phase deliberately makes no live capture.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  GRANTS_GOV_OPPORTUNITY_PREFIX,
  GRANTS_GOV_SEARCH_ENDPOINT,
  GRANTS_GOV_SOURCE_ID,
  buildGrantsGovQueryPlan,
  buildGrantsGovSearchBody,
  createGrantsGovAdapter,
  normalizeGrantsGovStatus,
  parseGrantsGovBody,
  type GrantsGovTransport,
  type GrantsGovTransportResponse,
} from './grantsgov-adapter'
import { createDiscoveryRequest, type DiscoveryRequest } from './request'
import { createSourceRegistry } from './registry'

const OBSERVED_AT = '2026-10-09T12:00:00.000Z'
const KEYWORD = 'solar energy'

const PARSE_CONTEXT = { sourceId: GRANTS_GOV_SOURCE_ID, observedAt: OBSERVED_AT, queryTerm: KEYWORD }

/** Representative response: one posted, one forecasted (blank close date), one closed. */
const SAMPLE_SEARCH_RESPONSE = JSON.stringify({
  errorcode: 0,
  msg: 'Webservice Succeeds',
  token: 'REDACTED-NOT-A-REAL-TOKEN',
  data: {
    searchParams: { oppStatuses: 'posted|forecasted', rows: 10, keyword: KEYWORD },
    hitCount: 3,
    startRecord: 0,
    oppHits: [
      {
        id: '363929',
        number: 'NOAA-NMFS-PRPO-2026-31863',
        title: 'John H. Prescott Marine Mammal Rescue Assistance Grant',
        agencyCode: 'DOC',
        agency: 'Department of Commerce',
        openDate: '09/23/2026',
        closeDate: '12/01/2026',
        oppStatus: 'posted',
        docType: 'synopsis',
        alnist: ['11.061'],
      },
      {
        id: '360001',
        number: 'USDA-NIFA-ARPA-012381',
        title: 'Agriculture Risk Management Education Partnerships',
        agencyCode: 'USDA',
        agency: 'National Institute of Food and Agriculture',
        openDate: '08/20/2026',
        closeDate: '',
        oppStatus: 'forecasted',
        docType: 'synopsis',
        alnist: [],
      },
      {
        id: '359000',
        number: 'HHS-2025-OLD',
        title: 'Expired Example Programme',
        agencyCode: 'HHS',
        agency: 'Health & Human Services',
        openDate: '01/05/2025',
        closeDate: '03/01/2025',
        oppStatus: 'closed',
        docType: 'synopsis',
        alnist: [],
      },
    ],
    errorMsgs: [],
  },
})

function ggRequest(overrides: Partial<DiscoveryRequest> = {}): DiscoveryRequest {
  return createDiscoveryRequest({
    runId: 'RUN-GG-TEST-001',
    companyId: 'COM-001',
    discoveryProfileId: 'DP-LIVE-003',
    sourceId: GRANTS_GOV_SOURCE_ID,
    domain: 'funding',
    queryTerms: [KEYWORD],
    exclusions: [],
    requestedAt: OBSERVED_AT,
    keyword: KEYWORD,
    ...overrides,
  })
}

interface InMemoryTransport {
  readonly transport: GrantsGovTransport
  readonly calls: Array<{ url: string; body: string }>
}

function syncTransport(response: GrantsGovTransportResponse): InMemoryTransport {
  const calls: Array<{ url: string; body: string }> = []
  return {
    transport: (url, init) => {
      calls.push({ url, body: init.body })
      return { status: response.status, body: response.body }
    },
    calls,
  }
}

/* ------------------------------------------------------------------ */
/* Status normalization                                                */
/* ------------------------------------------------------------------ */

test('normalizeGrantsGovStatus accepts the four official statuses and keeps everything else unknown', () => {
  assert.equal(normalizeGrantsGovStatus('posted'), 'posted')
  assert.equal(normalizeGrantsGovStatus('Forecasted'), 'forecasted')
  assert.equal(normalizeGrantsGovStatus(' CLOSED '), 'closed')
  assert.equal(normalizeGrantsGovStatus('archived'), 'archived')
  // Never coerced to an open status.
  assert.equal(normalizeGrantsGovStatus('OPEN'), 'unknown')
  assert.equal(normalizeGrantsGovStatus(''), 'unknown')
  assert.equal(normalizeGrantsGovStatus(null), 'unknown')
  assert.equal(normalizeGrantsGovStatus(42), 'unknown')
  assert.equal(normalizeGrantsGovStatus(['posted']), 'unknown')
})

/* ------------------------------------------------------------------ */
/* Valid results                                                       */
/* ------------------------------------------------------------------ */

test('parse maps official ids, titles, URLs, agencies, dates, and status without inventing fields', () => {
  const parsed = parseGrantsGovBody(SAMPLE_SEARCH_RESPONSE, PARSE_CONTEXT)

  assert.equal(parsed.results.length, 3)
  assert.deepEqual(parsed.errors, [])

  const posted = parsed.results[0]
  assert.equal(posted.sourceRecordId, '363929')
  assert.equal(posted.sourceUrl, `${GRANTS_GOV_OPPORTUNITY_PREFIX}363929`)
  assert.equal(posted.title, 'John H. Prescott Marine Mammal Rescue Assistance Grant')
  assert.equal(posted.issuingOrganization, 'Department of Commerce')
  assert.equal(posted.country, 'US')
  assert.equal(posted.rawType, 'grant_opportunity')
  assert.equal(posted.sourceStatus, 'posted')
  assert.equal(posted.publicationDate, '2026-09-23')
  assert.equal(posted.deadline, '2026-12-01')
  assert.equal(posted.rawProvenance.sourceId, GRANTS_GOV_SOURCE_ID)
  assert.equal(posted.rawProvenance.observedAt, OBSERVED_AT)
  assert.equal(posted.rawProvenance.queryTerm, KEYWORD)

  // The other two statuses are preserved distinctly, not collapsed.
  assert.equal(parsed.results[1].sourceStatus, 'forecasted')
  assert.equal(parsed.results[2].sourceStatus, 'closed')
  assert.ok(parsed.warnings.some((warning) => warning.includes('source reported 3 matching')))
})

test('parse does not compute an open verdict: a closed record stays closed and no is-open field is added', () => {
  const parsed = parseGrantsGovBody(SAMPLE_SEARCH_RESPONSE, PARSE_CONTEXT)
  const closed = parsed.results.find((result) => result.sourceRecordId === '359000')
  assert.ok(closed)
  assert.equal(closed?.sourceStatus, 'closed')
  for (const key of Object.keys(closed ?? {})) {
    assert.equal(/^is_?open$/i.test(key), false)
    assert.equal(key.toLowerCase().includes('currentlyopen'), false)
  }
})

/* ------------------------------------------------------------------ */
/* Empty and malformed responses                                       */
/* ------------------------------------------------------------------ */

test('a genuine empty search parses to zero results with no errors', () => {
  const empty = JSON.stringify({ errorcode: 0, msg: 'Webservice Succeeds', data: { hitCount: 0, oppHits: [], errorMsgs: [] } })
  const parsed = parseGrantsGovBody(empty, PARSE_CONTEXT)
  assert.deepEqual(parsed.results, [])
  assert.deepEqual(parsed.errors, [])
})

test('non-JSON and unexpected-shape payloads are adapter_errors, never empty successes', () => {
  const notJson = parseGrantsGovBody('not json at all', PARSE_CONTEXT)
  assert.equal(notJson.results.length, 0)
  assert.equal(notJson.errors[0].code, 'adapter_error')
  assert.match(notJson.errors[0].message, /not valid JSON/)

  const noHits = parseGrantsGovBody(JSON.stringify({ errorcode: 0, data: {} }), PARSE_CONTEXT)
  assert.equal(noHits.errors[0].code, 'adapter_error')
  assert.match(noHits.errors[0].message, /unexpected shape/)

  const noData = parseGrantsGovBody(JSON.stringify({ errorcode: 0 }), PARSE_CONTEXT)
  assert.equal(noData.errors[0].code, 'adapter_error')
})

test('a non-zero source errorcode surfaces as an adapter_error, not an empty result', () => {
  const payload = JSON.stringify({ errorcode: 3, msg: 'Invalid oppStatuses value', data: { oppHits: [] } })
  const parsed = parseGrantsGovBody(payload, PARSE_CONTEXT)
  assert.deepEqual(parsed.results, [])
  assert.equal(parsed.errors[0].code, 'adapter_error')
  assert.match(parsed.errors[0].message, /Invalid oppStatuses value/)
})

/* ------------------------------------------------------------------ */
/* Missing ids, missing fields, unknown statuses, date handling        */
/* ------------------------------------------------------------------ */

test('an entry without an official id is an item_error and is dropped (no fabricated identity)', () => {
  const payload = JSON.stringify({
    errorcode: 0,
    data: { oppHits: [
      { number: 'NO-ID', title: 'No id here', oppStatus: 'posted' },
      { id: '1', title: 'Valid one', oppStatus: 'posted' },
    ] },
  })
  const parsed = parseGrantsGovBody(payload, PARSE_CONTEXT)
  assert.equal(parsed.results.length, 1)
  assert.equal(parsed.results[0].sourceRecordId, '1')
  assert.equal(parsed.errors.length, 1)
  assert.equal(parsed.errors[0].code, 'item_error')
  assert.equal(parsed.errors[0].itemIndex, 0)
})

test('a title-less entry falls back to the official number; neither present is an item_error', () => {
  const payload = JSON.stringify({
    errorcode: 0,
    data: { oppHits: [
      { id: '7', number: 'USDA-NIFA-999', oppStatus: 'posted' },
      { id: '8', oppStatus: 'posted' },
    ] },
  })
  const parsed = parseGrantsGovBody(payload, PARSE_CONTEXT)
  assert.equal(parsed.results.length, 1)
  assert.equal(parsed.results[0].title, 'USDA-NIFA-999')
  assert.equal(parsed.errors.length, 1)
  assert.match(parsed.errors[0].message, /no title or number/)
})

test('missing agency and dates stay null — nothing is invented', () => {
  const payload = JSON.stringify({
    errorcode: 0,
    data: { oppHits: [{ id: '9', number: 'X-1', title: 'Bare record', oppStatus: 'posted' }] },
  })
  const parsed = parseGrantsGovBody(payload, PARSE_CONTEXT)
  const record = parsed.results[0]
  assert.equal(record.issuingOrganization, null)
  assert.equal(record.publicationDate, null)
  assert.equal(record.deadline, null)
})

test('the source MM/DD/YYYY dates are normalized to ISO and a blank close date is null', () => {
  const parsed = parseGrantsGovBody(SAMPLE_SEARCH_RESPONSE, PARSE_CONTEXT)
  const forecasted = parsed.results[1]
  assert.equal(forecasted.publicationDate, '2026-08-20')
  assert.equal(forecasted.deadline, null)
})

test('an unknown or malformed status becomes unknown with a warning and is never treated as posted', () => {
  const payload = JSON.stringify({
    errorcode: 0,
    data: { oppHits: [
      { id: '20', title: 'Open-ish', oppStatus: 'OPEN' },
      { id: '21', title: 'No status' },
    ] },
  })
  const parsed = parseGrantsGovBody(payload, PARSE_CONTEXT)
  assert.equal(parsed.results.length, 2)
  assert.ok(parsed.results.every((result) => result.sourceStatus === 'unknown'))
  assert.equal(parsed.warnings.filter((warning) => warning.includes('unrecognized status')).length, 2)
})

/* ------------------------------------------------------------------ */
/* Query planning and request body                                     */
/* ------------------------------------------------------------------ */

test('the default plan requests only posted and clamps rows', () => {
  const plan = buildGrantsGovQueryPlan(ggRequest())
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.equal(plan.plan.keyword, 'solar energy')
  assert.equal(plan.plan.rows, 10)
  assert.equal(plan.plan.startRecordNum, 0)
  assert.deepEqual(plan.plan.statuses, ['posted'])
  assert.ok(plan.plan.warnings.some((warning) => warning.includes('posted')))

  const body = JSON.parse(buildGrantsGovSearchBody(plan.plan)) as Record<string, unknown>
  assert.deepEqual(body, { rows: 10, keyword: 'solar energy', oppStatuses: 'posted' })
})

test('broadSearch requests ALL posted opportunities with no keyword and supports pagination', () => {
  const plan = buildGrantsGovQueryPlan(
    ggRequest({ keyword: '', queryTerms: ['*'], adapterConfig: { rows: 25, broadSearch: true, startRecordNum: 50 } }),
  )
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.equal(plan.plan.keyword, '')
  assert.equal(plan.plan.rows, 25)
  assert.equal(plan.plan.startRecordNum, 50)
  assert.deepEqual(plan.plan.statuses, ['posted'])
  assert.ok(plan.plan.warnings.some((warning) => warning.includes('broad search')))

  const body = JSON.parse(buildGrantsGovSearchBody(plan.plan)) as Record<string, unknown>
  assert.deepEqual(body, { rows: 25, oppStatuses: 'posted', startRecordNum: 50 })
  assert.equal('keyword' in body, false)
})

test('an empty search term without broadSearch is invalid_request before any source call', () => {
  const captured = syncTransport({ status: 200, body: SAMPLE_SEARCH_RESPONSE })
  const adapter = createGrantsGovAdapter({ transport: captured.transport })
  const result = adapter.discover(ggRequest({ keyword: '', queryTerms: ['   '] }))
  assert.equal(result.status, 'FAILED')
  assert.equal(result.errors[0].code, 'invalid_request')
  assert.equal(captured.calls.length, 0)
})

test('a status filter with no recognized value is refused rather than queried empty', () => {
  const captured = syncTransport({ status: 200, body: SAMPLE_SEARCH_RESPONSE })
  const adapter = createGrantsGovAdapter({ transport: captured.transport })
  const result = adapter.discover(ggRequest({ adapterConfig: { oppStatuses: 'garbage' } }))
  assert.equal(result.status, 'FAILED')
  assert.equal(result.errors[0].code, 'invalid_request')
  assert.equal(captured.calls.length, 0)
})

/* ------------------------------------------------------------------ */
/* Adapter envelope: provenance, access, failures                      */
/* ------------------------------------------------------------------ */

test('discover sends one no-auth POST to the official endpoint and returns SUCCESS with provenance', () => {
  const captured = syncTransport({ status: 200, body: SAMPLE_SEARCH_RESPONSE })
  const adapter = createGrantsGovAdapter({ transport: captured.transport })
  const result = adapter.discover(ggRequest())

  assert.equal(captured.calls.length, 1)
  assert.equal(captured.calls[0].url, GRANTS_GOV_SEARCH_ENDPOINT)
  const sent = JSON.parse(captured.calls[0].body) as Record<string, unknown>
  assert.equal('apiKey' in sent, false)
  assert.equal('key' in sent, false)
  assert.equal(result.status, 'SUCCESS')
  assert.equal(result.results.length, 3)
  assert.ok(result.results.every((entry) => entry.rawProvenance.sourceId === GRANTS_GOV_SOURCE_ID))
  assert.ok(result.results.every((entry) => entry.sourceUrl.startsWith(GRANTS_GOV_OPPORTUNITY_PREFIX)))
})

test('wrong source, unregistered source, and non-AVAILABLE access are BLOCKED without touching the transport', () => {
  const captured = syncTransport({ status: 200, body: SAMPLE_SEARCH_RESPONSE })
  const registry = createSourceRegistry([
    {
      sourceId: GRANTS_GOV_SOURCE_ID,
      name: 'Grants.gov',
      domain: 'api.grants.gov',
      applicability: 'funding',
      discoveryCapability: 'listing_search',
      accessState: 'UNKNOWN',
      adapterType: 'grantsgov',
      provenanceRequirements: ['listing_url', 'raw_payload', 'observed_at', 'query_terms'],
      notesRestrictions: [],
    },
  ])
  const adapter = createGrantsGovAdapter({ transport: captured.transport, registry })

  assert.equal(adapter.discover(ggRequest({ sourceId: 'SU-GT-001', keyword: 'x' })).status, 'BLOCKED')

  const notAvailable = adapter.discover(ggRequest())
  assert.equal(notAvailable.status, 'BLOCKED')
  assert.ok(notAvailable.blockedReason?.includes('UNKNOWN'))

  const missing = createGrantsGovAdapter({ transport: captured.transport, registry: createSourceRegistry([]) })
  assert.equal(missing.discover(ggRequest()).status, 'BLOCKED')

  assert.equal(captured.calls.length, 0)
})

test('HTTP 403 is a RESTRICTED BLOCKED result; transport and non-2xx failures stay FAILED', () => {
  const forbidden = createGrantsGovAdapter({
    transport: syncTransport({ status: 403, body: '{"msg":"forbidden"}' }).transport,
  })
  const blocked = forbidden.discover(ggRequest())
  assert.equal(blocked.status, 'BLOCKED')
  assert.equal(blocked.accessState, 'RESTRICTED')

  const thrown = createGrantsGovAdapter({
    transport: () => {
      throw new Error('network unreachable')
    },
  }).discover(ggRequest())
  assert.equal(thrown.status, 'FAILED')
  assert.deepEqual(thrown.results, [])

  const serverError = createGrantsGovAdapter({
    transport: syncTransport({ status: 500, body: 'boom' }).transport,
  }).discover(ggRequest())
  assert.equal(serverError.status, 'FAILED')
})

test('an asynchronous transport is reported with retrieve() instructions until retrieve is awaited', async () => {
  const adapter = createGrantsGovAdapter({
    transport: (_url, _init) => Promise.resolve({ status: 200, body: SAMPLE_SEARCH_RESPONSE }),
  })
  const result = adapter.discover(ggRequest())
  assert.equal(result.status, 'FAILED')
  assert.match(result.errors[0].message, /await adapter\.retrieve/)

  await adapter.retrieve(ggRequest())
  assert.equal(adapter.discover(ggRequest()).status, 'SUCCESS')
})
