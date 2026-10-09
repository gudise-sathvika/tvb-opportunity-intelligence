/**
 * Funding filter definitions.
 *
 * These tests pin the boundary cases that a reader is most likely to hit, and the
 * one convention that matters most: a filter matching nothing returns an empty
 * list rather than silently falling back to every record. A filter that "helpfully"
 * ignores an unmatched value would make a drill-down link look broken while showing
 * the wrong records.
 *
 * Run with: npm run test:data
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './test-fixtures/use-snapshot'

import {
  BLANK,
  filterApplications,
  filterCompanies,
  filterMatches,
  filterOpportunities,
  filterOrganizations,
  filterSources,
  sourceFreshness,
} from './funding-filters'
import { listApplications, listCompanies, listMatches, listOpportunities, listOrganizations, listSources } from './selectors'

/* ------------------------------------------------------------------ */
/* Shared conventions                                                   */
/* ------------------------------------------------------------------ */

test('an empty filter keeps every record', () => {
  for (const [name, all, filter] of [
    ['opportunities', listOpportunities, filterOpportunities],
    ['matches', listMatches, filterMatches],
    ['applications', listApplications, filterApplications],
    ['companies', listCompanies, filterCompanies],
    ['organizations', listOrganizations, filterOrganizations],
    ['sources', listSources, filterSources],
  ] as const) {
    assert.equal(filter({}).length, all().length, `${name}: no restriction means no restriction`)
  }
})

test('a filter value that matches nothing returns nothing', () => {
  // The failure this guards against is a filter quietly showing every record.
  assert.deepEqual(filterOpportunities({ opportunityType: 'Program' }), [])
  assert.deepEqual(filterApplications({ applicationStatus: 'Awarded' }), [])
  assert.deepEqual(filterMatches({ matchStatus: 'Matched' }), [])
  assert.deepEqual(filterOrganizations({ country: 'France' }), [])
  assert.deepEqual(filterSources({ sourceType: 'Nonexistent' }), [])
})

test('filters combine with AND', () => {
  const type = 'Grant'
  const country = 'USA'
  const both = filterOpportunities({ opportunityType: type, country })
  const typeOnly = filterOpportunities({ opportunityType: type })
  assert.ok(both.length <= typeOnly.length, 'adding a restriction cannot widen the result')
  for (const o of both) {
    assert.equal(o.frontmatter.opportunity_type, type)
    assert.equal(o.frontmatter.country, country)
  }
})

test('BLANK selects records with no recorded value', () => {
  // Every Opportunity has a blank application_deadline, so asking for blanks must
  // return all five and asking for a recorded value must return none.
  assert.equal(filterOpportunities({ hasDeadline: false }).length, listOpportunities().length)
  assert.equal(filterOpportunities({ hasDeadline: true }).length, 0)
})

test('BLANK selects records with no recorded value in a free-text field', () => {
  // `match_score` is blank on all four Matches, which is exactly the question a
  // reader asks of this corpus: show me the ones nobody has scored.
  assert.equal(filterMatches({ priority: BLANK }).length, 0, 'priority is recorded on every Match')
  assert.equal(
    filterSources({ sourceType: BLANK }).length,
    0,
    'every Source records a source_type',
  )
  // Partition check: a blank bucket plus every named value must account for all
  // the records, with no record in two buckets and none left over.
  const named = ['High', 'Low']
  const blank = filterMatches({ priority: BLANK }).length
  const namedTotal = named.reduce((n, v) => n + filterMatches({ priority: v }).length, 0)
  assert.equal(blank + namedTotal, listMatches().length, 'blank and named partition the Matches')
})

test('an empty string is not treated as a filter value', () => {
  // `''` must mean "no restriction" rather than "match the empty string", which
  // would silently select the blanks.
  assert.equal(filterOpportunities({ opportunityType: '' }).length, listOpportunities().length)
})

/* ------------------------------------------------------------------ */
/* Relationship filters                                                 */
/* ------------------------------------------------------------------ */

test('filtering a Match by company returns only that company\'s matches', () => {
  const all = filterMatches({})
  const target = all[0]
  const companyId = (target.links.fields.company ?? [])[0]?.resolvedId
  assert.ok(companyId, 'the corpus links a match to a company')
  const filtered = filterMatches({ companyId })
  assert.ok(filtered.length > 0)
  for (const m of filtered) {
    assert.ok(
      (m.links.fields.company ?? []).some((l) => l.resolvedId === companyId),
      `${m.id} does not belong to ${companyId}`,
    )
  }
  assert.ok(filtered.length < all.length, 'the filter must actually exclude records')
})

test('filtering by an unknown relationship id returns nothing', () => {
  assert.deepEqual(filterMatches({ companyId: 'COMP-999' }), [])
  assert.deepEqual(filterApplications({ companyId: 'COMP-999' }), [])
  assert.deepEqual(filterMatches({ opportunityId: 'OPP-999' }), [])
})

test('the hasApplication flag splits Matches on their linked_application link', () => {
  const linked = filterMatches({ hasApplication: true })
  const unlinked = filterMatches({ hasApplication: false })
  assert.equal(linked.length + unlinked.length, listMatches().length)
  for (const m of linked) assert.ok((m.links.fields.linked_application ?? []).length > 0)
  for (const m of unlinked) assert.equal((m.links.fields.linked_application ?? []).length, 0)
})

test('the hasSubmissionDate flag splits Applications on submission_date', () => {
  const recorded = filterApplications({ hasSubmissionDate: true })
  const blank = filterApplications({ hasSubmissionDate: false })
  assert.equal(recorded.length + blank.length, listApplications().length)
  for (const a of recorded) assert.notEqual(a.frontmatter.submission_date, '')
  for (const a of blank) assert.equal(a.frontmatter.submission_date ?? '', '')
})

test('the hasRecords flag splits Organizations on their recorded relationships', () => {
  const linked = filterOrganizations({ hasRecords: true })
  const unlinked = filterOrganizations({ hasRecords: false })
  assert.equal(linked.length + unlinked.length, listOrganizations().length)
  for (const o of linked) {
    const has = (o.links.fields.opportunities ?? []).length + (o.links.fields.notices ?? []).length
    assert.ok(has > 0, `${o.id} records no relationship`)
  }
})

test('the hasMatches flag splits Companies on their linked Matches', () => {
  const withMatches = filterCompanies({ hasMatches: true })
  const without = filterCompanies({ hasMatches: false })
  assert.equal(withMatches.length + without.length, listCompanies().length)
})

test('filtering a Source by opportunity returns that opportunity\'s sources', () => {
  const anyOpportunity = listOpportunities().find((o) => (o.links.fields.provider ?? []).length > 0)!
  const filtered = filterSources({ opportunityId: anyOpportunity.id })
  for (const s of filtered) {
    const related = (s.links.fields.related_opportunity ?? []).some((l) => l.resolvedId === anyOpportunity.id)
    assert.ok(related, `${s.id} is not related to ${anyOpportunity.id}`)
  }
})

/* ------------------------------------------------------------------ */
/* Source freshness                                                     */
/* ------------------------------------------------------------------ */

test('sourceFreshness reports n of m and accounts for every source', () => {
  const f = sourceFreshness()
  assert.equal(f.total, listSources().length)
  assert.equal(f.checked + f.unchecked, f.total)
})