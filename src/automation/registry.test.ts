/**
 * Source Registry tests (Phase B brief §2, §3, §10).
 *
 * Behavior under test: the registry is typed, deterministic, duplicate-free,
 * frozen, and contains plain declarative data only — no executable scraping
 * logic. GlobalTenders must be registered as metadata only and must never be
 * queryable in this phase.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_SOURCE_REGISTRY,
  EU_SEDIA_ADAPTER_TYPE,
  EU_SEDIA_SOURCE_ID,
  FIXTURE_ADAPTER_TYPE,
  FIXTURE_FUNDING_SOURCE_ID,
  FIXTURE_PROCUREMENT_SOURCE_ID,
  GLOBALTENDERS_ADAPTER_TYPE,
  GLOBALTENDERS_SOURCE_ID,
  GRANTS_GOV_ADAPTER_TYPE,
  GRANTS_GOV_SOURCE_ID,
  TED_ADAPTER_TYPE,
  TED_SOURCE_ID,
  USA_SPENDING_ADAPTER_TYPE,
  USA_SPENDING_SOURCE_ID,
  createSourceRegistry,
  sourceAppliesTo,
  type SourceDefinition,
  type SourceRegistry,
} from './registry'
import type { AccessState, DiscoveryDomain } from './types'
import { ACCESS_STATES } from './types'

const fixtureProcurementDefinition: SourceDefinition = {
  sourceId: FIXTURE_PROCUREMENT_SOURCE_ID,
  name: 'Fixture Procurement Portal (local, deterministic)',
  domain: 'fixture.invalid',
  applicability: 'procurement',
  discoveryCapability: 'listing_search',
  accessState: 'AVAILABLE',
  adapterType: FIXTURE_ADAPTER_TYPE,
  provenanceRequirements: ['listing_url', 'raw_payload', 'observed_at', 'query_terms'],
  notesRestrictions: ['Local fixture only. No network access.'],
}

function asJson<T>(value: T): string {
  return JSON.stringify(value)
}

test('access-state vocabulary is exactly the Phase A set', () => {
  assert.deepEqual(ACCESS_STATES, ['AVAILABLE', 'RESTRICTED', 'UNAVAILABLE', 'UNKNOWN'])
})

test('registry is deterministic: identical definitions produce identical registries', () => {
  const defs: SourceDefinition[] = [fixtureProcurementDefinition]
  const a = createSourceRegistry(defs)
  const b = createSourceRegistry(defs)

  assert.equal(a.size, b.size)
  assert.equal(asJson(a.list()), asJson(b.list()))
  assert.equal(a.get(FIXTURE_PROCUREMENT_SOURCE_ID)?.accessState, 'AVAILABLE')
})

test('registry lists sources sorted by sourceId and is read-only', () => {
  const registry: SourceRegistry = createSourceRegistry([
    { ...fixtureProcurementDefinition, sourceId: 'SU-Z-001' },
    { ...fixtureProcurementDefinition, sourceId: 'SU-A-001' },
    { ...fixtureProcurementDefinition, sourceId: 'SU-M-001' },
  ])
  assert.deepEqual(
    registry.list().map((d) => d.sourceId),
    ['SU-A-001', 'SU-M-001', 'SU-Z-001'],
  )
  assert.throws(() => {
    ;(registry as unknown as { size: number }).size = 99
  }, TypeError)
})

test('source definitions are declarative data: no executable logic survives a JSON round-trip', () => {
  const definitions = DEFAULT_SOURCE_REGISTRY.list()
  assert.equal(asJson(JSON.parse(asJson(definitions))), asJson(definitions))

  for (const definition of definitions) {
    assert.deepEqual(
      Object.keys(definition),
      [
        'sourceId',
        'name',
        'domain',
        'applicability',
        'discoveryCapability',
        'accessState',
        'adapterType',
        'provenanceRequirements',
        'notesRestrictions',
      ],
    )
  }
})

test('a definition with an invalid access state is rejected at registry construction', () => {
  const bad = { ...fixtureProcurementDefinition, accessState: 'MAYBE' as AccessState }
  assert.throws(() => createSourceRegistry([bad]), /accessState/)
})

test('duplicate sourceIds are rejected', () => {
  assert.throws(
    () => createSourceRegistry([fixtureProcurementDefinition, { ...fixtureProcurementDefinition }]),
    /duplicate sourceId/,
  )
})

test('GlobalTenders is registered as metadata only and is never queryable in this phase', () => {
  const entry = DEFAULT_SOURCE_REGISTRY.get(GLOBALTENDERS_SOURCE_ID)
  assert.ok(entry, 'GlobalTenders must be present in the registry')
  assert.equal(entry.name, 'GlobalTenders')
  assert.equal(entry.applicability, 'procurement')
  assert.equal(entry.discoveryCapability, 'listing_search')
  assert.equal(entry.adapterType, GLOBALTENDERS_ADAPTER_TYPE)
  assert.equal(entry.accessState, 'UNKNOWN', 'UNKNOWN must never be treated as AVAILABLE')
  assert.ok(
    entry.notesRestrictions[0].includes('NOT implemented in Phase B'),
    'registration must document that the live adapter is not implemented',
  )
})

test('GlobalTenders cannot be executed even if an adapter is bound to it', async () => {
  const { runDiscovery } = await import('./discovery-run')
  const { createFixtureAdapter } = await import('./fixture-adapter')
  const adapter = createFixtureAdapter(GLOBALTENDERS_SOURCE_ID)

  const request = {
    runId: 'RUN-GT-PROBE',
    companyId: 'COM-001',
    discoveryProfileId: 'DP-COM-001-v1',
    sourceId: GLOBALTENDERS_SOURCE_ID,
    domain: 'procurement' as DiscoveryDomain,
    queryTerms: ['fixture search'],
    exclusions: [],
    requestedAt: '2026-10-07T00:00:00.000Z',
  }

  const result = runDiscovery(request, { registry: DEFAULT_SOURCE_REGISTRY, adapter })
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.results.length, 0)
  assert.equal(result.errors[0]?.code, 'source_blocked')
  assert.equal(result.provenance.accessState, 'UNKNOWN')
})

test('sourceAppliesTo enforces the funding/procurement applicability matrix', () => {
  assert.equal(sourceAppliesTo('procurement', 'procurement'), true)
  assert.equal(sourceAppliesTo('funding', 'funding'), true)
  assert.equal(sourceAppliesTo('both', 'funding'), true)
  assert.equal(sourceAppliesTo('both', 'procurement'), true)
  assert.equal(sourceAppliesTo('procurement', 'funding'), false)
  assert.equal(sourceAppliesTo('funding', 'procurement'), false)
})

test('default registry contains GlobalTenders plus both fixture sources, TED, USAspending, Grants.gov, and the EU source', () => {
  assert.ok(DEFAULT_SOURCE_REGISTRY.has(GLOBALTENDERS_SOURCE_ID))
  assert.ok(DEFAULT_SOURCE_REGISTRY.has(FIXTURE_PROCUREMENT_SOURCE_ID))
  assert.ok(DEFAULT_SOURCE_REGISTRY.has(FIXTURE_FUNDING_SOURCE_ID))
  assert.ok(DEFAULT_SOURCE_REGISTRY.has(TED_SOURCE_ID))
  assert.ok(DEFAULT_SOURCE_REGISTRY.has(USA_SPENDING_SOURCE_ID))
  assert.ok(DEFAULT_SOURCE_REGISTRY.has(GRANTS_GOV_SOURCE_ID))
  assert.ok(DEFAULT_SOURCE_REGISTRY.has(EU_SEDIA_SOURCE_ID))
  assert.equal(DEFAULT_SOURCE_REGISTRY.size, 7)
})

test('Grants.gov is registered as a funding-opportunity source before verification (Phase 19B)', () => {
  const entry = DEFAULT_SOURCE_REGISTRY.get(GRANTS_GOV_SOURCE_ID)
  assert.ok(entry, 'Grants.gov must be present in the registry')
  assert.equal(entry.domain, 'api.grants.gov')
  assert.equal(entry.applicability, 'funding')
  assert.equal(entry.discoveryCapability, 'listing_search')
  assert.equal(entry.adapterType, GRANTS_GOV_ADAPTER_TYPE)
  assert.equal(entry.accessState, 'UNKNOWN', 'no verified read-only search has run yet, so access is not assumed AVAILABLE')
  assert.equal(entry.domain.includes('://'), false, 'the registry records a host, never a dereferenceable URL')
  assert.ok(entry.notesRestrictions.join(' ').includes('OPPORTUNITIES'), 'it describes grant opportunities, not historical awards')
  assert.ok(entry.notesRestrictions.join(' ').includes('no API key'), 'no credentials are used')
})

test('the EU Funding & Tenders source is registered before verification (Phase 21C)', () => {
  const entry = DEFAULT_SOURCE_REGISTRY.get(EU_SEDIA_SOURCE_ID)
  assert.ok(entry, 'the EU source must be present in the registry')
  assert.equal(entry.domain, 'api.tech.ec.europa.eu')
  assert.equal(entry.applicability, 'funding')
  assert.equal(entry.discoveryCapability, 'listing_search')
  assert.equal(entry.adapterType, EU_SEDIA_ADAPTER_TYPE)
  assert.equal(entry.accessState, 'UNKNOWN', 'no verified read-only search has run yet, so access is not assumed AVAILABLE')
  assert.equal(entry.domain.includes('://'), false, 'the registry records a host, never a dereferenceable URL')
})

test('USAspending is registered only with verified access facts (Phase V)', () => {
  const entry = DEFAULT_SOURCE_REGISTRY.get(USA_SPENDING_SOURCE_ID)
  assert.ok(entry, 'USAspending must be present in the registry')
  assert.equal(entry.applicability, 'funding')
  assert.equal(entry.discoveryCapability, 'listing_search')
  assert.equal(entry.adapterType, USA_SPENDING_ADAPTER_TYPE)
  assert.equal(entry.accessState, 'AVAILABLE', 'AVAILABLE reflects the verified read-only search, not adapter existence')
  assert.ok(entry.domain.includes('://') === false, 'the registry records a host, never a dereferenceable URL')
  assert.ok(entry.notesRestrictions.join(' ').includes('2026-10-09'), 'the verification date is recorded as a fact')
  assert.ok(entry.notesRestrictions.join(' ').includes('no API key'), 'no credentials are used')
})

test('TED is registered only with verified access facts (Phase U)', () => {
  const entry = DEFAULT_SOURCE_REGISTRY.get(TED_SOURCE_ID)
  assert.ok(entry, 'TED must be present in the registry')
  assert.equal(entry.name, 'TED — Tenders Electronic Daily (EU Official Journal)')
  assert.equal(entry.domain, 'ted.europa.eu')
  assert.equal(entry.applicability, 'procurement')
  assert.equal(entry.discoveryCapability, 'listing_search')
  assert.equal(entry.adapterType, TED_ADAPTER_TYPE)
  assert.equal(entry.accessState, 'AVAILABLE', 'AVAILABLE reflects the verified read-only search, not adapter existence')
  assert.ok(entry.domain.includes('://') === false, 'the registry records a host, never a dereferenceable URL')
  assert.ok(entry.notesRestrictions.join(' ').includes('2026-10-08'), 'the verification date is recorded as a fact')
})