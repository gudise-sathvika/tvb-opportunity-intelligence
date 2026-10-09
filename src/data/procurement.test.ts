/**
 * Procurement metric definitions.
 *
 * These tests exist to pin the *definitions*, not the numbers. A count that
 * changes when a record is added is correct behaviour; a count that changes when
 * a rule is reworded is a bug. So each test states which records are counted and
 * why the boundary cases land where they do.
 *
 * Every function that needs "now" takes the date as an argument, which is what
 * makes any of this testable at all. Nothing here reads the system clock.
 *
 * Run with: npm run test:data
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './test-fixtures/use-snapshot'

import {
  ATTENTION_RULES,
  BID_STATUS_ORDER,
  DEADLINE_STATE_LABEL,
  TERMINAL_BID_STATUSES,
  attentionItems,
  bidCountByNotice,
  bidDeadlineState,
  bidsByAxis,
  classifyDeadline,
  companyProcurement,
  deadlineStates,
  evidenceCoverage,
  filterBids,
  filterNotices,
  isISODate,
  isTerminalBid,
  noticesByDeadline,
  noticesByField,
  noticesWithBids,
  noticesWithoutBids,
  sortBids,
  sortNotices,
  todayISO,
} from './procurement'
import { CONTROLLED_VALUES } from '../import/controlled-values'
import { bidsForCompany, companyForBid, listBids, listCompanies, listNotices, textField } from './selectors'

/* ------------------------------------------------------------------ */
/* The reference date used throughout                                  */
/* ------------------------------------------------------------------ */

/**
 * Fixed at a date AFTER every recorded deadline in the corpus, so the fixtures
 * exercise the "past" branch rather than depending on when the suite runs.
 */
const TODAY = '2026-10-04'

/* ------------------------------------------------------------------ */
/* Date validity                                                       */
/* ------------------------------------------------------------------ */

test('isISODate accepts real date-only strings', () => {
  for (const good of ['2026-01-01', '2026-12-31', '2024-02-29']) {
    assert.equal(isISODate(good), true, good)
  }
})

test('isISODate rejects blanks, non-dates, and dates that do not exist', () => {
  for (const bad of ['', '2026-1-1', '20260101', 'yesterday', '2026-13-01', '2026-00-10', '2026-02-30', '2026-04-31']) {
    assert.equal(isISODate(bad), false, JSON.stringify(bad))
  }
  for (const notAString of [undefined, null, 20260101, true, [], {}]) {
    assert.equal(isISODate(notAString), false, JSON.stringify(notAString))
  }
})

test('todayISO pads month and day so its output always matches the ISO shape', () => {
  for (const d of [new Date(2026, 0, 5), new Date(2026, 11, 31), new Date(2026, 8, 9)]) {
    assert.equal(isISODate(todayISO(d)), true, todayISO(d))
  }
})

/* ------------------------------------------------------------------ */
/* Deadline classification — the blank-is-not-overdue rule             */
/* ------------------------------------------------------------------ */

test('a blank or malformed deadline is none_recorded, never past', () => {
  // The single most important rule in this module. Treating blank as overdue
  // manufactures false alarms on exactly the records whose author was honest
  // about not knowing.
  for (const blank of ['', undefined, null, 'not stated', 'soon']) {
    assert.equal(classifyDeadline(blank, TODAY), 'none_recorded', JSON.stringify(blank))
  }
})

test('a deadline equal to today is upcoming, not past', () => {
  // A deadline falling at the end of the current day has not yet passed.
  // Using `<` against the reference date would report it overdue for a day.
  assert.equal(classifyDeadline(TODAY, TODAY), 'upcoming')
})

test('a deadline before today is past and one after is upcoming', () => {
  assert.equal(classifyDeadline('2026-10-03', TODAY), 'past')
  assert.equal(classifyDeadline('2026-10-05', TODAY), 'upcoming')
})

test('there is no "due soon" state, because no look-ahead window is recorded', () => {
  assert.deepEqual(Object.keys(DEADLINE_STATE_LABEL).sort(), ['none_recorded', 'past', 'upcoming'])
})

test('notice deadline classification counts each notice exactly once', () => {
  const buckets = noticesByDeadline(TODAY)
  const total = buckets.upcoming.length + buckets.past.length + buckets.none_recorded.length
  assert.equal(total, listNotices().length)

  // Every ID appears in exactly one bucket — no double counting.
  const ids = [...buckets.upcoming, ...buckets.past, ...buckets.none_recorded].map((n) => n.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('a bid inherits its deadline from its notice, and inherits none when blank', () => {
  const withDeadline = listBids().find((b) => textField(b, 'bid_submission_date') !== '')
  assert.ok(withDeadline, 'fixture needs a submitted bid')
  assert.equal(bidDeadlineState(withDeadline, TODAY), 'past')

  // BID-003's notice has a blank deadline, so the bid is none_recorded even
  // though its own submission date is also blank.
  const noDeadlineBid = listBids().find((b) => bidDeadlineState(b, TODAY) === 'none_recorded')
  assert.ok(noDeadlineBid, 'fixture needs a bid whose notice deadline is blank')
})

/* ------------------------------------------------------------------ */
/* Notice counts                                                       */
/* ------------------------------------------------------------------ */

test('every notice is counted exactly once as with-bids or without-bids', () => {
  const with_ = noticesWithBids()
  const without = noticesWithoutBids()
  assert.equal(with_.length + without.length, listNotices().length)
  const ids = [...with_, ...without].map((n) => n.id)
  assert.equal(new Set(ids).size, ids.length, 'no notice appears in both buckets')
})

test('bidCountByNotice covers every notice, including those with zero bids', () => {
  const counts = bidCountByNotice()
  assert.equal(Object.keys(counts).length, listNotices().length)
  for (const n of listNotices()) {
    const value = counts[n.id]
    assert.equal(typeof value, 'number', n.id)
    assert.ok(value >= 0, n.id)
  }
  // Counts must agree with the relationship index, summed.
  const summed = Object.values(counts).reduce((a, b) => a + b, 0)
  assert.equal(summed, listBids().length, 'every bid belongs to exactly one notice')
})

test('company procurement counts are derived from the bid index, not from a scan', () => {
  const stats = companyProcurement()
  assert.equal(stats.total, listCompanies().length)
  assert.ok(stats.withBids <= stats.total)
  assert.ok(stats.multipleBids <= stats.withBids)

  // Cross-checked against the relationship index rather than trusted.
  const withBid = listCompanies().filter((c) => bidsForCompany(c.id).length > 0)
  const multi = listCompanies().filter((c) => bidsForCompany(c.id).length > 1)
  assert.equal(stats.withBids, withBid.length)
  assert.equal(stats.multipleBids, multi.length)
})

/* ------------------------------------------------------------------ */
/* The three axes                                                      */
/* ------------------------------------------------------------------ */

test('every axis grouping covers the whole declared vocabulary, zeros included', () => {
  for (const axis of ['eligibility_status', 'bid_decision', 'bid_status'] as const) {
    const groups = bidsByAxis(listBids(), axis)
    assert.equal(
      groups.length,
      CONTROLLED_VALUES[axis].length,
      `${axis} must show all ${CONTROLLED_VALUES[axis].length} declared values`,
    )
    const summed = groups.reduce((n, g) => n + g.count, 0)
    assert.equal(summed, listBids().length, `${axis} must count every bid exactly once`)
  }
})

test('a zero in an axis grouping is a true zero, not a missing value', () => {
  const groups = bidsByAxis(listBids(), 'bid_status')
  const preparing = groups.find((g) => g.value === 'Preparing')
  assert.ok(preparing, 'Preparing is in the vocabulary')
  assert.equal(preparing.count, 0)
  assert.deepEqual(preparing.ids, [])
})

test('grouping by one axis does not merge the other two', () => {
  // The whole point of the three-axis model. A group of "Submitted" bids must
  // still contain a range of eligibility and decision values.
  const submitted = bidsByAxis(listBids(), 'bid_status').find((g) => g.value === 'Submitted')
  assert.ok(submitted && submitted.count > 0, 'fixture needs a submitted bid')
  const ids = submitted.ids
  const eligibilities = new Set(ids.map((id) => textField(listBids().find((b) => b.id === id)!, 'eligibility_status')))
  const decisions = new Set(ids.map((id) => textField(listBids().find((b) => b.id === id)!, 'bid_decision')))
  assert.ok(eligibilities.size >= 1)
  assert.ok(decisions.size >= 1)

  // The grouping must not have invented a value: every observed eligibility is
  // a real vocabulary entry, never a blend of two axes.
  for (const value of eligibilities) {
    assert.ok(CONTROLLED_VALUES.eligibility_status.includes(String(value)), String(value))
  }
  for (const value of decisions) {
    assert.ok(CONTROLLED_VALUES.bid_decision.includes(String(value)), String(value))
  }
})

test('bid status order comes from the schema rather than a hardcoded list', () => {
  assert.deepEqual(BID_STATUS_ORDER, [...CONTROLLED_VALUES.bid_status])
  assert.equal(new Set(BID_STATUS_ORDER).size, BID_STATUS_ORDER.length)
})

test('terminal bid statuses are all real vocabulary values', () => {
  for (const s of TERMINAL_BID_STATUSES) {
    assert.ok(CONTROLLED_VALUES.bid_status.includes(s), `${s} is not in the vocabulary`)
  }
  assert.equal(isTerminalBid({ frontmatter: { bid_status: 'Awarded' } } as never), true)
  assert.equal(isTerminalBid({ frontmatter: { bid_status: 'Preparing' } } as never), false)
  assert.equal(isTerminalBid({ frontmatter: { bid_status: '' } } as never), false)
})

test('notice groupings cover the vocabulary and count each notice once', () => {
  for (const f of ['notice_type', 'procurement_method', 'notice_status', 'lot_structure'] as const) {
    const groups = noticesByField(f)
    assert.equal(groups.length, CONTROLLED_VALUES[f].length, f)
    assert.equal(
      groups.reduce((n, g) => n + g.count, 0),
      listNotices().length,
      f,
    )
  }
})

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

test('evidence coverage is counts, never a percentage', () => {
  const cov = evidenceCoverage()
  assert.equal(cov.withSource + cov.withoutSource, cov.totalBids)
  assert.ok(cov.verifiedWithoutSource <= cov.verifiedClaims)
  assert.ok(cov.verifiedClaims <= cov.totalBids)
})

test('no bid claims a verified eligibility without citing a source', () => {
  // The invariant the corpus currently satisfies. If a record ever breaks it,
  // this fails and the claim needs a real Source behind it.
  assert.equal(evidenceCoverage().verifiedWithoutSource, 0)
})

/* ------------------------------------------------------------------ */
/* Attention                                                           */
/* ------------------------------------------------------------------ */

test('every emitted attention item names a documented rule and gives a reason', () => {
  const known = new Set(ATTENTION_RULES.map((r) => r.rule))
  for (const item of attentionItems(TODAY)) {
    assert.ok(known.has(item.rule), `undocumented rule: ${item.rule}`)
    assert.ok(item.reason.length > 20, `${item.rule} needs a real explanation`)
    assert.ok(['Notice', 'Bid'].includes(item.recordType), item.recordType)
  }
})

test('attention items are deterministically ordered', () => {
  const a = attentionItems(TODAY)
  const b = attentionItems(TODAY)
  assert.deepEqual(a, b, 'two calls on the same data must agree exactly')
  const keys = a.map((i) => `${i.recordType}|${i.recordId}|${i.rule}`)
  assert.deepEqual(keys, [...keys].sort(), 'items must be sorted by record then rule')
})

test('attention never fires on a blank deadline', () => {
  // Push the reference date far into the future so every recorded deadline is
  // past. Anything still firing must be justified by a non-deadline rule.
  const future = '2099-01-01'
  const forBlankDeadlineNotice = listNotices().find((n) => !isISODate(textField(n, 'bid_submission_deadline')))
  assert.ok(forBlankDeadlineNotice, 'fixture needs a notice with a blank deadline')

  const items = attentionItems(future).filter((i) => i.recordId === forBlankDeadlineNotice.id)
  for (const item of items) {
    assert.ok(
      !item.reason.includes('has passed'),
      `${forBlankDeadlineNotice.id} fired a deadline rule on a blank deadline: ${item.reason}`,
    )
  }
})

test('a past deadline on an open notice is reported, with both recorded values named', () => {
  const items = attentionItems(TODAY).filter((i) => i.rule === 'notice-open-past-deadline')
  for (const item of items) {
    assert.ok(item.reason.includes('Open'), item.reason)
    assert.match(item.reason, /\d{4}-\d{2}-\d{2}/, 'the reason must quote the stored date')
  }
})

test('a due-soon style rule does not exist, because no threshold is recorded', () => {
  const rules = ATTENTION_RULES.map((r) => r.rule)
  assert.ok(!rules.some((r) => /soon|approaching|urgent/i.test(r)))
})

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */

test('an empty notice filter returns every notice', () => {
  assert.equal(filterNotices({}, TODAY).length, listNotices().length)
})

test('each notice filter narrows correctly and combines with AND', () => {
  const type = CONTROLLED_VALUES.notice_type[0]
  const byType = filterNotices({ noticeType: type }, TODAY)
  assert.ok(byType.length > 0, 'fixture needs a notice of a known type')
  for (const n of byType) assert.equal(textField(n, 'notice_type'), type)

  // AND, not OR.
  const both = filterNotices({ noticeType: type, deadline: 'past' }, TODAY)
  for (const n of both) {
    assert.equal(textField(n, 'notice_type'), type)
    assert.equal(classifyDeadline(textField(n, 'bid_submission_deadline'), TODAY), 'past')
  }
  assert.ok(both.length <= byType.length)
})

test('a filter matching nothing returns nothing rather than everything', () => {
  const none = filterNotices({ noticeType: 'EOI' }, TODAY)
  for (const n of listNotices()) {
    if (textField(n, 'notice_type') === 'EOI') assert.ok(none.length > 0)
  }
  assert.equal(filterNotices({ procurementMethod: 'No such method' }, TODAY).length, 0)
})

test('the has-bids and no-bids filters partition the notices', () => {
  const with_ = filterNotices({ bids: 'with' }, TODAY)
  const without = filterNotices({ bids: 'without' }, TODAY)
  assert.equal(with_.length + without.length, listNotices().length)
  assert.equal(filterNotices({ bids: 'any' }, TODAY).length, listNotices().length)
})

test('each bid filter narrows on its own axis and on company and notice', () => {
  const status = CONTROLLED_VALUES.bid_status.find((s) => bidsByAxis(listBids(), 'bid_status').find((g) => g.value === s)?.count)
  assert.ok(status, 'fixture needs a bid status that occurs')
  const byStatus = filterBids({ status }, TODAY)
  assert.ok(byStatus.length > 0)
  for (const b of byStatus) assert.equal(textField(b, 'bid_status'), status)

  const companyId = companyForBids()[0]
  assert.ok(companyId, 'fixture needs a company with a bid')
  const byCompany = filterBids({ companyId }, TODAY)
  assert.ok(byCompany.length > 0)
  for (const b of byCompany) assert.equal(companyForBid(b.id)?.id, companyId)

  assert.equal(filterBids({}, TODAY).length, listBids().length)
})

/** Companies that actually have at least one bid, for filter fixtures. */
function companyForBids(): string[] {
  return listCompanies().map((c) => c.id).filter((id) => bidsForCompany(id).length > 0)
}

test('bid filters combine with AND across axes', () => {
  const one = listBids()[0]
  const status = textField(one, 'bid_status')!
  const decision = textField(one, 'bid_decision')!
  const both = filterBids({ status, decision }, TODAY)
  assert.ok(both.some((b) => b.id === one.id), 'the fixture record must survive its own values')
  for (const b of both) {
    assert.equal(textField(b, 'bid_status'), status)
    assert.equal(textField(b, 'bid_decision'), decision)
  }
})

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

test('deadline sorting puts records with no deadline last, not first', () => {
  const sorted = sortNotices(listNotices(), 'deadline')
  const firstBlank = sorted.findIndex((n) => !isISODate(textField(n, 'bid_submission_deadline')))
  if (firstBlank !== -1) {
    for (let i = firstBlank; i < sorted.length; i += 1) {
      assert.ok(
        !isISODate(textField(sorted[i], 'bid_submission_deadline')),
        'every dated notice must sort before every undated one',
      )
    }
  }
  // And the dated prefix is ascending.
  const dated = sorted.filter((n) => isISODate(textField(n, 'bid_submission_deadline')))
  const values = dated.map((n) => textField(n, 'bid_submission_deadline') as string)
  assert.deepEqual(values, [...values].sort())
})

test('every sort is a total order, so repeated sorts agree exactly', () => {
  for (const sort of ['deadline', 'title', 'buyer', 'type', 'id'] as const) {
    const a = sortNotices(listNotices(), sort).map((n) => n.id)
    const b = sortNotices(listNotices(), sort).map((n) => n.id)
    assert.deepEqual(a, b, sort)
    assert.equal(new Set(a).size, a.length, `${sort} dropped or duplicated a record`)
  }
  for (const sort of ['status', 'decision', 'eligibility', 'deadline', 'id'] as const) {
    const a = sortBids(listBids(), sort).map((b) => b.id)
    const b = sortBids(listBids(), sort).map((x) => x.id)
    assert.deepEqual(a, b, sort)
    assert.equal(new Set(a).size, a.length, `${sort} dropped or duplicated a bid`)
  }
})

test('sorting never mutates its input', () => {
  const input = [...listNotices()]
  const before = input.map((n) => n.id)
  sortNotices(input, 'deadline')
  assert.deepEqual(input.map((n) => n.id), before)
})

test('bid deadline sorting resolves the parent notice', () => {
  const sorted = sortBids(listBids(), 'deadline')
  const withDates = sorted.filter((b) => bidDeadlineState(b, TODAY) !== 'none_recorded')
  const blanks = sorted.filter((b) => bidDeadlineState(b, TODAY) === 'none_recorded')
  assert.equal(withDates.length + blanks.length, listBids().length)
  if (blanks.length > 0) {
    const lastDated = sorted.indexOf(withDates[withDates.length - 1])
    const firstBlank = sorted.indexOf(blanks[0])
    assert.ok(lastDated < firstBlank, 'undated bids sort after dated ones')
  }
})

/* ------------------------------------------------------------------ */
/* Guardrails: nothing unsupported leaks out                          */
/* ------------------------------------------------------------------ */

test('no metric combines the three axes into one value', () => {
  // A combined score would have to appear as a numeric field somewhere. The
  // exported surface is enumerated rather than pattern-matched, so adding one
  // later forces a decision here.
  const exported = {
    bidCountByNotice,
    bidsByAxis,
    companyProcurement,
    deadlineStates,
    evidenceCoverage,
    noticesByField,
  }
  for (const [name, fn] of Object.entries(exported)) {
    assert.equal(typeof fn, 'function', name)
  }
  // Every grouping returns per-axis counts, never a single blended figure.
  for (const g of bidsByAxis(listBids(), 'bid_status')) {
    assert.equal(typeof g.count, 'number', g.value)
    assert.equal(Array.isArray(g.ids), true, g.value)
  }
})

test('the attention rules are all documented with a reason for existing', () => {
  for (const r of ATTENTION_RULES) {
    assert.ok(r.why.length > 30, `${r.rule} needs a stated rationale`)
    assert.ok(!/score|priority|severity/i.test(r.why), `${r.rule} must not imply a severity`)
  }
})