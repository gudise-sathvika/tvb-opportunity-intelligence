/**
 * Phase 7 — document-set derivation tests.
 *
 * Two halves. The first drives the set arithmetic with synthetic records,
 * covering the states the shipped vault cannot contain on its own: duplicates,
 * blank names, case mismatches and a wholly absent list. The shipped corpus
 * has none of those, so without synthetic inputs these cases are untestable.
 *
 * The second half asserts against the real snapshot, and includes the property
 * that matters most: the derived `missing` list must agree with importer rule
 * 11. If those two ever disagree, the page and the gate are telling a reader
 * different things about the same record.
 *
 * Run with: npm run test:data
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './test-fixtures/use-snapshot'

import {
  DOCUMENT_SET_STATUS_LABEL,
  DOCUMENT_SET_STATUS_NOTE,
  documentSetFor,
  documentSetTotals,
  mandatoryCoverageFor,
  mandatoryDocumentsFor,
} from './documents'
import { getRecord, listBids, listNotices } from './selectors'

/** A record carrying only the two lists, which is all the derivation reads. */
const bidWith = (required: unknown, completed: unknown): never =>
  ({ id: 'BID-999', frontmatter: { required_documents: required, completed_documents: completed } }) as never

/* ------------------------------------------------------------------ *
 * Set arithmetic                                                       *
 * ------------------------------------------------------------------ */

test('every required name completed is complete, with nothing outstanding', () => {
  const set = documentSetFor(bidWith(['A', 'B'], ['A', 'B']))
  assert.equal(set.status, 'complete')
  assert.equal(set.isComplete, true)
  assert.deepEqual(set.missing, [])
  assert.equal(set.requiredCount, 2)
  assert.equal(set.completedCount, 2)
  assert.equal(set.missingCount, 0)
})

test('a missing completion is reported by name, not only by count', () => {
  const set = documentSetFor(bidWith(['A', 'B', 'C'], ['A', 'C']))
  assert.equal(set.status, 'incomplete')
  assert.deepEqual(set.missing, ['B'])
  assert.equal(set.missingCount, 1)
})

test('an absent required_documents key is not the same as an empty one', () => {
  const absent = documentSetFor(bidWith(undefined, []))
  assert.equal(absent.status, 'not_recorded')
  assert.equal(absent.isRecorded, false)
  assert.equal(absent.isComplete, false)

  const empty = documentSetFor(bidWith([], []))
  assert.equal(empty.status, 'none_required')
  assert.equal(empty.isRecorded, true)
  assert.equal(empty.isComplete, false)
})

test('requiring nothing is not reported as complete', () => {
  const set = documentSetFor(bidWith([], []))
  assert.deepEqual(set.missing, [])
  assert.equal(set.isComplete, false, 'an empty requirement list asserts nothing was achieved')
})

/*
 * The two defects rule 11 does not catch. Both pass the subset check, which is
 * why the importer rejects them separately.
 */

test('a repeated required name is counted once and flagged', () => {
  const set = documentSetFor(bidWith(['A', 'A', 'B'], ['A', 'B']))
  assert.equal(set.status, 'complete')
  assert.equal(set.requiredCount, 2, 'A repeated is one document, not two')
  assert.deepEqual(set.duplicates, ['A'])
})

test('a repeated completed name is counted once and flagged', () => {
  const set = documentSetFor(bidWith(['A'], ['A', 'A']))
  assert.equal(set.completedCount, 1)
  assert.deepEqual(set.duplicates, ['A'])
})

test('a blank name is surfaced as a defect and still counted as outstanding', () => {
  const set = documentSetFor(bidWith(['', 'A'], ['A']))
  assert.deepEqual(set.blanks, [''])
  assert.equal(set.status, 'incomplete')
  assert.deepEqual(set.missing, [''], 'the blank genuinely has no completion')
})

test('a whitespace-only name is a blank, not a name', () => {
  const set = documentSetFor(bidWith(['   '], ['   ']))
  assert.deepEqual(set.blanks, ['   '])
})

test('a record with neither list still derives without throwing', () => {
  const set = documentSetFor({ id: 'BID-999', frontmatter: {} } as never)
  assert.equal(set.status, 'not_recorded')
  assert.deepEqual(set.required, [])
  assert.deepEqual(set.completed, [])
  assert.deepEqual(set.duplicates, [])
  assert.deepEqual(set.blanks, [])
})

/*
 * Equality is exact string comparison, matching rule 11's `includes`. These
 * three cases pin that decision: trimming or folding case here would make the
 * page disagree with the gate that admitted the record.
 */

test('matching is case-sensitive', () => {
  const set = documentSetFor(bidWith(['Bid security'], ['bid security']))
  assert.equal(set.status, 'incomplete')
  assert.deepEqual(set.missing, ['Bid security'])
})

test('matching ignores no surrounding whitespace', () => {
  const set = documentSetFor(bidWith(['Bid security'], ['Bid security ']))
  assert.deepEqual(set.missing, ['Bid security'])
})

test('recorded order is preserved so the page matches the record file', () => {
  const set = documentSetFor(bidWith(['Z', 'A', 'M'], ['Z']))
  assert.deepEqual(set.required, ['Z', 'A', 'M'])
  assert.deepEqual(set.missing, ['A', 'M'])
})

test('every status has a distinct label and an explanatory note', () => {
  const seen = new Set<string>()
  for (const status of ['not_recorded', 'none_required', 'incomplete', 'complete'] as const) {
    const label = DOCUMENT_SET_STATUS_LABEL[status]
    assert.ok(label.length > 0)
    assert.ok(!seen.has(label), `duplicate label ${label}`)
    seen.add(label)
    assert.ok(DOCUMENT_SET_STATUS_NOTE[status].length > 20)
  }
})

/* ------------------------------------------------------------------ *
 * The shipped records                                                  *
 * ------------------------------------------------------------------ */

test('BID-001 is incomplete on exactly one named document', () => {
  const set = documentSetFor(getRecord('BID-001')!)
  assert.equal(set.status, 'incomplete')
  assert.equal(set.missingCount, 1)
  assert.match(set.missing[0], /mounting-structure certification/)
  assert.deepEqual(set.duplicates, [])
  assert.deepEqual(set.blanks, [])
})

test('BID-002 and BID-004 record a fully completed set', () => {
  for (const id of ['BID-002', 'BID-004']) {
    const set = documentSetFor(getRecord(id)!)
    assert.equal(set.status, 'complete', `${id} should be complete`)
    assert.equal(set.missingCount, 0)
  }
})

test('BID-005 is incomplete on its eligibility certificate', () => {
  const set = documentSetFor(getRecord('BID-005')!)
  assert.equal(set.status, 'incomplete')
  assert.match(set.missing[0], /eligibility certificate/)
})

test('BID-003 requires nothing and is not called complete', () => {
  const set = documentSetFor(getRecord('BID-003')!)
  assert.equal(set.status, 'none_required')
  assert.equal(set.isComplete, false)
})

test('no shipped record carries a duplicate or blank document name', () => {
  for (const b of listBids()) {
    const set = documentSetFor(b)
    assert.deepEqual(set.duplicates, [], `${b.id} repeats a name`)
    assert.deepEqual(set.blanks, [], `${b.id} holds a blank name`)
  }
  for (const n of listNotices()) {
    assert.deepEqual(mandatoryDocumentsFor(n).filter((d) => d.trim() === ''), [], `${n.id} blank`)
  }
})

/*
 * The property that ties this module to importer rule 11. Rule 11 requires
 * `completed ⊆ required`; this asserts the derived `missing` list is exactly
 * the set difference and is itself a subset of `required`.
 */

test('derived missing agrees with rule 11 across every shipped bid', () => {
  for (const b of listBids()) {
    const set = documentSetFor(b)
    const rawRequired = (b.frontmatter.required_documents ?? []) as string[]
    const rawCompleted = (b.frontmatter.completed_documents ?? []) as string[]
    const expected = [...new Set(rawRequired)].filter((d) => !new Set(rawCompleted).has(d))
    assert.deepEqual(set.missing, expected, `${b.id} disagrees with the subset difference`)
    for (const name of set.missing) {
      assert.ok(set.required.includes(name), `${b.id}: ${name} outstanding but not required`)
    }
  }
})

test('totals partition every bid by status with no remainder', () => {
  const bids = listBids()
  const t = documentSetTotals(bids)
  assert.equal(t.totalBids, bids.length)
  assert.equal(
    t.complete + t.incomplete + t.noneRequired + t.withoutRequiredList,
    t.totalBids,
  )
  assert.equal(t.withRequiredList + t.withoutRequiredList, t.totalBids)
})

/* ------------------------------------------------------------------ *
 * Notice mandate, and the overlap with a bid's own list               *
 * ------------------------------------------------------------------ */

test('RFB-001 mandates three documents for every bidder', () => {
  assert.equal(mandatoryDocumentsFor(getRecord('RFB-001')!).length, 3)
})

test('RFB-003 mandates none, and an empty list is preserved as empty', () => {
  const list = mandatoryDocumentsFor(getRecord('RFB-003')!)
  assert.deepEqual(list, [])
})

test('BID-001 names every document its notice mandates', () => {
  const c = mandatoryCoverageFor(getRecord('BID-001')!)
  assert.equal(c.noticeId, 'RFB-001')
  assert.equal(c.mandatory.length, 3)
  assert.deepEqual(c.notNamedInBid, [])
})

test('the overlap is an observation, so a partial award is reported not judged', () => {
  const c = mandatoryCoverageFor(getRecord('BID-005')!)
  assert.equal(c.noticeId, 'RFB-002')
  assert.equal(c.mandatory.length, 2)
  assert.equal(c.namedInBid.length, 1)
  assert.equal(c.notNamedInBid.length, 1)
  assert.match(c.notNamedInBid[0], /anonymisation protocol/)
})

test('a bid with no recorded notice yields an empty observation, not a throw', () => {
  const c = mandatoryCoverageFor({ id: 'BID-999', frontmatter: {} } as never)
  assert.equal(c.noticeId, null)
  assert.deepEqual(c.mandatory, [])
  assert.deepEqual(c.notNamedInBid, [])
})

test('mandatory documents are deduplicated like every other list', () => {
  const notice = { id: 'RFB-999', frontmatter: { mandatory_bid_documents: ['A', 'A', 'B'] } } as never
  assert.deepEqual(mandatoryDocumentsFor(notice), ['A', 'B'])
})