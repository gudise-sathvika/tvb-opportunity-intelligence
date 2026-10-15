/**
 * Tests for the discovery-candidate → match-opportunity bridge. The eligibility
 * state is the shared classifier's verdict (never a second interpretation), and
 * a candidate without a real official link/id is marked unverified and refused
 * by the match assembly — missing evidence stays missing.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GRANTS_GOV_SOURCE_ID, FIXTURE_FUNDING_SOURCE_ID } from './registry'
import type { DiscoveryCandidate } from './candidate'
import { candidateFromRawResult } from './transform'
import { fixtureRequest, makeRaw, syntheticAdapterResult } from './phase-c-fixtures'
import { candidateToVerifiedOpportunity } from './opportunity-match-input'
import { assembleMatchProposals } from './match-assembly'
import type { VerifiedCompanyProfile } from './company-profile'
import { gleifRecordToProfile } from './gleif-company-discovery'

const NOW = '2026-10-14T12:00:00.000Z'
const FUTURE = '2027-01-01'
const OFFICIAL_GRANTS = 'https://www.grants.gov/search-results-detail/350001'

function candidate(overrides: Partial<DiscoveryCandidate>): DiscoveryCandidate {
  const request = fixtureRequest({
    sourceId: FIXTURE_FUNDING_SOURCE_ID,
    domain: 'funding',
    runId: 'RUN-OPPINPUT',
    requestedAt: NOW,
  })
  const adapterResult = syntheticAdapterResult({
    request,
    sourceName: 'opportunity-match-input fixture',
    adapterType: 'fixture',
    results: [makeRaw({ sourceUrl: 'https://fixture.invalid/opportunity', title: 'Fixture', sourceRecordId: 'CV-1' })],
  })
  const raw = adapterResult.results[0] ?? assert.fail('expected a raw result')
  const base = candidateFromRawResult(adapterResult, raw)
  return { ...base, ...overrides }
}

test('an open candidate maps to eligibility `open` with verified provenance and its official link', () => {
  const entry = candidateToVerifiedOpportunity(
    candidate({ sourceId: GRANTS_GOV_SOURCE_ID, sourceStatus: 'posted', sourceDeadline: FUTURE, sourceUrl: OFFICIAL_GRANTS, sourceRecordId: '350001', sourceTitle: 'Open grant' }),
    NOW,
  )
  assert.equal(entry.eligibility, 'open')
  assert.equal(entry.provenance.status, 'verified')
  assert.equal(entry.provenance.source, OFFICIAL_GRANTS)
  assert.equal(entry.record.recordId, '350001')
  assert.equal(entry.record.recordType, 'opportunity')
})

test('non-open candidates never become open (expired, unknown, missing deadline)', () => {
  const cases: ReadonlyArray<[string, Partial<DiscoveryCandidate>]> = [
    ['expired', { sourceStatus: 'posted', sourceDeadline: '2026-01-01', sourceUrl: OFFICIAL_GRANTS }],
    ['unknown close', { sourceStatus: 'posted', sourceDeadline: null, sourceUrl: OFFICIAL_GRANTS }],
    ['forecasted', { sourceStatus: 'forecasted', sourceDeadline: FUTURE, sourceUrl: OFFICIAL_GRANTS }],
  ]
  for (const [label, overrides] of cases) {
    const entry = candidateToVerifiedOpportunity(
      candidate({ sourceId: GRANTS_GOV_SOURCE_ID, sourceRecordId: '350001', ...overrides }),
      NOW,
    )
    assert.notEqual(entry.eligibility, 'open', `${label} must not be open`)
  }
})

test('a candidate without a real official link/id is unverified and refused by the assembly', () => {
  const entry = candidateToVerifiedOpportunity(
    candidate({ sourceId: GRANTS_GOV_SOURCE_ID, sourceStatus: 'posted', sourceDeadline: FUTURE, sourceUrl: '', sourceRecordId: null }),
    NOW,
  )
  assert.equal(entry.provenance.status, 'unverified')
  const company: VerifiedCompanyProfile = {
    companyId: 'LEI-X',
    name: 'X',
    country: 'US',
    provenance: { source: 'https://api.gleif.org/api/v1/lei-records/X', verifiedAt: '2026-10-14', status: 'verified' },
  }
  const result = assembleMatchProposals({ companies: [company], opportunities: [entry] })
  assert.deepEqual(result.proposals, [])
  assert.equal(result.skippedOpportunities.length, 1)
})

test('a GLEIF-discovered company and a live open opportunity produce a PROPOSED match', () => {
  // A real GLEIF record (US) → verified profile with canonical country name.
  const outcome = gleifRecordToProfile(
    {
      id: '3C7474T6CDKPR9K6YT90',
      attributes: {
        lei: '3C7474T6CDKPR9K6YT90',
        entity: { legalName: { name: 'GENERAL ELECTRIC COMPANY' }, legalAddress: { country: 'US' }, status: 'ACTIVE' },
        registration: { status: 'ISSUED' },
      },
    },
    '2026-10-14',
  )
  assert.ok('profile' in outcome)
  assert.equal(outcome.profile.country, 'United States')

  // A live Grants.gov candidate, post-normalization (sourceCountry is canonical).
  const opportunity = candidateToVerifiedOpportunity(
    candidate({
      sourceId: GRANTS_GOV_SOURCE_ID,
      sourceStatus: 'posted',
      sourceDeadline: FUTURE,
      sourceUrl: OFFICIAL_GRANTS,
      sourceRecordId: '357305',
      sourceCountry: 'United States',
      sourceTitle: 'Open US grant',
    }),
    NOW,
  )

  const result = assembleMatchProposals({ companies: [outcome.profile], opportunities: [opportunity] })
  assert.equal(result.proposals.length, 1)
  assert.equal(result.proposals[0].status, 'PROPOSED')
  assert.deepEqual([...result.proposals[0].matchedSignals], ['country-compatibility'])
})

test('a verified open opportunity and a country-matched company produce a PROPOSED match', () => {
  const entry = candidateToVerifiedOpportunity(
    candidate({
      sourceId: GRANTS_GOV_SOURCE_ID,
      sourceStatus: 'posted',
      sourceDeadline: FUTURE,
      sourceUrl: OFFICIAL_GRANTS,
      sourceRecordId: '350001',
      sourceCountry: 'US',
      sourceTitle: 'Open grant',
    }),
    NOW,
  )
  const company: VerifiedCompanyProfile = {
    companyId: 'LEI-X',
    name: 'X',
    country: 'US',
    provenance: { source: 'https://api.gleif.org/api/v1/lei-records/X', verifiedAt: '2026-10-14', status: 'verified' },
  }
  const result = assembleMatchProposals({ companies: [company], opportunities: [entry] })
  assert.equal(result.proposals.length, 1)
  assert.equal(result.proposals[0].status, 'PROPOSED')
  assert.deepEqual([...result.proposals[0].matchedSignals], ['country-compatibility'])
})
