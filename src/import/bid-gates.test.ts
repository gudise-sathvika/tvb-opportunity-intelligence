/**
 * Bid validator — failure paths.
 *
 * The shipped vault contains only valid records, so it can only ever prove
 * that the gates do not fire on good data. It cannot prove they fire at all.
 * That is what this file is for: each gate is driven with a deliberately
 * broken record in a throwaway vault, and the specific check is asserted to
 * have failed.
 *
 * The pattern throughout is "break exactly one thing". A fixture that trips
 * three gates proves nothing about any of them, so each case names the gate it
 * targets and asserts on that gate's own failure message.
 *
 * Nothing here touches the real vault. Every fixture is written to a fresh
 * mkdtemp directory and removed in a finally block.
 *
 * Run with: npm run test:data
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import '../data/test-fixtures/use-snapshot'
import YAML from 'yaml'

import { COLLECTION_KEY, NAME_FIELDS, RECORD_DIRS, RECORD_TYPES } from '../types/registry'
import type { RecordType } from '../types/registry'
import { buildSnapshot } from './build'
import { SCHEMAS } from './schema'
import { runValidation } from './validate'
import type { CheckResult } from './validate'
import type { Manifest } from './manifest'
import { listBids, snapshot as testFixtureSnapshot } from '../data/selectors'

/**
 * A valid base vault, derived from the shipped records.
 *
 * Hand-written minimal fixtures cannot work here. The importer requires every
 * schema field to be present, not merely every required one, so a fixture with
 * only the required keys fails on the first missing text field long before the
 * gate under test is ever reached. Copying the real records and overriding
 * single fields is the only way to change exactly one thing.
 *
 * The notice is forced to `Multi lot` with two lots, because rule 2 needs a lot
 * structure to bite on; cases that target rule 2 override it.
 */
const REAL = testFixtureSnapshot
const realOf = (type: RecordType, id: string): Record<string, unknown> => {
  const rows = REAL.records[COLLECTION_KEY[type] as keyof typeof REAL.records] as unknown as {
    id: string
    frontmatter: Record<string, unknown>
    file: string
  }[]
  const row = rows.find((r) => r.id === id)
  if (!row) throw new Error(`fixture needs ${id}, which is not in the vault`)
  const frontmatter = Object.fromEntries(
    Object.entries(structuredClone(row.frontmatter)).map(([key, value]) => [
      key,
      NAME_FIELDS[type].includes(key) && typeof value === 'string'
        ? value.replace(/\b(DEMO|FICTIONAL)\b\s*[—–-]?\s*/gi, '')
        : value,
    ]),
  )
  return { ...frontmatter, file: row.file }
}

function baseFiles(bidOverrides: Record<string, unknown> = {}, noticeOverrides: Record<string, unknown> = {}) {
  const bid = realOf('bid', 'BID-001')
  const notice = realOf('notice', 'RFB-002')
  return {
    '02 - Companies/COMP-001 — Test bidder.md': { ...realOf('company', 'COMP-001'), file: undefined },
    '05 - Organizations/ORG-005 — Test buyer — Buyer.md': { ...realOf('organization', 'ORG-005'), file: undefined },
    '09 - Notices/RFB-002 — Test buyer — Test tender.md': {
      ...notice,
      notice_id: 'RFB-001',
      file: undefined,
      lot_structure: 'Multi lot',
      lot_details: ['Lot 1', 'Lot 2'],
      // Pinned rather than inherited. RFB-002's real deadline is 2026-08-19,
      // and a fixture whose behaviour depends on a shipped record's date is a
      // fixture that breaks when that record is edited. Note the field is a
      // date, not a datetime: only the Bid carries the submission *time*.
      bid_submission_deadline: '2026-09-23',
      ...noticeOverrides,
    },
    '10 - Bids/BID-001 — Test bidder on Test tender.md': {
      ...bid,
      file: undefined,
      lot_numbers: ['Lot 1'],
      // Every gate below needs a clean starting point, so the shipped
      // submission facts are cleared rather than inherited.
      bid_status: 'Preparing',
      bid_submission_date: '',
      bid_submission_datetime: '',
      bid_submission_reference: '',
      award_date: '',
      awarded_lot: '',
      awarded_value: '',
      awarded_currency: '',
      required_documents: [],
      completed_documents: [],
      ...bidOverrides,
    },
  } as Record<string, Record<string, unknown>>
}

const NO_MANIFEST: Manifest = { root: '', entries: [], aggregate: '' }

/**
 * Build a throwaway vault, run the full validation pass, and return the
 * results. Every registered directory is created so an absent one is empty
 * rather than missing.
 */
function validateResults(
  files: Record<string, Record<string, unknown>>,
): { results: CheckResult[]; failures: CheckResult[] } {
  const out = validateFiles(files)
  assert.ok(out, 'expected the fixture to build')
  return out
}

/** As above, but tolerating a parse-time rejection and returning null for it. */
function validateFiles(
  files: Record<string, Record<string, unknown>>,
  options: { allowBuildFailure?: boolean } = {},
): { results: CheckResult[]; failures: CheckResult[] } | null {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvb-bid-gate-'))
  try {
    for (const type of RECORD_TYPES) {
      fs.mkdirSync(path.join(root, RECORD_DIRS[type as RecordType]), { recursive: true })
    }
    for (const [rel, frontmatter] of Object.entries(files)) {
      const abs = path.join(root, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, `---\n${YAML.stringify(frontmatter)}---\n\nBody.\n`, 'utf8')
    }
    let built: ReturnType<typeof buildSnapshot>
    try {
      built = buildSnapshot(root)
    } catch (e) {
      // A parse-time rejection is a legitimate outcome for some fixtures: a
      // blank required field never becomes a record, so there is no snapshot to
      // validate. Return null rather than letting the throw escape, so the
      // caller can assert the rejection rather than an exception.
      if (options.allowBuildFailure) return null
      throw e
    }
    return runValidation(built.snapshot, root, NO_MANIFEST, NO_MANIFEST, built.excludedFictionalIds)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

/** Find the single failed check whose label contains `fragment`. */
function failedWith(results: CheckResult[], fragment: string): CheckResult {
  const hits = results.filter((r) => !r.pass && r.name.includes(fragment))
  assert.equal(
    hits.length,
    1,
    `expected exactly one failing check matching "${fragment}", got ${hits.length}: ` +
      JSON.stringify(results.filter((r) => !r.pass).map((r) => r.name)),
  )
  return hits[0]
}

/** Assert a check passed, naming it so a silent rename cannot hide a gap. */
function passes(results: CheckResult[], fragment: string): void {
  const hit = results.find((r) => r.name.includes(fragment))
  assert.ok(hit, `no check matched "${fragment}"`)
  assert.equal(hit.pass, true, `"${hit.name}" should have passed: ${hit.detail}`)
}

/* ------------------------------------------------------------------ *
 * The control case, asserted first. If the base fixture tripped a gate, every
 * negative result below would be meaningless, because a broken base fails
 * everything at once. Unrelated gates may legitimately fire on a synthetic
 * fixture — there is no Source, for instance — so the assertion is scoped to
 * the Bid gates rather than to the whole result set.
 * ------------------------------------------------------------------ */

test('the base fixture trips none of the eight Bid gates', () => {
  const { results } = validateResults(baseFiles())
  const bidGates = [
    'exactly one Company',
    'exactly one Notice',
    'lot_numbers',
    'Eligible—verified',
    'Submitted',
    'cutoff',
    'Awarded',
    'date part',
    'subset',
  ]
  for (const gate of bidGates) {
    const hit = results.find((r) => r.name.includes(gate))
    if (hit) assert.equal(hit.pass, true, `"${hit.name}" failed on the base fixture: ${hit.detail}`)
  }
})

/* ------------------------------------------------------------------ *
 * Rules 1 and 2 — cardinality and the lot biconditional.
 * ------------------------------------------------------------------ */

test('rule 1: a Bid naming an unresolvable Notice fails', () => {
  const { results } = validateResults(baseFiles({ notice: '[[RFB-999 — Does not exist]]' }))
  failedWith(results, 'exactly one Notice')
})

test('rule 1: a Bid naming an unresolvable Company fails', () => {
  const { results } = validateResults(baseFiles({ company: '[[COMP-999 — Does not exist]]' }))
  failedWith(results, 'exactly one Company')
})

test('rule 1: a blank required link is rejected at parse, before any gate runs', () => {
  // Worth stating explicitly, because it means rule 1's "exactly one" has a
  // parse-time half and a resolution-time half. The parser owns the first: a
  // blank required link cannot become a record at all, so there is nothing for
  // the validator to judge.
  const out = validateFiles(baseFiles({ notice: '' }), { allowBuildFailure: true })
  assert.equal(out, null, 'a blank required link is rejected while building, so no snapshot exists')
})

test('rule 2: lots named on a Single lot notice fails', () => {
  const { results } = validateResults(
    baseFiles({ lot_numbers: ['Lot 1'] }, { lot_structure: 'Single lot', lot_details: [] }),
  )
  failedWith(results, 'lot_numbers')
})

test('rule 2: a Multi lot notice bid with no lots named fails', () => {
  const { results } = validateResults(baseFiles({ lot_numbers: [] }))
  failedWith(results, 'lot_numbers')
})

test('rule 2: the correct pairing passes', () => {
  const single = validateResults(baseFiles({ lot_numbers: [] }, { lot_structure: 'Single lot', lot_details: [] }))
  passes(single.results, 'lot_numbers')
  const multi = validateResults(baseFiles({ lot_numbers: ['Lot 1', 'Lot 2'] }))
  passes(multi.results, 'lot_numbers')
})

/* ------------------------------------------------------------------ *
 * Rule 5 — the evidence gate. This is the one that matters most, so it gets
 * the most cases: each of the four requirements is removed on its own, and
 * the fully-populated version is asserted to pass.
 * ------------------------------------------------------------------ */

const VERIFIED_BID = {
  eligibility_status: 'Eligible—verified',
  evidence_notes: 'Checked against the buyer\'s published eligibility criteria.',
  reviewed_by: 'A. Reviewer',
  review_date: '2026-09-10',
}

test('rule 5: Eligible—verified with no evidence notes fails', () => {
  const { results } = validateResults(baseFiles({ ...VERIFIED_BID, evidence_notes: '' }))
  failedWith(results, 'Eligible—verified')
})

test('rule 5: Eligible—verified with no reviewer fails', () => {
  const { results } = validateResults(baseFiles({ ...VERIFIED_BID, reviewed_by: '' }))
  failedWith(results, 'Eligible—verified')
})

test('rule 5: Eligible—verified with no review date fails', () => {
  const { results } = validateResults(baseFiles({ ...VERIFIED_BID, review_date: '' }))
  failedWith(results, 'Eligible—verified')
})

test('rule 5: Eligible—verified with no evidence source fails — free text is not evidence', () => {
  // Every other requirement is met. This is the case that matters: prose alone
  // cannot be checked against anything, so the source reference is required.
  const { results } = validateResults(baseFiles(VERIFIED_BID))
  failedWith(results, 'Eligible—verified')
})

test('rule 5: Eligible—verified passes once a real evidence source is cited', () => {
  const files = {
    ...baseFiles({ ...VERIFIED_BID, evidence_sources: ['[[SRC-001 — Test tender notice]]'] }),
    '06 - Sources/SRC-001 — Test tender notice.md': {
      ...realOf('source', 'SRC-001'),
      file: undefined,
      source_id: 'SRC-001',
      source_name: 'Test tender notice',
      source_url: 'https://example.invalid/tender',
    },
  }
  const { results } = validateResults(files)
  passes(results, 'Eligible—verified')
})

test('rule 5: a Potentially eligible Bid needs no evidence at all', () => {
  const { results } = validateResults(baseFiles())
  passes(results, 'Eligible—verified')
})

/* ------------------------------------------------------------------ *
 * Rules 6, 7 and 10 — submission, the cutoff, and the datetime pair.
 * ------------------------------------------------------------------ */

test('rule 6: Submitted with no submission date fails', () => {
  const { results } = validateResults(baseFiles({ bid_status: 'Submitted' }))
  failedWith(results, 'Submitted')
})

test('rule 6: Submitted against a notice with no stated deadline fails', () => {
  const { results } = validateResults(
    baseFiles({ bid_status: 'Submitted', bid_submission_date: '2026-09-20' }, { bid_submission_deadline: '' }),
  )
  failedWith(results, 'Submitted')
})

test('rule 7: a submission dated after the cutoff may not claim Submitted', () => {
  const { results } = validateResults(
    baseFiles({ bid_status: 'Submitted', bid_submission_date: '2026-09-24' }),
  )
  failedWith(results, 'cutoff')
})

test('rule 7: the same late submission is allowed as Withdrawn', () => {
  const { results } = validateResults(
    baseFiles({ bid_status: 'Withdrawn', bid_submission_date: '2026-09-24' }),
  )
  passes(results, 'cutoff')
})

test('rule 7: a submission on the cutoff date itself is still in time', () => {
  // The deadline is 17:00 on the 23rd, so the 23rd is inside the window. Only
  // the following day is late. A validator using < instead of <= would fail
  // this case, which is exactly why it is written down.
  const { results } = validateResults(
    baseFiles({ bid_status: 'Submitted', bid_submission_date: '2026-09-23' }),
  )
  passes(results, 'cutoff')
})

test('rule 10: a datetime whose date part disagrees with the date fails', () => {
  const { results } = validateResults(
    baseFiles({
      bid_status: 'Submitted',
      bid_submission_date: '2026-09-22',
      bid_submission_datetime: '2026-09-23 09:15 IST',
    }),
  )
  failedWith(results, 'date part')
})

test('rule 10: a matching datetime with a time and zone passes', () => {
  const { results } = validateResults(
    baseFiles({
      bid_status: 'Submitted',
      bid_submission_date: '2026-09-22',
      bid_submission_datetime: '2026-09-22 16:40 IST',
    }),
  )
  passes(results, 'date part')
})

/* ------------------------------------------------------------------ *
 * Rules 8 and 11 — award and the parallel document lists.
 * ------------------------------------------------------------------ */

test('rule 8: Awarded with no award date fails', () => {
  const { results } = validateResults(baseFiles({ bid_status: 'Awarded', awarded_value: 500000 }))
  failedWith(results, 'Awarded')
})

test('rule 8: Awarded with neither a value nor a lot fails', () => {
  const { results } = validateResults(baseFiles({ bid_status: 'Awarded', award_date: '2026-09-30' }))
  failedWith(results, 'Awarded')
})

test('rule 8: an awarded lot outside this bid own lots fails', () => {
  const { results } = validateResults(
    baseFiles({ bid_status: 'Awarded', award_date: '2026-09-30', awarded_lot: 'Lot 7' }),
  )
  failedWith(results, 'Awarded')
})

test('rule 8: an awarded lot drawn from this bid own lots passes', () => {
  const { results } = validateResults(
    baseFiles({ bid_status: 'Awarded', award_date: '2026-09-30', awarded_lot: 'Lot 1' }),
  )
  passes(results, 'Awarded')
})

test('rule 11: a completed document that was never required fails', () => {
  const { results } = validateResults(
    baseFiles({ required_documents: ['Bid security'], completed_documents: ['Bid security', 'Audited accounts'] }),
  )
  failedWith(results, 'subset')
})

test('rule 11: a proper subset passes', () => {
  const { results } = validateResults(
    baseFiles({ required_documents: ['Bid security', 'Audited accounts'], completed_documents: ['Bid security'] }),
  )
  passes(results, 'subset')
})

/* ------------------------------------------------------------------ *
 * Phase 7 — the two defects a subset check cannot see.
 *
 * Each case below is ALSO a valid rule 11 subset. That is the point: the
 * subset rule treats a list as a bag, so a repeated name and a blank name both
 * slip through it. Asserting the subset rule still passes alongside the new
 * gate failing is what shows the new gate is doing independent work rather
 * than restating rule 11.
 * ------------------------------------------------------------------ */

test('phase 7: a repeated required document fails, while rule 11 still passes', () => {
  const { results } = validateResults(
    baseFiles({ required_documents: ['Bid security', 'Bid security'], completed_documents: [] }),
  )
  failedWith(results, 'no repeated name')
  passes(results, 'subset')
})

test('phase 7: a repeated completed document fails', () => {
  const { results } = validateResults(
    baseFiles({
      required_documents: ['Bid security'],
      completed_documents: ['Bid security', 'Bid security'],
    }),
  )
  failedWith(results, 'no repeated name')
})

test('phase 7: a blank document name fails, while rule 11 still passes', () => {
  const { results } = validateResults(
    baseFiles({ required_documents: ['Bid security', '   '], completed_documents: [] }),
  )
  failedWith(results, 'no blank name')
  passes(results, 'subset')
})

test('phase 7: an empty document name fails', () => {
  const { results } = validateResults(
    baseFiles({ required_documents: [''], completed_documents: [''] }),
  )
  failedWith(results, 'no blank name')
})

test('phase 7: distinct, non-blank names pass both gates', () => {
  const { results } = validateResults(
    baseFiles({
      required_documents: ['Bid security', 'Audited accounts'],
      completed_documents: ['Bid security'],
    }),
  )
  passes(results, 'no repeated name')
  passes(results, 'no blank name')
  passes(results, 'subset')
})

test('phase 7: empty document lists are not a defect', () => {
  const { results } = validateResults(baseFiles())
  passes(results, 'no repeated name')
  passes(results, 'no blank name')
})

test('phase 7: a blank mandatory document on a notice fails', () => {
  const { results } = validateResults(baseFiles({}, { mandatory_bid_documents: ['Certificate', ''] }))
  failedWith(results, 'no blank name')
})

/* ------------------------------------------------------------------ *
 * The structural invariant the whole module rests on: procurement never
 * borrows a field from the funding side.
 * ------------------------------------------------------------------ */

test('a Bid carrying an Opportunity, Match or Application link is rejected', () => {
  // Asserted on the schema rather than on a fixture. A hand-added
  // `opportunity:` key cannot demonstrate this: the importer does not carry
  // undeclared fields onto a record, so the key never reaches the validator and
  // the check would pass vacuously. The real guarantee is that the Bid schema
  // declares no funding-side link at all, which is what makes the validator
  // check a belt-and-braces assertion rather than the primary defence.
  const declared = SCHEMAS.bid.map((f) => f.name)
  for (const link of ['opportunity', 'match', 'application']) {
    assert.ok(!declared.includes(link), `Bid must not declare a ${link} field`)
  }

  // And the shipped records carry none either.
  for (const b of listBids()) {
    for (const link of ['opportunity', 'match', 'application']) {
      assert.equal(
        (b.frontmatter as Record<string, unknown>)[link],
        undefined,
        `${b.id} must not link to ${link}`,
      )
    }
  }
})