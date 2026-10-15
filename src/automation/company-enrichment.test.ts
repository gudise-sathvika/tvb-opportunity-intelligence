/**
 * Phase 08 company enrichment tests — fully offline, synthetic SEC-shaped data.
 *
 * Honesty rules under test: only evidenced attributes are recorded, absent
 * fields stay unknown with reasons, verified identity is never rewritten, and
 * weak name matches never resolve.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyEnrichment,
  findSecTickerCandidate,
  mapSecSubmissions,
  significantNameTokens,
} from './company-enrichment'
import type { VerifiedCompanyProfile } from './company-profile'

const RETRIEVED_AT = '2026-10-14T00:00:00.000Z'

const TICKERS = {
  0: { cik_str: 40545, ticker: 'GE', title: 'GENERAL ELECTRIC CO' },
  1: { cik_str: 784977, ticker: 'POR', title: 'PORTLAND GENERAL ELECTRIC CO /OR/' },
}

const SUBMISSIONS = {
  cik: '0000040545',
  name: 'GENERAL ELECTRIC CO',
  sic: '3600',
  sicDescription: 'Electronic & Other Electrical Equipment (No Computer Equip)',
  website: '',
  addresses: {
    business: { city: 'EVENDALE', stateOrCountryDescription: 'OH' },
  },
}

function profile(): VerifiedCompanyProfile {
  return {
    companyId: 'LEI-3C7474T6CDKPR9K6YT90',
    name: 'GENERAL ELECTRIC COMPANY',
    country: 'United States',
    provenance: { source: 'https://api.gleif.org/api/v1/lei-records/3C7474T6CDKPR9K6YT90', verifiedAt: '2026-10-14', status: 'verified' },
  }
}

test('legal names fold suffixes before comparison', () => {
  assert.deepEqual(significantNameTokens('GENERAL ELECTRIC COMPANY'), ['GENERAL', 'ELECTRIC'])
  assert.deepEqual(significantNameTokens('General Electric Co.'), ['GENERAL', 'ELECTRIC'])
  assert.deepEqual(significantNameTokens('  '), [])
})

test('ticker matching resolves exact cores and rejects weak similarities', () => {
  const hit = findSecTickerCandidate(TICKERS, 'GENERAL ELECTRIC COMPANY')
  assert.ok(hit !== null && hit.cik === 'CIK0000040545' && hit.ticker === 'GE')
  assert.equal(findSecTickerCandidate(TICKERS, 'Unrelated Widgets Inc'), null)
  assert.equal(findSecTickerCandidate(TICKERS, 'Electric'), null)
  assert.equal(findSecTickerCandidate(TICKERS, ''), null)
  assert.equal(findSecTickerCandidate(null, 'GENERAL ELECTRIC COMPANY'), null)
})

test('a longer related name never inherits another entity filings', () => {
  // Live-caught regression: "General Electric Canada" matched the US filer
  // under a subset rule and received its industry. Equality only.
  assert.equal(findSecTickerCandidate(TICKERS, 'General Electric Canada'), null)
  // EDGAR's '/OR/' state tag is not stripped, so even the true Portland name
  // stays unmatched rather than risk a wrong filer: unknown, never guessed.
  assert.equal(findSecTickerCandidate(TICKERS, 'Portland General Electric Company'), null)
})

test('submissions mapping records evidenced attributes and honest gaps', () => {
  const enrichment = mapSecSubmissions(SUBMISSIONS, 'CIK0000040545', RETRIEVED_AT)
  assert.equal(enrichment.status, 'enriched')
  assert.deepEqual(enrichment.industry, ['Electronic & Other Electrical Equipment (No Computer Equip) (SIC 3600)'])
  assert.equal(enrichment.website, null)
  assert.deepEqual(enrichment.locations, ['EVENDALE, OH'])
  assert.equal(enrichment.organizationType, null)
  assert.equal(enrichment.capabilities, null)
  assert.equal(enrichment.checkedAt, RETRIEVED_AT)
  assert.ok(enrichment.evidence.every((item) => item.sourceName.includes('SEC EDGAR') && item.retrievedAt === RETRIEVED_AT))
  assert.ok(enrichment.notes.some((note) => note.includes('no website')))
  assert.ok(enrichment.notes.some((note) => note.includes('capabilit')))
})

test('a non-object submissions document fails without erasing anything', () => {
  const enrichment = mapSecSubmissions(null, 'CIK0000040545', RETRIEVED_AT)
  assert.equal(enrichment.status, 'failed')
  assert.equal(enrichment.industry, null)
})

test('applyEnrichment fills absent fields only and keeps verified provenance', () => {
  const enrichment = mapSecSubmissions(SUBMISSIONS, 'CIK0000040545', RETRIEVED_AT)
  const { profile: next, enrichment: kept } = applyEnrichment(profile(), enrichment)
  assert.deepEqual(next.industry, enrichment.industry)
  assert.equal(next.companyId, 'LEI-3C7474T6CDKPR9K6YT90')
  assert.equal(next.country, 'United States')
  assert.equal(next.provenance.source, 'https://api.gleif.org/api/v1/lei-records/3C7474T6CDKPR9K6YT90')
  assert.equal(kept, enrichment)

  const already = { ...profile(), industry: ['Verified industry'] as readonly string[] }
  assert.deepEqual(applyEnrichment(already, enrichment).profile.industry, ['Verified industry'])
})
