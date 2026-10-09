/**
 * Candidate deduplication tests (Phase C brief §9) — DEDUP-RULES-v1.
 *
 * Behavior under test (fixtures: exact by sourceRecordId, exact by URL,
 * possible by normalized identity, distinct similar records, cross-source
 * possible without auto-merge):
 *  - tier 1 (sourceId+sourceRecordId)   → EXACT_DUPLICATE → DUPLICATE
 *  - tier 2 (canonical URL)             → EXACT_DUPLICATE → DUPLICATE
 *  - tier 3 (folded title + corroboration) → POSSIBLE_DUPLICATE → REVIEW
 *  - everything else                    → DISTINCT
 *  - no candidate is ever merged; every candidate survives with metadata
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DiscoveryCandidate } from './candidate'
import { candidateFromRawResult } from './transform'
import { normalizeCandidate } from './normalize'
import { deduplicateCandidates, foldTitleKey } from './dedup'
import { makeRaw, syntheticAdapterResult, fixtureRequest } from './phase-c-fixtures'
import type { RawResult } from './types'

function normalized(domain: 'funding' | 'procurement', sourceId: string, sourceName: string, raw: RawResult): DiscoveryCandidate {
  const request = fixtureRequest({ sourceId, domain })
  const result = syntheticAdapterResult({ request, sourceName, adapterType: 'fixture', results: [raw] })
  return normalizeCandidate(candidateFromRawResult(result, raw))
}

const FUNDING = 'funding' as const
const SUPPLIER_ORG = 'Fixture Solar Foundation'
const COUNTRY_WONDERLAND = 'Wonderland'

test('foldTitleKey folds orthographic variants of the same word', () => {
  assert.equal(foldTitleKey('Solar Energy Grant Programme'), 'solar energy grant program')
  assert.equal(foldTitleKey('Solar Energy Grant Program'), 'solar energy grant program')
  assert.notEqual(foldTitleKey('Climate Innovation Grant'), 'solar energy grant program')
})

test('tier 1: the same sourceRecordId twice is an exact duplicate', () => {
  const first = normalized(FUNDING, 'SU-FX-002', 'Fixture Grants Portal A', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/a1',
    title: 'Fixture Repeater Grant',
    sourceRecordId: 'FX-F-5001',
    country: COUNTRY_WONDERLAND,
  }))
  const second = normalized(FUNDING, 'SU-FX-002', 'Fixture Grants Portal A', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/a1-again',
    title: 'Fixture Repeater Grant',
    sourceRecordId: 'FX-F-5001',
    country: COUNTRY_WONDERLAND,
  }))

  const [out1, out2] = deduplicateCandidates([first, second])
  assert.equal(out1?.duplicate?.verdict, 'DISTINCT')
  assert.equal(out2?.duplicate?.verdict, 'EXACT_DUPLICATE')
  assert.equal(out2?.duplicate?.evidence.tier, 1)
  assert.equal(out2?.duplicate?.evidence.matchedOn, 'sourceId+sourceRecordId')
  assert.equal(out2?.candidateStatus, 'DUPLICATE')
  assert.equal(out2?.duplicate?.evidence.otherCandidateId, out1?.candidateId)
})

test('tier 2: two sources pointing at the same canonical URL are exact duplicates', () => {
  const first = normalized(FUNDING, 'SU-FX-002', 'Fixture Grants Portal A', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/shared',
    title: 'Fixture Shared Grant',
    sourceRecordId: 'FX-F-5002',
    country: COUNTRY_WONDERLAND,
  }))
  const second = normalized(FUNDING, 'SU-FX-099', 'Fixture Cross Portal B', makeRaw({
    sourceUrl: 'https://FIXTURE.INVALID:443/grants/shared',
    title: 'Fixture Shared Grant',
    sourceRecordId: 'FX-9-5002',
    country: COUNTRY_WONDERLAND,
  }))

  const [out1, out2] = deduplicateCandidates([first, second])
  assert.equal(out1?.duplicate?.verdict, 'DISTINCT')
  assert.equal(out2?.duplicate?.verdict, 'EXACT_DUPLICATE')
  assert.equal(out2?.duplicate?.evidence.tier, 2)
  assert.equal(out2?.duplicate?.evidence.matchedOn, 'canonical-url')
  assert.equal(out2?.candidateStatus, 'DUPLICATE')
})

test('tier 3: Programme vs Program with a shared country signal is a possible duplicate', () => {
  const first = normalized(FUNDING, 'SU-FX-002', 'Fixture Grants Portal A', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/solar-a',
    title: 'Solar Energy Grant Programme',
    sourceRecordId: 'FX-F-5003',
    issuingOrganization: SUPPLIER_ORG,
    country: COUNTRY_WONDERLAND,
    deadline: '2027-01-31',
  }))
  const second = normalized(FUNDING, 'SU-FX-099', 'Fixture Cross Portal B', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/solar-b',
    title: 'Solar Energy Grant Program',
    sourceRecordId: 'FX-9-5003',
    issuingOrganization: 'Other International Agency',
    country: COUNTRY_WONDERLAND,
    deadline: '2027-06-30',
  }))

  const [out1, out2] = deduplicateCandidates([first, second])
  assert.equal(out1?.duplicate?.verdict, 'DISTINCT')
  assert.equal(out2?.duplicate?.verdict, 'POSSIBLE_DUPLICATE')
  assert.equal(out2?.duplicate?.evidence.tier, 3)
  assert.equal(out2?.duplicate?.evidence.matchedOn, 'folded-title+corroborating-signal')
  assert.ok(out2?.duplicate?.evidence.corroboratingSignals.includes('sourceCountry'))
  assert.equal(out2?.candidateStatus, 'REVIEW', 'possible duplicates go to human review')
  assert.equal(out2?.candidateId, 'DC:SU-FX-099:FX-9-5003', 'the candidate record is preserved, never merged')
})

test('distinct similar records with different folded titles are DISTINCT', () => {
  const first = normalized(FUNDING, 'SU-FX-002', 'Fixture Grants Portal A', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/climate-1',
    title: 'Fixture Climate Innovation Grant Programme',
    sourceRecordId: 'FX-F-5004',
    country: COUNTRY_WONDERLAND,
  }))
  const second = normalized(FUNDING, 'SU-FX-002', 'Fixture Grants Portal A', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/climate-2',
    title: 'Fixture Climate Innovation Fund',
    sourceRecordId: 'FX-F-5005',
    country: COUNTRY_WONDERLAND,
  }))

  const [out1, out2] = deduplicateCandidates([first, second])
  assert.equal(out1?.duplicate?.verdict, 'DISTINCT')
  assert.equal(out2?.duplicate?.verdict, 'DISTINCT')
  assert.equal(out2?.duplicate?.evidence.matchedOn, 'no-match')
})

test('cross-source possible duplicates are never silently merged', () => {
  const first = normalized(FUNDING, 'SU-FX-002', 'Fixture Grants Portal A', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/fx-002/1',
    title: 'Fixture Horizon Energy Grant Programme',
    sourceRecordId: 'FX-F-5006',
    country: COUNTRY_WONDERLAND,
  }))
  const second = normalized(FUNDING, 'SU-FX-099', 'Fixture Cross Portal B', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/fx-099/1',
    title: 'Fixture Horizon Energy Grant Program',
    sourceRecordId: 'FX-9-5006',
    country: COUNTRY_WONDERLAND,
  }))

  const results = deduplicateCandidates([first, second])
  assert.equal(results.length, 2, 'both records survive — possible duplicates are preserved')
  const firstOut = results[0] ?? assert.fail('missing first')
  const secondOut = results[1] ?? assert.fail('missing second')
  assert.equal(firstOut.candidateId, 'DC:SU-FX-002:FX-F-5006')
  assert.equal(secondOut.candidateId, 'DC:SU-FX-099:FX-9-5006')
  assert.equal(firstOut.duplicate?.verdict, 'DISTINCT')
  assert.equal(secondOut.duplicate?.verdict, 'POSSIBLE_DUPLICATE')
  assert.equal(secondOut.duplicate?.evidence.otherCandidateId, firstOut.candidateId)
  assert.equal(secondOut.candidateStatus, 'REVIEW')
  assert.equal(firstOut.candidateStatus, 'NORMALIZED')
})

test('the same sourceRecordId under different sources with unrelated titles is DISTINCT', () => {
  const first = normalized(FUNDING, 'SU-FX-002', 'Fixture Grants Portal A', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/uk-1',
    title: 'UK Offshore Wind Subsidy',
    sourceRecordId: 'FX-999',
    country: 'UK',
  }))
  const second = normalized(FUNDING, 'SU-FX-099', 'Fixture Cross Portal B', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/us-1',
    title: 'USA EV Charger Incentive',
    sourceRecordId: 'FX-999',
    country: 'USA',
  }))

  const [out1, out2] = deduplicateCandidates([first, second])
  assert.equal(out1?.duplicate?.verdict, 'DISTINCT')
  assert.equal(out2?.duplicate?.verdict, 'DISTINCT', 'tier 1 keys are per-source')
})

test('unrelated titles with no shared signals are DISTINCT', () => {
  const first = normalized(FUNDING, 'SU-FX-002', 'Fixture Grants Portal A', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/x1',
    title: 'Rural Broadband Grant',
    sourceRecordId: 'FX-F-5007',
    country: 'Wonderland',
  }))
  const second = normalized(FUNDING, 'SU-FX-002', 'Fixture Grants Portal A', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/x2',
    title: 'Hospital Heat Pump Fund',
    sourceRecordId: 'FX-F-5008',
    country: 'Wonderland',
  }))

  const [out1, out2] = deduplicateCandidates([first, second])
  assert.equal(out1?.duplicate?.verdict, 'DISTINCT')
  assert.equal(out2?.duplicate?.verdict, 'DISTINCT')
})

test('deduplication attaches stage provenance to every candidate', () => {
  const first = normalized(FUNDING, 'SU-FX-002', 'Fixture Grants Portal A', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/d1',
    title: 'Fixture Stage Grant',
    sourceRecordId: 'FX-F-5009',
  }))
  const second = normalized(FUNDING, 'SU-FX-002', 'Fixture Grants Portal A', makeRaw({
    sourceUrl: 'https://fixture.invalid/grants/d2',
    title: 'Fixture Stage Grant',
    sourceRecordId: 'FX-F-5010',
  }))

  const results = deduplicateCandidates([first, second])
  for (const candidate of results) {
    assert.deepEqual(candidate.provenance.stageHistory, ['transform', 'normalize', 'dedup'])
    assert.ok(candidate.duplicate, 'every candidate leaves dedup with a verdict')
  }
})