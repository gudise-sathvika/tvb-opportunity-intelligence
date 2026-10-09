/**
 * Candidate normalization tests (Phase C brief §7) — NORM-RULES-v1.
 *
 * Behavior under test (fixtures: whitespace title, equivalent URL forms,
 * date forms, missing/unknown values, canonical country aliases):
 *  - whitespace collapsing on titles and free text
 *  - canonical URL derivation (lowercase host, default port, utm_*, fragment)
 *  - dates normalize to YYYY-MM-DD only for documented shapes
 *  - missing values stay missing — nothing is fabricated
 *  - deterministic country alias mapping only
 *  - statuses UNCHANGED / NORMALIZED / WARNING / FAILED
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DiscoveryCandidate } from './candidate'
import { candidateFromRawResult } from './transform'
import { normalizeCandidate, canonicalizeUrl, normalizeDateToIso, normalizeCountry } from './normalize'
import { makeRaw, syntheticAdapterResult, fixtureRequest } from './phase-c-fixtures'
import type { AdapterResult, RawResult } from './types'

function normalize(raw: RawResult): DiscoveryCandidate {
  const request = fixtureRequest({ sourceId: 'SU-FX-002', domain: 'funding' })
  const result: AdapterResult = syntheticAdapterResult({
    request,
    sourceName: 'Fixture Grants Portal (test)',
    adapterType: 'fixture',
    results: [raw],
  })
  const candidate = candidateFromRawResult(result, raw)
  return normalizeCandidate(candidate)
}

test('a title with interior whitespace is collapsed (formatting only)', () => {
  const candidate = normalize(
    makeRaw({
      sourceUrl: 'https://fixture.invalid/grants/a',
      title: '  Fixture   Climate   Innovation Grant  ',
      sourceRecordId: 'FX-F-9001',
    }),
  )
  assert.equal(candidate.sourceTitle, 'Fixture Climate Innovation Grant')
  assert.equal(candidate.candidateStatus, 'NORMALIZED')
  assert.equal(candidate.normalization?.status, 'NORMALIZED')
  assert.ok(candidate.normalization?.changedFields.includes('title'))
  assert.equal(candidate.normalization?.title.original, '  Fixture   Climate   Innovation Grant  ')
  assert.ok(!candidate.normalization?.changedFields.includes('sourceUrl'), 'URL did not change')
})

test('already-clean values leave the candidate UNCHANGED', () => {
  const candidate = normalize(
    makeRaw({
      sourceUrl: 'https://fixture.invalid/grants/b',
      title: 'Fixture Clean Grant',
      publicationDate: '2026-08-15',
      deadline: '2027-01-31',
      issuingOrganization: 'Fixture Clean Org',
      country: 'Wonderland',
      rawType: 'grant',
      sourceRecordId: 'FX-F-9002',
    }),
  )
  assert.equal(candidate.normalization?.status, 'UNCHANGED')
  assert.deepEqual(candidate.normalization?.changedFields, [])
  assert.deepEqual(candidate.normalization?.warnings, [])
  assert.equal(candidate.candidateStatus, 'NORMALIZED')
})

test('equal URLs in different shapes canonicalize to the same key', () => {
  const a = canonicalizeUrl('https://Fixture.INVALID:443/grants/FX-F-2001?utm_source=x&q=1#top')
  const b = canonicalizeUrl('HTTPS://fixture.invalid/grants/FX-F-2001?q=1')
  const c = canonicalizeUrl('https://fixture.invalid/grants/FX-F-2001?q=1')

  assert.equal(a.canonical, 'https://fixture.invalid/grants/FX-F-2001?q=1')
  assert.equal(a.warning, null)
  assert.equal(b.canonical, c.canonical)
  assert.equal(b.canonical, 'https://fixture.invalid/grants/FX-F-2001?q=1')
})

test('an unparseable URL is preserved on the candidate with a warning', () => {
  const outcome = canonicalizeUrl('not an absolute url')
  assert.equal(outcome.canonical, null)
  assert.match(outcome.warning ?? '', /not a valid absolute URL/i)
})

test('documented date shapes normalize to YYYY-MM-DD', () => {
  assert.deepEqual(normalizeDateToIso('2026-08-15'), { normalized: '2026-08-15', warning: null })
  assert.deepEqual(normalizeDateToIso('15/08/2026'), { normalized: '2026-08-15', warning: null })
  assert.deepEqual(normalizeDateToIso('20260815'), { normalized: '2026-08-15', warning: null })
})

test('an unrecognized date is preserved verbatim and flagged with a warning', () => {
  const outcome = normalizeDateToIso('Next Spring')
  assert.equal(outcome.normalized, 'Next Spring')
  assert.match(outcome.warning ?? '', /could not be parsed/)

  const candidate = normalize(
    makeRaw({
      sourceUrl: 'https://fixture.invalid/grants/c',
      title: 'Fixture Odd Date Grant',
      deadline: 'Next Spring',
      sourceRecordId: 'FX-F-9003',
    }),
  )
  assert.equal(candidate.sourceDeadline, 'Next Spring', 'the unparseable date is preserved')
  assert.equal(candidate.normalization?.status, 'WARNING')
  assert.equal(candidate.candidateStatus, 'NORMALIZED')
  assert.ok(!candidate.normalization?.changedFields.includes('deadline'))
})

test('an empty URL produces a warning but does not block the candidate', () => {
  const candidate = normalize(
    makeRaw({
      sourceUrl: '',
      title: 'Fixture No Url Grant',
      sourceRecordId: 'FX-F-9004',
    }),
  )
  assert.equal(candidate.normalization?.status, 'WARNING')
  assert.equal(candidate.candidateStatus, 'NORMALIZED')
  assert.equal(candidate.normalization?.canonicalUrl, null)
})

test('missing values stay missing — nothing is fabricated', () => {
  const candidate = normalize(
    makeRaw({
      sourceUrl: 'https://fixture.invalid/grants/d',
      title: 'Fixture Sparse Grant',
      description: null,
      publicationDate: null,
      deadline: null,
      issuingOrganization: null,
      country: null,
      rawType: null,
      sourceRecordId: 'FX-F-9005',
    }),
  )
  assert.equal(candidate.sourceSummary, null)
  assert.equal(candidate.sourcePublicationDate, null)
  assert.equal(candidate.sourceDeadline, null)
  assert.equal(candidate.sourceOrganization, null)
  assert.equal(candidate.sourceCountry, null)
  assert.equal(candidate.sourceRawType, null)
  assert.equal(candidate.normalization?.status, 'UNCHANGED')
})

test('country aliases map deterministically; unknown values are preserved', () => {
  assert.equal(normalizeCountry('USA'), 'United States')
  assert.equal(normalizeCountry('u.s.a.'), 'United States')
  assert.equal(normalizeCountry('UK'), 'United Kingdom')
  assert.equal(normalizeCountry('UAE'), 'United Arab Emirates')
  assert.equal(normalizeCountry('Wonderland'), 'Wonderland')
})

test('a whitespace-only title fails normalization and the candidate is BLOCKED', () => {
  const candidate = normalize(
    makeRaw({
      sourceUrl: 'https://fixture.invalid/grants/e',
      title: '   ',
      sourceRecordId: 'FX-F-9006',
    }),
  )
  assert.equal(candidate.normalization?.status, 'FAILED')
  assert.equal(candidate.candidateStatus, 'BLOCKED')
})

test('a document date shape rewrites the candidate date to ISO', () => {
  const candidate = normalize(
    makeRaw({
      sourceUrl: 'https://fixture.invalid/grants/f',
      title: 'Fixture DMY Grant',
      publicationDate: '31/01/2026',
      deadline: '01/03/2026',
      sourceRecordId: 'FX-F-9007',
    }),
  )
  assert.equal(candidate.sourcePublicationDate, '2026-01-31')
  assert.equal(candidate.sourceDeadline, '2026-03-01')
  assert.ok(candidate.normalization?.changedFields.includes('publicationDate'))
  assert.ok(candidate.normalization?.changedFields.includes('deadline'))
})

test('normalization is idempotent and never rewrites an existing result', () => {
  const candidate = normalize(
    makeRaw({
      sourceUrl: 'https://fixture.invalid/grants/g',
      title: '  Fixture   Idempotency Grant  ',
      sourceRecordId: 'FX-F-9008',
    }),
  )
  const again = normalizeCandidate(candidate)
  assert.equal(again, candidate)
  assert.equal(again.normalization?.status, 'NORMALIZED')
})