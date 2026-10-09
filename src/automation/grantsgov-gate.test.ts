/**
 * Phase 20C open-opportunity gate tests (pure, offline).
 *
 * The gate only confirms OPEN when the source data itself says so: posted
 * status, a parseable future close date, an official Grants.gov URL, and
 * provenance. Anything missing or invalid is EXCLUDED with reasons.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { DiscoveryCandidate } from './candidate'
import { GRANTS_GOV_SOURCE_ID } from './registry'
import { GRANTS_GOV_OPPORTUNITY_PREFIX } from './grantsgov-adapter'
import { evaluateOpenOpportunity } from './grantsgov-gate'

const NOW = '2026-10-09T00:00:00.000Z'

function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  const base: DiscoveryCandidate = {
    candidateId: 'c1',
    discoveryRunId: 'RUN-G-0001-Aavo',
    companyId: 'Aavo',
    discoveryProfileId: 'DP-LIVE-003',
    sourceId: GRANTS_GOV_SOURCE_ID,
    sourceRecordId: '1001',
    sourceUrl: `${GRANTS_GOV_OPPORTUNITY_PREFIX}1001`,
    sourceTitle: 'Solar Research Grant',
    sourceSummary: null,
    sourcePublicationDate: '2026-01-01',
    sourceDeadline: '2030-01-01',
    sourceOrganization: 'Department of Energy',
    sourceCountry: 'US',
    sourceRawType: 'grant_opportunity',
    sourceStatus: 'posted',
    domain: 'funding',
    candidateType: 'opportunity',
    candidateStatus: 'REVIEW',
    provenance: {
      runId: 'RUN-G-0001-Aavo',
      companyId: 'Aavo',
      discoveryProfileId: 'DP-LIVE-003',
      sourceId: GRANTS_GOV_SOURCE_ID,
      sourceName: 'Grants.gov — US Federal Grant Opportunities (official, public)',
      sourceUrl: `${GRANTS_GOV_OPPORTUNITY_PREFIX}1001`,
      sourceRecordId: '1001',
      adapterType: 'grantsgov',
      domain: 'funding',
      accessState: 'AVAILABLE',
      queryTerm: null,
      requestedAt: NOW,
      observedAt: NOW,
      stageHistory: ['transform'],
    },
    normalization: null,
    classification: null,
    duplicate: null,
    ...overrides,
  }
  return base
}

test('a posted record with a future close date, official URL, and provenance passes as Open', () => {
  assert.deepEqual(evaluateOpenOpportunity(candidate(), NOW), { open: true, reasons: [] })
})

test('a non-posted status never qualifies as Open', () => {
  for (const status of ['forecasted', 'closed', 'archived', 'unknown', null]) {
    const verdict = evaluateOpenOpportunity(candidate({ sourceStatus: status }), NOW)
    assert.equal(verdict.open, false)
    assert.ok(verdict.reasons.some((reason) => reason.includes('not posted')))
  }
})

test('a missing or past close date is excluded', () => {
  const missing = evaluateOpenOpportunity(candidate({ sourceDeadline: null }), NOW)
  assert.equal(missing.open, false)
  assert.ok(missing.reasons.includes('no close date'))

  const past = evaluateOpenOpportunity(candidate({ sourceDeadline: '2020-01-01' }), NOW)
  assert.equal(past.open, false)
  assert.ok(past.reasons.includes('close date is not in the future'))
})

test('a non-official URL is excluded', () => {
  const verdict = evaluateOpenOpportunity(candidate({ sourceUrl: 'https://example.com/x' }), NOW)
  assert.equal(verdict.open, false)
  assert.ok(verdict.reasons.includes('no official Grants.gov opportunity URL'))
})

test('missing provenance is excluded', () => {
  const verdict = evaluateOpenOpportunity(
    candidate({
      provenance: {
        ...candidate().provenance,
        sourceName: null,
        sourceRecordId: null,
      },
    }),
    NOW,
  )
  assert.equal(verdict.open, false)
  assert.ok(verdict.reasons.includes('missing source name provenance'))
  assert.ok(verdict.reasons.includes('missing source record id provenance'))
})
