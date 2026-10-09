/**
 * TED real-source adapter tests — Phase U.
 *
 * All tests run against a byte-for-byte recording of one real API response
 * (`./ted-fixture.ts`) injected through an in-memory transport: no test touches
 * the live internet, and no test writes to the vault. The ten required
 * behaviours map to tests 1–10 below.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  TED_SEARCH_ENDPOINT,
  createTedAdapter,
  parseTedSearchBody,
  type TedTransport,
  type TedTransportResponse,
} from './ted-adapter'
import { TED_SEARCH_RESPONSE_RECORDING } from './ted-fixture'
import { createDiscoveryRequest, type DiscoveryRequest } from './request'
import { DEFAULT_SOURCE_REGISTRY, TED_SOURCE_ID, createSourceRegistry } from './registry'
import { gateDiscovery, runDiscovery } from './discovery-run'
import { runCandidatePipeline } from './pipeline'

const KEYWORD = 'solar energy'
const OBSERVED_AT = '2026-10-08T12:00:00.000Z'
const PARSE_CONTEXT = { sourceId: TED_SOURCE_ID, observedAt: OBSERVED_AT, queryTerm: KEYWORD }

function tedRequest(overrides: Partial<DiscoveryRequest> = {}): DiscoveryRequest {
  return createDiscoveryRequest({
    runId: 'RUN-TED-TEST-001',
    companyId: 'COM-001',
    discoveryProfileId: 'DP-COM-001-v1',
    sourceId: TED_SOURCE_ID,
    domain: 'procurement',
    queryTerms: [KEYWORD],
    exclusions: [],
    requestedAt: OBSERVED_AT,
    keyword: KEYWORD,
    ...overrides,
  })
}

interface CapturedCall {
  readonly url: string
  readonly init: { readonly method: string; readonly headers: Readonly<Record<string, string>>; readonly body: string }
}

interface InMemoryTransport {
  readonly transport: TedTransport
  readonly calls: CapturedCall[]
}

function syncTransport(response: TedTransportResponse): InMemoryTransport {
  const calls: CapturedCall[] = []
  return {
    transport: (url, init) => {
      calls.push({ url, init })
      return { status: response.status, body: response.body }
    },
    calls,
  }
}

function asyncTransport(response: TedTransportResponse): InMemoryTransport {
  const calls: CapturedCall[] = []
  return {
    transport: (url, init) => {
      calls.push({ url, init })
      return Promise.resolve({ status: response.status, body: response.body })
    },
    calls,
  }
}

function adapterWith(body: string, status = 200) {
  return createTedAdapter(syncTransport({ status, body }))
}

/* ------------------------------------------------------------------ */

test('1. successful real-source retrieval returns the recorded TED response', () => {
  const { transport, calls } = syncTransport({ status: 200, body: TED_SEARCH_RESPONSE_RECORDING })
  const adapter = createTedAdapter({ transport })

  const result = adapter.discover(tedRequest())
  assert.equal(result.status, 'SUCCESS')
  assert.equal(result.results.length, 3)
  assert.equal(result.errors.length, 0)
  assert.equal(result.accessState, 'AVAILABLE')
  assert.equal(result.adapterType, 'ted')
  assert.equal(result.sourceId, TED_SOURCE_ID)
  assert.equal(result.results[0].sourceRecordId, '534463-2026')

  // exactly one request to the official endpoint, carrying the source's query
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, TED_SEARCH_ENDPOINT)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  const sent = JSON.parse(calls[0].init.body)
  assert.equal(sent.query, 'notice-title~"solar energy"')
  assert.equal(sent.page, 1)
  assert.equal(sent.limit, 10)
  assert.ok(Array.isArray(sent.fields) && sent.fields.includes('publication-number'))
})

test('1b. the live two-phase path (await retrieve, then a synchronous run) works', async () => {
  const { transport, calls } = asyncTransport({ status: 200, body: TED_SEARCH_RESPONSE_RECORDING })
  const adapter = createTedAdapter({ transport })
  const request = tedRequest({ runId: 'RUN-TED-LIVE-001' })

  await adapter.retrieve(request)
  assert.equal(calls.length, 1)

  const result = runDiscovery(request, { registry: DEFAULT_SOURCE_REGISTRY, adapter })
  assert.equal(result.status, 'SUCCESS')
  assert.equal(result.results.length, 3)
  assert.equal(calls.length, 1, 'the stored response is consumed without a second request')

  // an asynchronous transport without retrieve() fails with instructions
  const { transport: asyncOnly } = asyncTransport({ status: 200, body: TED_SEARCH_RESPONSE_RECORDING })
  const stranded = createTedAdapter({ transport: asyncOnly }).discover(tedRequest({ runId: 'RUN-TED-LIVE-002' }))
  assert.equal(stranded.status, 'FAILED')
  assert.match(stranded.errors[0]?.message ?? '', /await adapter\.retrieve/)
})

test('2. the recorded response parses into source fields without inventing values', () => {
  const outcome = parseTedSearchBody(TED_SEARCH_RESPONSE_RECORDING, PARSE_CONTEXT)
  assert.equal(outcome.errors.length, 0)
  assert.equal(outcome.results.length, 3)
  assert.equal(outcome.warnings.length, 0)

  const recorded = JSON.parse(TED_SEARCH_RESPONSE_RECORDING) as {
    notices: Record<string, unknown>[]
  }
  const recordedFirstTitle = recorded.notices[0]['notice-title'] as Record<string, unknown>
  const [first, second, third] = outcome.results

  assert.equal(first.sourceRecordId, '534463-2026')
  assert.equal(first.title, recordedFirstTitle['eng'], 'English title is preferred')
  assert.notEqual(first.title, recordedFirstTitle['bul'], 'sorted-first language is not chosen')
  assert.equal(first.publicationDate, '2026-08-03', 'timezone suffix is trimmed to the published date')
  assert.equal(first.deadline, null, 'the source published no deadline — it stays missing')
  assert.equal(first.description, null, 'the source published no summary — it stays missing')
  assert.equal(first.issuingOrganization, 'Park Naukowo-Technologiczny w Opolu Sp. z o.o.')
  assert.equal(first.country, 'POL')
  assert.equal(first.rawType, 'cn-standard')
  assert.equal(first.sourceUrl, 'https://ted.europa.eu/en/notice/-/detail/534463-2026')
  assert.deepEqual(JSON.parse(first.rawPayload), recorded.notices[0], 'raw payload is the source entry verbatim')

  assert.equal(second.sourceRecordId, '535503-2026')
  assert.equal(second.issuingOrganization, 'Lasy Państwowe Nadleśnictwo Bytnica')
  assert.equal(third.sourceRecordId, '536878-2026')
  assert.equal(third.country, 'LVA')
  assert.equal(third.issuingOrganization, 'Valsts izglītības attīstības aģentūra')
})

test('3. every finding carries the full source provenance', () => {
  const result = createTedAdapter(syncTransport({ status: 200, body: TED_SEARCH_RESPONSE_RECORDING })).discover(
    tedRequest(),
  )
  assert.equal(result.results.length, 3)

  for (const raw of result.results) {
    const provenance = raw.rawProvenance
    assert.equal(provenance.sourceId, TED_SOURCE_ID)
    assert.equal(provenance.sourceUrl, raw.sourceUrl)
    assert.equal(provenance.sourceRecordId, raw.sourceRecordId)
    assert.equal(provenance.observedAt, OBSERVED_AT, 'observedAt equals the request timestamp — no clock of its own')
    assert.equal(provenance.queryTerm, KEYWORD)
  }

  const envelope = result.provenance
  assert.equal(envelope.runId, 'RUN-TED-TEST-001')
  assert.equal(envelope.companyId, 'COM-001')
  assert.equal(envelope.discoveryProfileId, 'DP-COM-001-v1')
  assert.equal(envelope.sourceId, TED_SOURCE_ID)
  assert.match(envelope.sourceName ?? '', /^TED/)
  assert.equal(envelope.adapterType, 'ted')
  assert.equal(envelope.domain, 'procurement')
  assert.equal(envelope.accessState, 'AVAILABLE')
  assert.equal(envelope.requestedAt, OBSERVED_AT)
  assert.equal(envelope.observedAt, OBSERVED_AT)
  assert.equal(envelope.sourceUrl, result.results[0].sourceUrl)
})

test('4. missing source fields stay missing; a title-less entry is an item error', () => {
  const direct = parseTedSearchBody(TED_SEARCH_RESPONSE_RECORDING, PARSE_CONTEXT)
  assert.equal(direct.results[0].deadline, null, 'absent in the recording → null')
  assert.equal(direct.results[0].description, null, 'absent in the recording → null')

  // buyer and country removed from a derived variant → null, everything else intact
  const stripped = JSON.parse(TED_SEARCH_RESPONSE_RECORDING) as { notices: Record<string, unknown>[] }
  for (const notice of stripped.notices) {
    delete notice['organisation-name-buyer']
    delete notice['organisation-country-buyer']
  }
  const noBuyer = parseTedSearchBody(JSON.stringify(stripped), PARSE_CONTEXT)
  assert.equal(noBuyer.errors.length, 0)
  assert.equal(noBuyer.results[0].issuingOrganization, null)
  assert.equal(noBuyer.results[0].country, null)
  assert.equal(noBuyer.results[0].sourceRecordId, '534463-2026')
  assert.equal(noBuyer.results[0].title, direct.results[0].title)

  // a title-less entry fails as an item error while the rest still parse
  const noTitle = JSON.parse(TED_SEARCH_RESPONSE_RECORDING) as { notices: Record<string, unknown>[] }
  delete noTitle.notices[0]['notice-title']
  const partial = parseTedSearchBody(JSON.stringify(noTitle), PARSE_CONTEXT)
  assert.equal(partial.results.length, 2)
  assert.equal(partial.errors.length, 1)
  assert.equal(partial.errors[0].code, 'item_error')
  assert.equal(partial.errors[0].itemIndex, 0)

  const result = adapterWith(JSON.stringify(noTitle)).discover(tedRequest())
  assert.equal(result.status, 'PARTIAL')
  assert.equal(result.results.length, 2)
  assert.equal(result.errors.length, 1)
})

test('5. blocked access is reported as BLOCKED and never queried', () => {
  const definition = DEFAULT_SOURCE_REGISTRY.get(TED_SOURCE_ID)
  assert.ok(definition, 'TED must be registered')
  const restrictedRegistry = createSourceRegistry([{ ...definition, accessState: 'UNKNOWN' }])

  const { transport, calls } = syncTransport({ status: 200, body: TED_SEARCH_RESPONSE_RECORDING })
  const adapter = createTedAdapter({ transport, registry: restrictedRegistry })
  const request = tedRequest()

  const gate = gateDiscovery(request, { registry: restrictedRegistry, adapter })
  assert.equal(gate.status, 'BLOCKED')
  if (gate.status === 'BLOCKED') {
    assert.equal(gate.result.status, 'BLOCKED')
    assert.equal(gate.result.results.length, 0)
    assert.equal(gate.result.errors[0]?.code, 'source_blocked')
    assert.equal(gate.result.provenance.accessState, 'UNKNOWN')
  }

  const direct = adapter.discover(request)
  assert.equal(direct.status, 'BLOCKED')
  assert.equal(direct.errors[0]?.code, 'source_blocked')
  assert.equal(calls.length, 0, 'the transport is never touched for a non-AVAILABLE source')

  // the source refuses access at runtime → BLOCKED, never an empty success
  const refused = adapterWith('Forbidden', 403).discover(tedRequest({ runId: 'RUN-TED-403' }))
  assert.equal(refused.status, 'BLOCKED')
  assert.equal(refused.blockedReason, 'source refused access (HTTP 403)')
  assert.equal(refused.results.length, 0)
  assert.equal(refused.errors[0]?.code, 'source_blocked')
  assert.match(refused.errors[0]?.message ?? '', /never bypassed/)
})

test('6. request failures stay failures — never SUCCESS with zero results', async () => {
  const thrown = createTedAdapter({
    transport: () => {
      throw new Error('connection reset by peer')
    },
  }).discover(tedRequest())
  assert.equal(thrown.status, 'FAILED')
  assert.equal(thrown.results.length, 0)
  assert.equal(thrown.errors[0]?.code, 'adapter_error')
  assert.match(thrown.errors[0]?.message ?? '', /connection reset by peer/)

  const serverError = adapterWith('<html>Internal Server Error</html>', 500).discover(tedRequest())
  assert.equal(serverError.status, 'FAILED')
  assert.match(serverError.errors[0]?.message ?? '', /HTTP 500/)

  const rateLimited = adapterWith('', 429).discover(tedRequest())
  assert.equal(rateLimited.status, 'FAILED')
  assert.match(rateLimited.errors[0]?.message ?? '', /rate-limited the request \(HTTP 429\)/)

  const badConfig = adapterWith(TED_SEARCH_RESPONSE_RECORDING).discover(
    tedRequest({ adapterConfig: { publishedSince: '08-09-2026' } }),
  )
  assert.equal(badConfig.status, 'FAILED')
  assert.equal(badConfig.errors[0]?.code, 'invalid_request')

  // an asynchronous transport rejection surfaces through retrieve() as FAILED
  const rejecting = createTedAdapter({
    transport: () => Promise.reject(new Error('socket hang up')),
  })
  const request = tedRequest({ runId: 'RUN-TED-REJECT' })
  await rejecting.retrieve(request)
  const rejected = rejecting.discover(request)
  assert.equal(rejected.status, 'FAILED')
  assert.match(rejected.errors[0]?.message ?? '', /socket hang up/)
})

test('7. malformed, unexpected, and truncated responses stay observable', () => {
  const notJson = adapterWith('<html><body>502 Bad Gateway</body></html>').discover(tedRequest())
  assert.equal(notJson.status, 'FAILED')
  assert.equal(notJson.results.length, 0)
  assert.match(notJson.errors[0]?.message ?? '', /not valid JSON/)

  const wrongShape = adapterWith('{"status":"ok"}').discover(tedRequest({ runId: 'RUN-TED-SHAPE' }))
  assert.equal(wrongShape.status, 'FAILED')
  assert.match(wrongShape.errors[0]?.message ?? '', /unexpected shape/)

  const truncated = adapterWith(
    JSON.stringify({ notices: [], totalNoticeCount: 43, iterationNextToken: 'abc', timedOut: true }),
  ).discover(tedRequest({ runId: 'RUN-TED-TRUNC' }))
  assert.equal(truncated.status, 'FAILED')
  assert.equal(truncated.results.length, 0)
  assert.match(truncated.errors[0]?.message ?? '', /truncated by a source-side timeout/)

  const recorded = JSON.parse(TED_SEARCH_RESPONSE_RECORDING) as { notices: unknown[] }
  const timedOutWithResults = adapterWith(
    JSON.stringify({
      notices: [recorded.notices[0]],
      totalNoticeCount: 43,
      iterationNextToken: 'abc',
      timedOut: true,
    }),
  ).discover(tedRequest({ runId: 'RUN-TED-TIMEDOUT' }))
  assert.equal(timedOutWithResults.status, 'SUCCESS')
  assert.equal(timedOutWithResults.results.length, 1)
  assert.ok(
    timedOutWithResults.warnings.some((warning) => warning.includes('timed-out')),
    'the incomplete response is visible as a warning',
  )
})

test('8. adapter output passes the existing candidate pipeline', () => {
  const { transport } = syncTransport({ status: 200, body: TED_SEARCH_RESPONSE_RECORDING })
  const adapter = createTedAdapter({ transport })

  const outcome = runCandidatePipeline(tedRequest(), { registry: DEFAULT_SOURCE_REGISTRY, adapter })
  assert.equal(outcome.outcome, 'SUCCESS')
  assert.equal(outcome.sourceId, TED_SOURCE_ID)
  assert.equal(outcome.adapterType, 'ted')
  assert.equal(outcome.accessState, 'AVAILABLE')
  assert.equal(outcome.counts.candidatesReceived, 3)
  assert.equal(outcome.counts.candidatesCreated, 3)
  assert.equal(outcome.counts.normalized, 3)
  assert.equal(outcome.counts.classified, 3)
  assert.equal(outcome.counts.distinct, 3)
  assert.equal(outcome.counts.blocked, 0)
  assert.equal(outcome.counts.failed, 0)
  assert.equal(outcome.errors.length, 0)
  assert.equal(outcome.candidates.length, 3)

  for (const candidate of outcome.candidates) {
    assert.equal(candidate.sourceId, TED_SOURCE_ID)
    assert.ok(candidate.provenance.stageHistory.includes('transform'))
  }
  assert.equal(outcome.candidates[0].sourceRecordId, '534463-2026')
})

test('9. the live-source modules perform no vault write', () => {
  const modules = [
    'ted-adapter.ts',
    'ted-fixture.ts',
    '../live-source/fetch-transport.ts',
    '../live-source/verify-ted.ts',
  ]
  const forbidden = [
    'writeFileSync(',
    'appendFileSync(',
    'appendFile(',
    'createWriteStream(',
    'copyFileSync(',
    'mkdirSync(',
    'rmSync(',
    'node:fs',
    'vault-writer',
    '../import',
    'Opportunity Intelligence',
  ]
  for (const module of modules) {
    const source = readFileSync(new URL(module, import.meta.url), 'utf8')
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${module} must not contain "${token}"`)
    }
  }
})

test('10. the tests perform no network access', () => {
  // the adapter layer and its recorded fixture hold no network primitive
  for (const module of ['ted-adapter.ts', 'ted-fixture.ts']) {
    const source = readFileSync(new URL(module, import.meta.url), 'utf8')
    for (const token of ['fetch(', 'axios', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'node:http', 'node:https', 'node:net', 'child_process']) {
      assert.equal(source.includes(token), false, `${module} must not contain "${token}"`)
    }
  }

  // this suite never imports the live transport — retrieval is always injected
  const ownSource = readFileSync(new URL('ted-adapter.test.ts', import.meta.url), 'utf8')
  assert.equal(/from\s+['"][^'"]*live-source/.test(ownSource), false, 'the test suite must not import src/live-source')
  const liveTransportFactory = ['create', 'Fetch', 'Transport'].join('')
  assert.equal(ownSource.includes(liveTransportFactory), false, 'the test suite must not reference the live transport')

  // and every run in this suite is proven to hit the injected transport exactly once
  const { transport, calls } = syncTransport({ status: 200, body: TED_SEARCH_RESPONSE_RECORDING })
  createTedAdapter({ transport }).discover(tedRequest({ runId: 'RUN-TED-COUNT' }))
  assert.equal(calls.length, 1)
})
