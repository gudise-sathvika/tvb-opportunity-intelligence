/**
 * USAspending real-funding-source adapter tests — Phase V.
 *
 * All tests run against a byte-for-byte recording of one real API response
 * (`./usaspending-fixture.ts`) injected through an in-memory transport: no test
 * touches the live internet, and no test writes to the vault.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  USA_SPENDING_AWARD_PREFIX,
  USA_SPENDING_SEARCH_ENDPOINT,
  createUsaSpendingAdapter,
  parseUsaSpendingBody,
  type UsaSpendingTransport,
  type UsaSpendingTransportResponse,
} from './usaspending-adapter'
import { USA_SPENDING_RECORDING_KEYWORD, USA_SPENDING_RECORDING_OBSERVED_AT, USA_SPENDING_SEARCH_RESPONSE_RECORDING } from './usaspending-fixture'
import { createDiscoveryRequest, type DiscoveryRequest } from './request'
import { DEFAULT_SOURCE_REGISTRY, USA_SPENDING_SOURCE_ID, createSourceRegistry } from './registry'
import { gateDiscovery, runDiscovery } from './discovery-run'

const PARSE_CONTEXT = {
  sourceId: USA_SPENDING_SOURCE_ID,
  observedAt: USA_SPENDING_RECORDING_OBSERVED_AT,
  queryTerm: USA_SPENDING_RECORDING_KEYWORD,
}

function usRequest(overrides: Partial<DiscoveryRequest> = {}): DiscoveryRequest {
  return createDiscoveryRequest({
    runId: 'RUN-USA-TEST-001',
    companyId: 'COM-001',
    discoveryProfileId: 'DP-LIVE-002',
    sourceId: USA_SPENDING_SOURCE_ID,
    domain: 'funding',
    queryTerms: [USA_SPENDING_RECORDING_KEYWORD],
    exclusions: [],
    requestedAt: USA_SPENDING_RECORDING_OBSERVED_AT,
    keyword: USA_SPENDING_RECORDING_KEYWORD,
    ...overrides,
  })
}

interface InMemoryTransport {
  readonly transport: UsaSpendingTransport
  readonly calls: Array<{ url: string; body: string }>
}

function syncTransport(response: UsaSpendingTransportResponse): InMemoryTransport {
  const calls: Array<{ url: string; body: string }> = []
  return {
    transport: (url, init) => {
      calls.push({ url, body: init.body })
      return { status: response.status, body: response.body }
    },
    calls,
  }
}

test('parse records every genuine award into a raw result with a live-source detail link', () => {
  const parsed = parseUsaSpendingBody(USA_SPENDING_SEARCH_RESPONSE_RECORDING, PARSE_CONTEXT)

  assert.equal(parsed.results.length, 3)
  assert.deepEqual(parsed.errors, [])

  const first = parsed.results[0]
  assert.equal(first.sourceRecordId, 'DEEE0001531')
  assert.equal(first.sourceUrl, `${USA_SPENDING_AWARD_PREFIX}260355439?tab=overview`)
  assert.match(first.title, /solar energy/i)
  assert.equal(first.issuingOrganization, 'Department of Energy')
  assert.equal(first.country, 'US')
  assert.equal(first.rawProvenance.sourceId, USA_SPENDING_SOURCE_ID)
  assert.equal(first.rawProvenance.observedAt, USA_SPENDING_RECORDING_OBSERVED_AT)
  assert.ok(parsed.warnings.some((warning) => warning.includes('time period start and end dates')))
})

test('runs the real pipeline over the recorded funding response (SUCCESS, 3 funding candidates)', () => {
  const captured = syncTransport({ status: 200, body: USA_SPENDING_SEARCH_RESPONSE_RECORDING })
  const adapter = createUsaSpendingAdapter({ transport: captured.transport })
  const request = usRequest()

  assert.equal(gateDiscovery(request, { registry: DEFAULT_SOURCE_REGISTRY, adapter }).status, 'READY')

  const source = runDiscovery(request, { registry: DEFAULT_SOURCE_REGISTRY, adapter })

  assert.equal(captured.calls.length, 1)
  assert.equal(captured.calls[0].url, USA_SPENDING_SEARCH_ENDPOINT)
  assert.ok(captured.calls[0].body.includes('"award_type_codes":["02"]'))
  assert.ok(captured.calls[0].body.includes('"keywords":["solar energy"]'))
  assert.equal(source.sourceId, USA_SPENDING_SOURCE_ID)
  assert.equal(source.status, 'SUCCESS')
  assert.equal(source.results.length, 3)
})

test('every genuine award is normalized into a funding candidate with a title and live-source provenance', () => {
  const adapter = createUsaSpendingAdapter({
    transport: syncTransport({ status: 200, body: USA_SPENDING_SEARCH_RESPONSE_RECORDING }).transport,
  })
  const request = usRequest()
  const source = runDiscovery(request, { registry: DEFAULT_SOURCE_REGISTRY, adapter })

  assert.ok(source.results.length > 0)
  assert.ok(source.results.length > 0)
  assert.ok(source.results.every((result) => result.title.length > 0))
  assert.ok(source.results.every((result) => result.rawProvenance.sourceId === USA_SPENDING_SOURCE_ID))
  assert.ok(source.results.every((result) => result.sourceUrl.startsWith(USA_SPENDING_AWARD_PREFIX)))
})

test('wrong source, unregistered source, and non-AVAILABLE access are BLOCKED without touching the transport', () => {
  const captured = syncTransport({ status: 200, body: USA_SPENDING_SEARCH_RESPONSE_RECORDING })
  const registry = createSourceRegistry([
    {
      sourceId: USA_SPENDING_SOURCE_ID,
      name: 'USAspending — US Federal Grants & Awards',
      domain: 'api.usaspending.gov',
      applicability: 'funding',
      discoveryCapability: 'listing_search',
      accessState: 'UNKNOWN',
      adapterType: 'usaspending',
      provenanceRequirements: ['listing_url', 'raw_payload', 'observed_at', 'query_terms'],
      notesRestrictions: [],
    },
  ])
  const adapter = createUsaSpendingAdapter({ transport: captured.transport, registry })

  const wrongSource = adapter.discover(usRequest({ sourceId: 'SU-GT-001', keyword: 'x' }))
  assert.equal(wrongSource.status, 'BLOCKED')

  const unknown = adapter.discover(usRequest({ sourceId: 'SU-UNKNOWN-001', keyword: 'x' }))
  assert.equal(unknown.status, 'BLOCKED')

  const notAvailable = adapter.discover(usRequest())
  assert.equal(notAvailable.status, 'BLOCKED')
  assert.ok(notAvailable.blockedReason?.includes('UNKNOWN'))

  assert.equal(captured.calls.length, 0)
})

test('an HTTP 403 is a RESTRICTED BLOCKED result, never a bypass or an empty success', () => {
  const adapter = createUsaSpendingAdapter({
    transport: syncTransport({ status: 403, body: '{"message":"Missing Authentication Token"}' }).transport,
  })
  const result = adapter.discover(usRequest())
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.accessState, 'RESTRICTED')
})

test('transport failures stay FAILED and are never converted into SUCCESS', () => {
  const adapter = createUsaSpendingAdapter({
    transport: () => {
      throw new Error('network unreachable')
    },
  })
  const result = adapter.discover(usRequest())
  assert.equal(result.status, 'FAILED')
  assert.deepEqual(result.results, [])
})

test('a publishedSince window is sent as a time_period with BOTH start_date and end_date (the source requires both)', () => {
  const captured = syncTransport({ status: 200, body: USA_SPENDING_SEARCH_RESPONSE_RECORDING })
  const adapter = createUsaSpendingAdapter({ transport: captured.transport })
  const request = usRequest({ adapterConfig: { publishedSince: '20251009', limit: 10 } })

  const source = runDiscovery(request, { registry: DEFAULT_SOURCE_REGISTRY, adapter })

  assert.equal(captured.calls.length, 1)
  const body = JSON.parse(captured.calls[0].body) as {
    filters: { time_period?: Array<{ start_date: string; end_date: string }> }
  }
  assert.deepEqual(body.filters.time_period, [{ start_date: '2025-10-09', end_date: '2026-10-09' }])
  assert.equal(source.status, 'SUCCESS')
  assert.ok(source.warnings.some((warning) => warning.includes('time_period window (2025-10-09 to 2026-10-09)')))
})

test('a search without publishedSince sends no time_period at all', () => {
  const captured = syncTransport({ status: 200, body: USA_SPENDING_SEARCH_RESPONSE_RECORDING })
  const adapter = createUsaSpendingAdapter({ transport: captured.transport })
  runDiscovery(usRequest(), { registry: DEFAULT_SOURCE_REGISTRY, adapter })

  assert.equal(captured.calls.length, 1)
  const body = JSON.parse(captured.calls[0].body) as { filters: Record<string, unknown> }
  assert.equal('time_period' in body.filters, false)
})

test('a publishedSince later than the request date fails as invalid_request before any source call', () => {
  const captured = syncTransport({ status: 200, body: USA_SPENDING_SEARCH_RESPONSE_RECORDING })
  const adapter = createUsaSpendingAdapter({ transport: captured.transport })

  const result = adapter.discover(usRequest({ adapterConfig: { publishedSince: '20990101' } }))

  assert.equal(result.status, 'FAILED')
  assert.equal(result.errors[0].code, 'invalid_request')
  assert.match(result.errors[0].message, /time_period would be empty/)
  assert.equal(captured.calls.length, 0)
})

test('a request whose requestedAt cannot bound the window fails as invalid_request before any source call', () => {
  const captured = syncTransport({ status: 200, body: USA_SPENDING_SEARCH_RESPONSE_RECORDING })
  const adapter = createUsaSpendingAdapter({ transport: captured.transport })

  const result = adapter.discover(usRequest({ adapterConfig: { publishedSince: '20251009' }, requestedAt: 'not-a-date' }))

  assert.equal(result.status, 'FAILED')
  assert.equal(result.errors[0].code, 'invalid_request')
  assert.match(result.errors[0].message, /bound the source time_period end_date/)
  assert.equal(captured.calls.length, 0)
})

test('an asynchronous transport without retrieve() fails with instructions', async () => {
  const adapter = createUsaSpendingAdapter({
    transport: (_url, _init) => Promise.resolve({ status: 200, body: USA_SPENDING_SEARCH_RESPONSE_RECORDING }),
  })
  const result = adapter.discover(usRequest())
  assert.equal(result.status, 'FAILED')
  assert.match(result.errors[0].message, /await adapter\.retrieve/)

  const retrieved = adapter as unknown as { retrieve(request: DiscoveryRequest): Promise<void> }
  await retrieved.retrieve(usRequest())
  assert.equal(adapter.discover(usRequest()).status, 'SUCCESS')
})