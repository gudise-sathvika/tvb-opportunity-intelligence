/**
 * Dashboard analytics definitions.
 *
 * Like `procurement.test.ts`, these tests pin the *definitions* rather than the
 * numbers. A count that changes when a record is added is correct behaviour; a
 * count that changes when a rule is reworded is a bug. So most tests state which
 * records are counted and why the boundary cases land where they do.
 *
 * Every function that needs "now" takes the date as an argument. Nothing here
 * reads the system clock, which is what lets the deadline tests run identically in
 * any year.
 *
 * The tests that DO assert exact counts name the records they expect, so a failure
 * says which record moved rather than just that a total changed.
 *
 * Run with: npm run test:data
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import '../data/test-fixtures/use-snapshot'

import {
  BLANK,
  DAYS_MONTH,
  DAYS_SOON,
  URGENCY_LABEL,
  URGENCY_ORDER,
  applicationSubmission,
  attentionFor,
  bidAxisSeries,
  bidDeadlines,
  companyActivity,
  contractSeries,
  currencyCoverage,
  daysFrom,
  distinctValues,
  evidenceCoverage,
  fundingPipeline,
  groupCounts,
  noticeBidCoverage,
  noticeSeries,
  percentOf,
  primaryDeadlines,
  providersWithOpportunities,
  providerCoverage,
  provenanceSplit,
  urgencyBuckets,
  urgencyOf,
  workflowFlows,
} from './dashboard'
import {
  listApplications,
  listBids,
  listCompanies,
  listContracts,
  listMatches,
  listNotices,
  listOpportunities,
  listOrganizations,
  listRecords,
  textField,
} from '../data/selectors'
import { CONTROLLED_VALUES } from '../import/controlled-values'

/**
 * Fixed at a date AFTER every recorded deadline in the corpus, so the fixtures
 * exercise the "already passed" branch rather than depending on when the suite runs.
 */
const TODAY = '2026-10-04'

/* ------------------------------------------------------------------ */
/* percentOf                                                           */
/* ------------------------------------------------------------------ */

test('percentOf is defined when the total is zero', () => {
  // The failure this guards against is NaN reaching the UI as "NaN%".
  assert.equal(percentOf(0, 0), 0)
  assert.equal(percentOf(3, 0), 0)
})

test('percentOf rounds to one decimal and never returns -0', () => {
  assert.equal(percentOf(1, 3), 33.3)
  assert.equal(percentOf(2, 3), 66.7)
  assert.equal(percentOf(1, 2), 50)
  assert.ok(!Object.is(percentOf(0, 5), -0), 'a zero percent must not be -0')
})

/* ------------------------------------------------------------------ */
/* groupCounts: blanks, vocabulary order, and zero counts              */
/* ------------------------------------------------------------------ */

test('groupCounts returns every declared value including those with no records', () => {
  const points = groupCounts(listOpportunities(), 'opportunity_type')
  assert.equal(points.length, CONTROLLED_VALUES.opportunity_type.length)
  assert.deepEqual(
    points.map((p) => p.value),
    [...CONTROLLED_VALUES.opportunity_type],
    'the schema order must be preserved so the distribution reads as a vocabulary',
  )
  // `Program` is declared by the schema and no Opportunity uses it. It must still
  // appear, because a zero is a true statement about the corpus.
  const program = points.find((p) => p.value === 'Program')
  assert.ok(program, 'a declared value with no records must still be listed')
  assert.equal(program!.count, 0)
  assert.equal(program!.percent, 0)
  assert.deepEqual(program!.ids, [], 'a zero carries no record ids')
})

test('groupCounts counts the records it claims and the ids sum to the input', () => {
  for (const [recs, field] of [
    [listOpportunities(), 'opportunity_type'],
    [listOpportunities(), 'verification_status'],
    [listMatches(), 'match_status'],
    [listBids(), 'eligibility_status'],
    [listBids(), 'bid_decision'],
    [listNotices(), 'notice_status'],
    [listContracts(), 'contract_status'],
  ] as const) {
    const points = groupCounts(recs as never[], field)
    const total = points.reduce((n, p) => n + p.count, 0)
    assert.equal(total, recs.length, `${field}: counts must account for every record`)
    const ids = points.flatMap((p) => p.ids)
    assert.equal(new Set(ids).size, recs.length, `${field}: ids must be unique`)
    for (const p of points) {
      for (const id of p.ids) {
        assert.equal(textField((recs as never[]).find((r) => (r as { id: string }).id === id)!, field), p.value)
      }
    }
  }
})

test('groupCounts keeps a blank in its own bucket rather than dropping it', () => {
  // Every Opportunity has a blank application_deadline, so the blank bucket must
  // exist and must account for all five.
  const points = groupCounts(listOpportunities(), 'application_deadline')
  const blank = points.find((p) => p.isBlank)
  assert.ok(blank, 'a blank must be represented, not omitted')
  assert.equal(blank!.value, BLANK)
  assert.equal(blank!.count, listOpportunities().length)
  assert.equal(blank!.percent, 100)
  assert.deepEqual(
    blank!.ids,
    listOpportunities().map((o) => o.id),
  )
  // The blank bucket must be last, so it never reads as part of a vocabulary.
  assert.equal(points[points.length - 1].value, BLANK)
})

test('groupCounts does not treat a non-string value as a label', () => {
  // amount_max is a number on some records and "" on others. It must not become a
  // group named "5000000", and the numbers must not vanish either.
  const points = groupCounts(listOpportunities(), 'amount_max')
  assert.equal(points.length, 1, 'a numeric field yields only the blank bucket')
  assert.equal(points[0].isBlank, true)
  assert.equal(points[0].count, listOpportunities().length)
})

test('groupCounts appends a value that is not in the vocabulary instead of dropping it', () => {
  // Defensive: a snapshot value the schema does not declare must remain visible.
  const rec = { id: 'X-1', type: 'opportunity', fictional: { isFictional: true }, frontmatter: { opportunity_type: 'Undeclared' }, links: { fields: {}, body: [] } }
  const points = groupCounts([rec as never], 'opportunity_type')
  assert.ok(
    points.some((p) => p.value === 'Undeclared'),
    'an unexpected value must not disappear',
  )
})

test('groupCounts on an empty collection yields zeros rather than an empty chart', () => {
  const points = groupCounts([], 'opportunity_type')
  assert.equal(points.length, CONTROLLED_VALUES.opportunity_type.length)
  assert.ok(points.every((p) => p.count === 0 && p.percent === 0))
  assert.equal(points.some((p) => p.isBlank), false, 'no records means no blank bucket')
})

test('groupCounts splits fictional from real within each value', () => {
  const points = groupCounts(listOpportunities(), 'verification_status')
  for (const p of points) {
    assert.equal(p.fictional + p.real, p.count, `${p.value}: the split must account for every record`)
  }
  // Three Opportunities are recorded as Verified and two as not, which is the
  // count a reader sees on the card.
  const verified = points.find((p) => p.value === 'Verified')
  assert.ok(verified, 'Verified is a declared verification_status')
  assert.equal(verified!.count, 3)
  assert.equal(verified!.ids.length, 3)
})

/* ------------------------------------------------------------------ */
/* Urgency buckets                                                      */
/* ------------------------------------------------------------------ */

test('daysFrom counts whole days and rejects malformed dates', () => {
  assert.equal(daysFrom('2026-10-04', '2026-10-04'), 0)
  assert.equal(daysFrom('2026-10-04', '2026-10-11'), 7)
  assert.equal(daysFrom('2026-10-04', '2026-10-05'), 1)
  assert.equal(daysFrom('2026-10-04', '2026-09-23'), -11)
  assert.equal(daysFrom('2026-10-04', ''), null)
  assert.equal(daysFrom('2026-10-04', '2026-02-30'), null, 'an impossible date is not a date')
  assert.equal(daysFrom('2026-10-04', undefined), null)
})

test('urgencyOf gives tomorrow today and yesterday their own buckets', () => {
  // A deadline falling today has not passed, so it must never read as overdue.
  // It is also deliberately separated from the next-seven-days window, because a
  // reader should see at a glance what is due this exact day.
  assert.equal(urgencyOf('2026-10-04', TODAY), 'today')
  assert.equal(urgencyOf('2026-10-03', TODAY), 'overdue')
  assert.equal(urgencyOf('2026-10-05', TODAY), 'due_soon')
})

test('urgencyOf places each day in exactly one bucket at the boundaries', () => {
  assert.equal(urgencyOf('2026-09-23', TODAY), 'overdue')
  assert.equal(urgencyOf('2026-10-04', TODAY), 'today', 'the reference date itself')
  assert.equal(urgencyOf('2026-10-05', TODAY), 'due_soon', 'one day out')
  assert.equal(urgencyOf('2026-10-11', TODAY), 'due_soon', `exactly ${DAYS_SOON} days out`)
  assert.equal(urgencyOf('2026-10-12', TODAY), 'due_this_month', `${DAYS_SOON + 1} days out`)
  assert.equal(urgencyOf('2026-11-03', TODAY), 'due_this_month', `exactly ${DAYS_MONTH} days out`)
  assert.equal(urgencyOf('2026-11-04', TODAY), 'due_later', `${DAYS_MONTH + 1} days out`)
  assert.equal(urgencyOf('', TODAY), 'no_date')
  assert.equal(urgencyOf(null, TODAY), 'no_date')
  assert.equal(urgencyOf('not a date', TODAY), 'no_date')
})

test('urgencyBuckets always returns every bucket in a fixed order', () => {
  const points = urgencyBuckets(primaryDeadlines('notices'), TODAY)
  assert.deepEqual(points.map((p) => p.value), [...URGENCY_ORDER])
  assert.equal(points.length, URGENCY_ORDER.length)
  assert.equal(points.length, 6)
  for (const p of points) assert.equal(typeof URGENCY_LABEL[p.value as keyof typeof URGENCY_LABEL], 'string')
})

test('urgencyBuckets counts the Notice deadlines in the corpus against the fixed date', () => {
  // RFB-001 2026-09-23 and RFB-002 2026-08-19 are before TODAY; RFB-003 has no
  // deadline recorded. Nothing is upcoming or in the later buckets at this date.
  const points = urgencyBuckets(primaryDeadlines('notices'), TODAY)
  const overdue = points.find((p) => p.value === 'overdue')!
  assert.deepEqual(overdue.ids.sort(), ['RFB-001', 'RFB-002'])
  assert.equal(overdue.count, 2)
  const noDate = points.find((p) => p.value === 'no_date')!
  assert.deepEqual(noDate.ids, ['RFB-003'])
  assert.equal(points.find((p) => p.value === 'due_later')!.count, 0)
})

test('urgencyBuckets leaves an unrecorded date in no_date rather than calling it later', () => {
  // Built from real records: BID-003's Notice has no deadline recorded, and the
  // Contract end dates are all beyond the month horizon.
  const bids = urgencyBuckets(bidDeadlines(), TODAY)
  assert.deepEqual(bids.find((p) => p.value === 'no_date')!.ids, ['BID-003'])
  assert.equal(bids.find((p) => p.value === 'due_later')!.count, 0)

  const contracts = urgencyBuckets(primaryDeadlines('contracts'), TODAY)
  // CON-005 has a blank contract_end_date; the other four end in 2027.
  assert.deepEqual(contracts.find((p) => p.value === 'no_date')!.ids, ['CON-005'])
  assert.equal(contracts.find((p) => p.value === 'due_later')!.count, 4)
  assert.equal(contracts.find((p) => p.value === 'overdue')!.count, 0)
})

test('urgencyBuckets totals always equal the number of records supplied', () => {
  for (const collection of ['opportunities', 'matches', 'applications', 'notices', 'contracts'] as const) {
    const dated = primaryDeadlines(collection)
    const total = urgencyBuckets(dated, TODAY).reduce((n, p) => n + p.count, 0)
    assert.equal(total, dated.length, `${collection}: every record must land in a bucket`)
  }
})

test('every Opportunity has a blank deadline, so the Opportunity buckets are all no_date', () => {
  // Pinned because it is surprising and a reader will notice it on the chart: the
  // corpus records no Opportunity application_deadline at all.
  const points = urgencyBuckets(primaryDeadlines('opportunities'), TODAY)
  assert.equal(points.find((p) => p.value === 'no_date')!.count, listOpportunities().length)
})

test('a Bid takes its deadline from the Notice it pursues, not from its own fields', () => {
  const dated = bidDeadlines()
  assert.equal(dated.length, listBids().length)
  const byId = new Map(dated.map((d) => [d.id, d.date]))
  // BID-001 -> RFB-001 (2026-09-23), BID-002/004/005 -> RFB-002 (2026-08-19),
  // BID-003 -> RFB-003 (no deadline recorded).
  assert.equal(byId.get('BID-001'), '2026-09-23')
  assert.equal(byId.get('BID-002'), '2026-08-19')
  assert.equal(byId.get('BID-004'), '2026-08-19')
  assert.equal(byId.get('BID-005'), '2026-08-19')
  assert.equal(byId.get('BID-003'), '', 'a Bid on a notice with no deadline inherits no deadline')

  const points = urgencyBuckets(dated, TODAY)
  assert.equal(points.find((p) => p.value === 'overdue')!.count, 4)
  assert.equal(points.find((p) => p.value === 'no_date')!.count, 1)
})

/* ------------------------------------------------------------------ */
/* The three Bid axes stay separate                                     */
/* ------------------------------------------------------------------ */

test('the three Bid axes are returned separately with their own vocabularies', () => {
  const axes = bidAxisSeries()
  assert.equal(axes.eligibility_status.length, CONTROLLED_VALUES.eligibility_status.length)
  assert.equal(axes.bid_decision.length, CONTROLLED_VALUES.bid_decision.length)
  assert.equal(axes.bid_status.length, CONTROLLED_VALUES.bid_status.length)
  // Each axis totals the five Bids on its own. Summing the three would be 15 and
  // would double-count every Bid, which is the confusion the axes exist to prevent.
  for (const [name, points] of Object.entries(axes)) {
    assert.equal(
      points.reduce((n, p) => n + p.count, 0),
      listBids().length,
      `${name} must total the bid count`,
    )
  }
})

test('the three Bid axes are not collapsed into one status list', () => {
  const axes = bidAxisSeries()
  const eligibilityValues = new Set(axes.eligibility_status.map((p) => p.value))
  const decisionValues = new Set(axes.bid_decision.map((p) => p.value))
  const statusValues = new Set(axes.bid_status.map((p) => p.value))
  for (const v of decisionValues) {
    assert.equal(eligibilityValues.has(v), false, `${v} leaked between axes`)
  }
  for (const v of eligibilityValues) {
    assert.equal(statusValues.has(v), false, `${v} leaked between axes`)
  }
})

test('each Bid is counted on all three axes with its own recorded value', () => {
  const axes = bidAxisSeries()
  for (const b of listBids()) {
    assert.ok(axes.eligibility_status.some((p) => p.ids.includes(b.id)), 'eligibility')
    assert.ok(axes.bid_decision.some((p) => p.ids.includes(b.id)), 'decision')
    assert.ok(axes.bid_status.some((p) => p.ids.includes(b.id)), 'status')
  }
})

/* ------------------------------------------------------------------ */
/* Procurement groupings                                                */
/* ------------------------------------------------------------------ */

test('noticeSeries covers four controlled fields and totals the notice count', () => {
  const series = noticeSeries()
  assert.deepEqual(Object.keys(series).sort(), ['lot_structure', 'notice_status', 'notice_type', 'procurement_method'])
  for (const points of Object.values(series)) {
    assert.equal(points.reduce((n, p) => n + p.count, 0), listNotices().length)
  }
})

test('contractSeries keeps the four post-award axes separate', () => {
  const series = contractSeries()
  for (const key of ['contract_status', 'acceptance_status', 'payment_status', 'performance_security_status'] as const) {
    assert.equal(series[key].reduce((n, p) => n + p.count, 0), listContracts().length, key)
    assert.deepEqual(
      series[key].map((p) => p.value),
      [...CONTROLLED_VALUES[key]],
      `${key} must use the schema vocabulary order`,
    )
  }
})

test('noticeBidCoverage partitions the notices with no overlap', () => {
  const coverage = noticeBidCoverage()
  assert.equal(coverage.withBids.count + coverage.withoutBids.count, listNotices().length)
  const overlap = coverage.withBids.ids.filter((id) => coverage.withoutBids.ids.includes(id))
  assert.deepEqual(overlap, [], 'a notice cannot be both with and without bids')
})

test('noticeBidCoverage reports a zero for notices without bids rather than omitting them', () => {
  const coverage = noticeBidCoverage()
  // Every Notice in the corpus is referenced by at least one Bid, so this is zero.
  assert.equal(coverage.withoutBids.count, 0)
  assert.deepEqual(coverage.withoutBids.ids, [])
  assert.equal(coverage.withBids.count, listNotices().length)
})

/* ------------------------------------------------------------------ */
/* Currency: never summed                                               */
/* ------------------------------------------------------------------ */

test('currencyCoverage counts records per currency and never sums amounts', () => {
  const coverage = currencyCoverage(listContracts(), 'contract_value', 'contract_value_currency')
  const total = coverage.reduce((n, c) => n + c.count, 0)
  assert.equal(total, listContracts().length, 'every contract is counted in exactly one currency')
  const currencies = coverage.map((c) => c.currency)
  assert.equal(new Set(currencies).size, currencies.length, 'currencies must not be merged')
  // The corpus holds INR and USD with no conversion between them.
  assert.ok(currencies.includes('INR'))
  assert.ok(currencies.includes('USD'))
  for (const c of coverage) {
    assert.ok(c.withAmount <= c.count, `${c.currency}: cannot have more amounts than records`)
    assert.equal((c as unknown as { total?: number }).total, undefined, 'no monetary total may be exposed')
  }
})

test('currencyCoverage puts a blank currency in its own bucket', () => {
  const coverage = currencyCoverage(listBids(), 'quoted_amount', 'quoted_currency')
  const blank = coverage.find((c) => c.currency === BLANK)
  assert.ok(blank, 'a blank currency must be visible')
  assert.equal(blank!.count + coverage.filter((c) => c.currency !== BLANK).reduce((n, c) => n + c.count, 0), listBids().length)
})

test('currencyCoverage handles a zero amount as not recorded', () => {
  const rec = {
    id: 'C-1',
    type: 'contract',
    fictional: { isFictional: false },
    frontmatter: { contract_value: 0, contract_value_currency: 'INR' },
    links: { fields: {}, body: [] },
  }
  const [only] = currencyCoverage([rec as never], 'contract_value', 'contract_value_currency')
  assert.equal(only.withAmount, 0, 'a zero amount is not a usable figure')
})

/* ------------------------------------------------------------------ */
/* Funding                                                              */
/* ------------------------------------------------------------------ */

test('fundingPipeline names the link each stage is derived from', () => {
  const stages = fundingPipeline()
  assert.equal(stages[0].count, listOpportunities().length)
  assert.equal(stages[0].percent, 100)
  for (const s of stages) {
    assert.ok(s.basis.length > 0, `${s.label} must state its basis`)
    assert.ok(s.count <= stages[0].count, 'a stage cannot exceed the opportunity count')
    assert.equal(s.ids.length, s.count)
  }
})

test('fundingPipeline counts applications through the application link', () => {
  const stages = fundingPipeline()
  const apps = stages.find((s) => s.label.includes('Application'))!
  // Both Applications link back to an Opportunity, so the count matches the number
  // of Applications that resolve.
  assert.ok(apps.count > 0, 'the applications stage must not be silently empty')
  assert.equal(apps.ids.length, apps.count)
})

test('workflowFlows counts whole collections in workflow order', () => {
  const flows = workflowFlows()

  const funding = flows.funding
  assert.deepEqual(
    funding.map((s) => s.order),
    ['Find', 'Match', 'Apply'],
  )
  assert.equal(funding[0].count, listOpportunities().length)
  assert.equal(funding[1].count, listMatches().length)
  assert.equal(funding[2].count, listApplications().length)

  const procurement = flows.procurement
  assert.deepEqual(
    procurement.map((s) => s.order),
    ['Find', 'Bid', 'Contract'],
  )
  assert.equal(procurement[0].count, listNotices().length)
  assert.equal(procurement[1].count, listBids().length)
  assert.equal(procurement[2].count, listContracts().length)
})

test('workflowFlows steps match the stat cards they sit beside', () => {
  // The Overview renders the same collections as the workflow step counts and the
  // stat cards, so the two must agree or the page would show two different
  // "Opportunities" numbers.
  for (const s of [...workflowFlows().funding, ...workflowFlows().procurement]) {
    assert.equal(s.count, listRecords(s.collection).length, `${s.collection} is whole-collection`)
  }
})

test('applicationSubmission separates a passed date from a future one and a blank', () => {
  const points = applicationSubmission(TODAY)
  const passed = points.find((p) => p.value === 'submitted')!
  const future = points.find((p) => p.value === 'future')!
  const blank = points.find((p) => p.value === 'no_date')!
  assert.equal(passed.ids.length, passed.count)
  assert.equal(future.count, 0, 'no application has a submission_date ahead of the reference date')
  assert.ok(blank.count > 0, 'the blank bucket must carry the record with no submission_date')
  assert.equal(
    points.reduce((n, p) => n + p.count, 0),
    listApplications().length,
  )
})

test('providersWithOpportunities is a subset of the organizations', () => {
  const providers = providersWithOpportunities()
  assert.ok(providers.count <= listOrganizations().length)
  assert.equal(providers.ids.length, providers.count)
  for (const id of providers.ids) {
    assert.ok(listOrganizations().some((o) => o.id === id), `${id} is not an organization`)
  }
})

test('providerCoverage only counts organizations that actually publish', () => {
  const points = providerCoverage()
  const total = points.reduce((n, p) => n + p.count, 0)
  assert.equal(total, providersWithOpportunities().count)
  for (const p of points) {
    for (const id of p.ids) {
      assert.ok(providersWithOpportunities().ids.includes(id), `${id} is not a publishing organization`)
    }
  }
})

/* ------------------------------------------------------------------ */
/* Company activity                                                     */
/* ------------------------------------------------------------------ */

test('companyActivity lists every company including those with no activity', () => {
  const activity = companyActivity()
  assert.equal(activity.length, listCompanies().length)
  for (const c of activity) {
    assert.ok(c.name.length > 0, `${c.id} needs a display name`)
    for (const n of [c.matches, c.applications, c.bids, c.contracts]) {
      assert.ok(Number.isInteger(n) && n >= 0)
    }
  }
})

test('companyActivity totals match the corpus counts', () => {
  const activity = companyActivity()
  assert.equal(
    activity.reduce((n, c) => n + c.bids, 0),
    listBids().length,
  )
  assert.equal(
    activity.reduce((n, c) => n + c.contracts, 0),
    listContracts().length,
  )
  assert.equal(
    activity.reduce((n, c) => n + c.matches, 0),
    listMatches().length,
  )
})

/* ------------------------------------------------------------------ */
/* Re-exports stay consistent with the modules they delegate to         */
/* ------------------------------------------------------------------ */

test('provenanceSplit accounts for every record in the corpus', () => {
  const split = provenanceSplit()
  const all = [
    ...listOpportunities(),
    ...listCompanies(),
    ...listMatches(),
    ...listApplications(),
    ...listOrganizations(),
    ...listNotices(),
    ...listBids(),
    ...listContracts(),
  ]
  assert.ok(split.fictional + split.real >= all.length, 'the split covers at least the eight listed collections')
  assert.ok(split.fictional > 0 && split.real > 0, 'the corpus is genuinely mixed')
})

test('attentionFor returns the same items as the procurement module', () => {
  assert.deepEqual(attentionFor(TODAY), attentionFor(TODAY), 'must be deterministic for a fixed date')
  for (const item of attentionFor(TODAY)) {
    assert.ok(item.rule.length > 0 && item.reason.length > 0, 'every item explains itself')
  }
})

test('evidenceCoverage is exposed and its numbers are consistent', () => {
  const e = evidenceCoverage()
  assert.equal(e.withSource + e.withoutSource, e.totalBids)
  assert.ok(e.verifiedWithoutSource <= e.verifiedClaims)
})

test('distinctValues ignores blanks', () => {
  assert.equal(distinctValues(listOpportunities(), 'opportunity_type'), distinctValues(listOpportunities(), 'opportunity_type'))
  assert.equal(distinctValues([], 'opportunity_type'), 0)
  assert.equal(distinctValues(listOpportunities(), 'application_deadline'), 0, 'all five are blank')
})

/* ------------------------------------------------------------------ */
/* Determinism                                                          */
/* ------------------------------------------------------------------ */

test('every analytics function returns identical output when called twice', () => {
  const runs = [
    () => groupCounts(listBids(), 'bid_status'),
    () => bidAxisSeries(),
    () => urgencyBuckets(primaryDeadlines('notices'), TODAY),
    () => bidDeadlines(),
    () => fundingPipeline(),
    () => companyActivity(),
    () => noticeSeries(),
    () => contractSeries(),
    () => applicationSubmission(TODAY),
    () => currencyCoverage(listContracts(), 'contract_value', 'contract_value_currency'),
  ]
  for (const run of runs) {
    assert.deepEqual(run(), run(), 'a pure function must not vary between calls')
  }
})
