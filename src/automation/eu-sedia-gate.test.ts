/**
 * Phase 21C EU open-call gate — offline unit tests.
 *
 * A record is confirmed open ONLY when the source status is open for
 * submission, the deadline is present and in the future, the link is an
 * official EU URL, and provenance is present. Every other case is excluded with
 * a reason, and missing data never qualifies.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { DiscoveryCandidate } from './candidate'
import { EU_SEDIA_SOURCE_ID } from './registry'
import { evaluateEuOpenOpportunity } from './eu-sedia-gate'

const NOW = '2026-10-09T00:00:00.000Z'
const OFFICIAL_URL =
  'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/HORIZON-1'

function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    candidateId: 'DC:SU-EU-001:HORIZON-1',
    discoveryRunId: 'RUN-EU-1-Aavo',
    companyId: 'Aavo',
    discoveryProfileId: 'DP-LIVE-004',
    sourceId: EU_SEDIA_SOURCE_ID,
    sourceRecordId: 'HORIZON-1',
    sourceUrl: OFFICIAL_URL,
    sourceTitle: 'AI grant topic',
    sourceSummary: null,
    sourcePublicationDate: '2026-01-05',
    sourceDeadline: '2026-12-01',
    sourceOrganization: null,
    sourceCountry: 'EU',
    sourceRawType: 'GRANT_TOPIC',
    sourceStatus: 'open',
    domain: 'funding',
    candidateType: 'opportunity',
    candidateStatus: 'NORMALIZED',
    provenance: {
      runId: 'RUN-EU-1-Aavo',
      companyId: 'Aavo',
      discoveryProfileId: 'DP-LIVE-004',
      sourceId: EU_SEDIA_SOURCE_ID,
      sourceName: 'EU Funding & Tenders Portal',
      sourceUrl: OFFICIAL_URL,
      sourceRecordId: 'HORIZON-1',
      adapterType: 'eu-sedia',
      domain: 'funding',
      accessState: 'AVAILABLE',
      queryTerm: null,
      requestedAt: NOW,
      observedAt: NOW,
      stageHistory: [],
    },
    normalization: null,
    classification: null,
    duplicate: null,
    ...overrides,
  } as DiscoveryCandidate
}

test('an open record with a future deadline, official URL, and provenance passes the gate', () => {
  const verdict = evaluateEuOpenOpportunity(candidate(), NOW)
  assert.equal(verdict.open, true)
  assert.deepEqual(verdict.reasons, [])
})

test('forthcoming, closed, and unknown statuses are excluded', () => {
  for (const status of ['forthcoming', 'closed', 'unknown', null]) {
    const verdict = evaluateEuOpenOpportunity(candidate({ sourceStatus: status }), NOW)
    assert.equal(verdict.open, false)
    assert.equal(verdict.reasons.some((r) => r.includes('not open')), true)
  }
})

test('a missing or past deadline is excluded', () => {
  assert.equal(evaluateEuOpenOpportunity(candidate({ sourceDeadline: null }), NOW).open, false)
  assert.equal(evaluateEuOpenOpportunity(candidate({ sourceDeadline: '2026-01-01' }), NOW).open, false)
  assert.equal(evaluateEuOpenOpportunity(candidate({ sourceDeadline: 'not-a-date' }), NOW).open, false)
})

test('a non-official URL is excluded', () => {
  const verdict = evaluateEuOpenOpportunity(candidate({ sourceUrl: 'https://example.com/x' }), NOW)
  assert.equal(verdict.open, false)
  assert.equal(verdict.reasons.some((r) => r.includes('official EU')), true)
})

test('a non-EU source record is excluded', () => {
  const verdict = evaluateEuOpenOpportunity(candidate({ sourceId: 'SU-GRANTS-001' }), NOW)
  assert.equal(verdict.open, false)
})
