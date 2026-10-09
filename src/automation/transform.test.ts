/**
 * Candidate transformation tests (Phase C brief §4, §5).
 *
 * Behavior under test:
 *  - SUCCESS  → one NEW candidate per raw listing
 *  - PARTIAL  → candidates for the surviving items, per-item errors preserved
 *  - BLOCKED  → no candidates, reason preserved
 *  - FAILED   → no candidates, errors preserved
 *  - EMPTY    → a valid empty outcome, never confused with a failure
 *  - deterministic candidate ids (record id preferred; stable-hash fallback)
 *  - candidates are immutable
 *
 * Uses only fixture / synthetic adapter results. No network.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_SOURCE_REGISTRY } from './registry'
import { createFixtureAdapter } from './fixture-adapter'
import { runDiscovery } from './discovery-run'
import {
  FIXTURE_FUNDING_SOURCE_ID,
  FIXTURE_PROCUREMENT_SOURCE_ID,
  GLOBALTENDERS_SOURCE_ID,
} from './registry'
import { candidateIdFor, stableHash, type DiscoveryCandidate } from './candidate'
import { candidateFromRawResult, transformAdapterResult } from './transform'
import { makeRaw, syntheticAdapterResult, fixtureRequest } from './phase-c-fixtures'
import type { AdapterResult } from './types'

const PROCUREMENT_ADAPTER = createFixtureAdapter(FIXTURE_PROCUREMENT_SOURCE_ID)
const FUNDING_ADAPTER = createFixtureAdapter(FIXTURE_FUNDING_SOURCE_ID)

test('a SUCCESS funding run transforms to one NEW candidate with the source record id', () => {
  const result = runDiscovery(
    fixtureRequest({ sourceId: FIXTURE_FUNDING_SOURCE_ID, domain: 'funding' }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: FUNDING_ADAPTER },
  )
  const outcome = transformAdapterResult(result)

  assert.equal(outcome.kind, 'success')
  assert.equal(outcome.errors.length, 0)
  assert.equal(outcome.candidates.length, 1)

  const candidate = outcome.candidates[0] ?? assert.fail('expected a candidate')
  assert.equal(candidate.candidateId, 'DC:SU-FX-002:FX-F-2001')
  assert.equal(candidate.candidateStatus, 'NEW')
  assert.equal(candidate.domain, 'funding')
  assert.equal(candidate.candidateType, 'opportunity')
  assert.equal(candidate.sourceRawType, 'grant')
  assert.equal(candidate.sourceOrganization, 'Fixture Climate Innovation Fund')
  assert.equal(candidate.sourcePublicationDate, '2026-08-15')
  assert.equal(candidate.sourceDeadline, '2027-01-31')
  assert.deepEqual(candidate.provenance.stageHistory, ['transform'])
  assert.equal(candidate.provenance.sourceId, FIXTURE_FUNDING_SOURCE_ID)
  assert.equal(candidate.provenance.companyId, 'COM-PHASEC')
  assert.equal(candidate.normalization, null)
  assert.equal(candidate.classification, null)
  assert.equal(candidate.duplicate, null)
})

test('a SUCCESS procurement run transforms both listings to NEW candidates', () => {
  const result = runDiscovery(fixtureRequest(), { registry: DEFAULT_SOURCE_REGISTRY, adapter: PROCUREMENT_ADAPTER })
  const outcome = transformAdapterResult(result)

  assert.equal(outcome.kind, 'success')
  assert.equal(outcome.candidates.length, 2)
  assert.equal(outcome.candidates[0]?.candidateId, 'DC:SU-FX-001:FX-P-1001')
  assert.equal(outcome.candidates[1]?.candidateId, 'DC:SU-FX-001:FX-P-1002')
  assert.equal(outcome.candidates[0]?.domain, 'procurement')
  assert.ok(outcome.candidates.every((candidate) => candidate.candidateStatus === 'NEW'))
})

test('a BLOCKED run produces no candidates and keeps the reason', () => {
  const result = runDiscovery(
    fixtureRequest({ sourceId: GLOBALTENDERS_SOURCE_ID, domain: 'procurement' }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: createFixtureAdapter(GLOBALTENDERS_SOURCE_ID) },
  )
  assert.equal(result.status, 'BLOCKED')

  const outcome = transformAdapterResult(result)
  assert.equal(outcome.kind, 'blocked')
  assert.equal(outcome.candidates.length, 0)
  assert.ok(outcome.errors.some((error) => error.includes('blocked')), 'the blocked reason must survive')
})

test('a FAILED run produces no candidates and keeps the adapter error', () => {
  const result = runDiscovery(
    fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID, adapterConfig: { scenario: 'failure' } }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: PROCUREMENT_ADAPTER },
  )
  const outcome = transformAdapterResult(result)

  assert.equal(outcome.kind, 'failed')
  assert.equal(outcome.candidates.length, 0)
  assert.ok(outcome.errors.some((error) => error.includes('adapter_error')))
})

test('a PARTIAL run keeps the surviving items and the per-item errors', () => {
  const result = runDiscovery(
    fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID, adapterConfig: { scenario: 'partial' } }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: PROCUREMENT_ADAPTER },
  )
  const outcome = transformAdapterResult(result)

  assert.equal(outcome.kind, 'partial')
  assert.equal(outcome.candidates.length, 2, 'surviving items still become candidates')
  assert.equal(outcome.errors.length, 1)
  assert.match(outcome.errors[0] ?? '', /item 0/)
})

test('an empty SUCCESS run is a valid empty outcome, distinct from a failure', () => {
  const result = runDiscovery(
    fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID, adapterConfig: { scenario: 'empty' } }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: PROCUREMENT_ADAPTER },
  )
  const outcome = transformAdapterResult(result)

  assert.equal(outcome.kind, 'empty')
  assert.equal(outcome.candidates.length, 0)
  assert.equal(outcome.errors.length, 0)
})

test('candidate ids fall back to a stable URL hash when there is no record id', () => {
  const request = fixtureRequest({ sourceId: FIXTURE_FUNDING_SOURCE_ID, domain: 'funding' })
  const result: AdapterResult = syntheticAdapterResult({
    request,
    sourceName: 'Fixture Grants Portal (test)',
    adapterType: 'fixture',
    results: [
      makeRaw({
        sourceId: FIXTURE_FUNDING_SOURCE_ID,
        sourceUrl: 'https://fixture.invalid/grants/no-record-id',
        title: 'Fixture No Record Id Grant',
        rawType: 'grant',
      }),
    ],
  })
  const outcome = transformAdapterResult(result)
  const candidate = outcome.candidates[0] ?? assert.fail('expected a candidate')
  const expected = `DC:${FIXTURE_FUNDING_SOURCE_ID}:h${stableHash('https://fixture.invalid/grants/no-record-id')}`
  assert.equal(candidate.candidateId, expected)
})

test('candidate ids fall back to a payload hash when there is neither record id nor URL', () => {
  const request = fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID, domain: 'procurement' })
  const result: AdapterResult = syntheticAdapterResult({
    request,
    sourceName: 'Fixture Procurement Portal (test)',
    adapterType: 'fixture',
    results: [
      makeRaw({
        sourceId: FIXTURE_PROCUREMENT_SOURCE_ID,
        sourceUrl: '',
        title: 'Fixture Listing Without Url',
        rawType: 'RFB',
        rawPayload: '{"fixture":true,"seed":42}',
      }),
    ],
  })
  const candidate = transformAdapterResult(result).candidates[0] ?? assert.fail('expected a candidate')
  const expected = `DC:${FIXTURE_PROCUREMENT_SOURCE_ID}:h${stableHash('{"fixture":true,"seed":42}')}`
  assert.equal(candidate.candidateId, expected)
})

test('candidate ids and hashes are deterministic: identical inputs give identical outputs', () => {
  const input = {
    sourceId: 'SU-FX-001',
    sourceRecordId: 'FX-P-1001' as string | null,
    sourceUrl: 'https://fixture.invalid/tenders/FX-P-1001',
    rawPayload: '{"fixture":true}',
  }
  assert.equal(candidateIdFor(input), candidateIdFor(input))
  assert.equal(stableHash('same-string'), stableHash('same-string'))
  assert.notEqual(stableHash('a'), stableHash('b'))
  assert.match(stableHash('x'), /^[0-9a-f]{16}$/)
})

test('candidates are immutable: mutations are rejected', () => {
  const result = runDiscovery(
    fixtureRequest({ sourceId: FIXTURE_FUNDING_SOURCE_ID, domain: 'funding' }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: FUNDING_ADAPTER },
  )
  const candidate = transformAdapterResult(result).candidates[0] as DiscoveryCandidate

  assert.equal(Object.isFrozen(candidate), true)
  assert.throws(() => {
    ;(candidate as { sourceTitle: string }).sourceTitle = 'mutated'
  }, TypeError)
  assert.throws(() => {
    ;(candidate.provenance as unknown as { stageHistory: string[] }).stageHistory.push('nope')
  }, TypeError)
})

test('candidateFromRawResult rejects an adapter result without a domain (never fabricates)', () => {
  const request = fixtureRequest({ sourceId: FIXTURE_FUNDING_SOURCE_ID, domain: 'funding' })
  const raw = makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/x',
    title: 'Orphan',
    sourceRecordId: 'X-1',
  })
  const result = syntheticAdapterResult({ request, sourceName: 'x', adapterType: 'fixture' })
  assert.throws(() => candidateFromRawResult({ ...result, domain: null } as AdapterResult, raw), /without an adapter-result domain/)
})