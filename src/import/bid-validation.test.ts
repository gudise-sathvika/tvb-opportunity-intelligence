/**
 * Bid — the Phase 4 record type.
 *
 * Split out of schema-validation.test.ts rather than appended to it: that file
 * had reached a thousand lines, and the Bid tests are a self-contained body of
 * work that a reader either needs in full or not at all.
 *
 * Three kinds of assertion live here:
 *
 *   1. The schema is the Phase 1 design. 44 field names in design order, six
 *      required, and the kinds — including the two the design deliberately did
 *      not date-type or number-type.
 *   2. The vocabularies are transcribed verbatim, and a near-miss value is
 *      rejected. The near-misses chosen are the axis confusions this module
 *      exists to prevent.
 *   3. The shipped vault is internally consistent, re-asserted here
 *      independently of the importer so a validator bug cannot hide behind
 *      itself.
 *
 * Run with: npm run test:data
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import '../data/test-fixtures/use-snapshot'

import { RECORD_REGISTRY, idFromTarget, idPatternFor } from '../types/registry'
import { SCHEMAS } from './schema'
import { CONTROLLED_VALUES } from './controlled-values'
import { ParseError, checkField } from './parse'
import type { FieldSpec } from './schema'
import { TOTAL_FIELD_PATTERN } from './validate'
import {
  bidsForCompany,
  bidsForNotice,
  bidsForSource,
  companyForBid,
  listBids,
  listRecords,
  noticeForBid,
  sourcesForBid,
  COLLECTION_KEYS,
  snapshot as testFixtureSnapshot,
} from '../data/selectors'

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** A plausible, schema-valid value for every Bid field. */
function validValues(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of SCHEMAS.bid) {
    switch (spec.kind) {
      case 'date':
        out[spec.name] = '2026-01-15'
        break
      case 'number':
        out[spec.name] = 1000
        break
      case 'boolean':
        out[spec.name] = false
        break
      case 'list':
      case 'linkList':
        out[spec.name] = []
        break
      case 'controlled':
        out[spec.name] = CONTROLLED_VALUES[spec.name]?.[0] ?? 'x'
        break
      default:
        out[spec.name] = 'text'
    }
  }
  out.bid_id = 'BID-001'
  return { ...out, ...overrides }
}

/** Every Bid field passes the per-field gate. */
function passesAllFields(overrides: Record<string, unknown> = {}): void {
  const values = validValues(overrides)
  for (const spec of SCHEMAS.bid) checkField(spec, values[spec.name], 'TEST-001')
}

/** Assert the gate rejects, and that the message explains why. */
function rejects(name: string, value: unknown, mustMention: string[]): void {
  const spec = SCHEMAS.bid.find((f) => f.name === name)
  assert.ok(spec, `bid.${name} should exist`)
  const values = validValues({ [name]: value })
  assert.throws(
    () => checkField(spec as FieldSpec, values[name], 'TEST-001'),
    (e: unknown) => {
      assert.ok(e instanceof ParseError, `expected ParseError, got ${String(e)}`)
      const message = (e as Error).message
      for (const part of mustMention) {
        assert.ok(message.includes(part), `message should mention "${part}"; got: ${message}`)
      }
      return true
    },
  )
}

/** The shipped Bids, read once. */
function vaultBids() {
  return testFixtureSnapshot.records.bids
}

/* ------------------------------------------------------------------ */
/* The schema is the design                                             */
/* ------------------------------------------------------------------ */

/**
 * The 44 field names of the Phase 1 section 5 Bid design, in the design's order.
 *
 * Transcribed rather than generated. `deepEqual` against the schema makes an
 * addition, a removal, a rename, or a REORDERING all fail here, which is the
 * point: the order is the template order, and a reader following the template
 * must find the same fields in the same places.
 */
const BID_FIELDS = [
  'bid_id', 'company', 'notice', 'lot_numbers', 'pre_bid_attended',
  'eligibility_status', 'criteria_met', 'criteria_not_met', 'missing_information',
  'evidence_notes', 'evidence_sources', 'reviewed_by', 'review_date',
  'bid_decision', 'bid_decision_date', 'bid_decision_rationale', 'decided_by',
  'bid_status', 'assigned_to', 'next_action', 'next_action_date', 'last_updated',
  'preparation_start_date', 'bid_submission_date', 'bid_submission_datetime',
  'bid_submission_reference', 'technical_score', 'technical_max_score',
  'financial_score', 'financial_max_score', 'quoted_value', 'quoted_currency',
  'clarification_requests', 'security_posted_status', 'security_posted_amount',
  'security_posted_currency', 'required_documents', 'completed_documents',
  'award_date', 'awarded_lot', 'awarded_value', 'awarded_currency',
  'outcome_notes', 'contract_basis',
] as const

/**
 * The six required fields of the Bid design.
 *
 * Phase 1 section 5 says "7 required, 37 optional" in its heading but marks only
 * six rows R: bid_id, company, notice, eligibility_status, bid_decision,
 * bid_status. The table wins over the heading, because a prose count is not a
 * field list. The likely intent of a seventh was `pre_bid_attended`, but that
 * field is a boolean and therefore non-blankable by construction — it can never
 * be empty, so requiring it separately would assert nothing.
 *
 * This pins SIX. If the design is ever corrected to seven, this is the place
 * that changes, deliberately and visibly.
 */
const BID_REQUIRED = [
  'bid_id',
  'company',
  'notice',
  'eligibility_status',
  'bid_decision',
  'bid_status',
] as const

test('Bid has exactly the 44 fields of the Phase 1 design, in order', () => {
  assert.deepEqual(SCHEMAS.bid.map((f) => f.name), [...BID_FIELDS])
  assert.equal(SCHEMAS.bid.length, 44)
})

test('Bid has exactly the six approved required fields', () => {
  assert.deepEqual(SCHEMAS.bid.filter((f) => f.required).map((f) => f.name), [...BID_REQUIRED])
})

test('Bid field kinds match the design, including the two deliberate non-choices', () => {
  const kind = (name: string): string | undefined => SCHEMAS.bid.find((f) => f.name === name)?.kind

  // Identity: one Company and one Notice, each a single link, never a list.
  // Consortiums are deferred (decision D6), so `company` is `link`.
  assert.equal(kind('company'), 'link')
  assert.equal(kind('notice'), 'link')
  assert.equal(kind('lot_numbers'), 'list')
  assert.equal(kind('pre_bid_attended'), 'boolean')

  // Eligibility: Sources are N:N with a Bid, so a linkList.
  assert.equal(kind('evidence_sources'), 'linkList')
  assert.equal(kind('criteria_met'), 'list')
  assert.equal(kind('missing_information'), 'list')

  // The three axes are all `controlled`, which is what makes them three
  // vocabularies rather than three free-text opinions.
  for (const axis of ['eligibility_status', 'bid_decision', 'bid_status'] as const) {
    assert.equal(kind(axis), 'controlled', axis)
  }

  // The two fields Phase 1 deliberately did NOT date-type or number-type.
  // A datetime loses its zone in a date field, and a reference number is an
  // opaque string that must not be coerced to a number.
  assert.equal(kind('bid_submission_datetime'), 'text')
  assert.equal(kind('bid_submission_reference'), 'text')
  assert.equal(kind('quoted_currency'), 'text')

  // Scores are numbers, not text and not dates.
  for (const n of ['technical_score', 'financial_score', 'quoted_value', 'awarded_value']) {
    assert.equal(kind(n), 'number', n)
  }
  for (const n of ['bid_submission_date', 'award_date', 'review_date', 'next_action_date']) {
    assert.equal(kind(n), 'date', n)
  }
  // Both document sides are free-text lists, so the subset rule compares exact
  // strings rather than IDs.
  assert.equal(kind('required_documents'), 'list')
  assert.equal(kind('completed_documents'), 'list')
})

test('Bid IDs use the BID prefix and three digits', () => {
  assert.equal(idPatternFor('bid').source, '^BID-\\d{3}$')
  assert.ok(idPatternFor('bid').test('BID-001'))
  for (const bad of ['BID-01', 'BID-0001', 'bid-001', 'BID_001', 'RFB-001', 'CON-001']) {
    assert.equal(idPatternFor('bid').test(bad), false, bad)
  }
  assert.equal(RECORD_REGISTRY.bid.idField, 'bid_id')
  assert.equal(RECORD_REGISTRY.bid.idPrefix, 'BID')
  assert.equal(RECORD_REGISTRY.bid.recordDir, '10 - Bids')
  // Bid has no name field, so the ID is the label. The registry must say so,
  // because a pluralised guess would render "Bids" as a name on every row.
  assert.deepEqual(RECORD_REGISTRY.bid.nameFields, [])
  assert.equal(RECORD_REGISTRY.bid.titleField, 'bid_id')
})

/* ------------------------------------------------------------------ */
/* The vocabularies                                                     */
/* ------------------------------------------------------------------ */

test('every Bid controlled value is the Phase 1 vocabulary, verbatim', () => {
  // Eligibility is REUSED from Match rather than redeclared: "may this company
  // participate?" is the same question on both sides of the vault, and two
  // vocabularies for it would let the two halves drift apart.
  assert.deepEqual(CONTROLLED_VALUES.eligibility_status, [
    'Not assessed',
    'Potentially eligible',
    'Eligible—verified',
    'Ineligible',
    'Needs more information',
  ])
  assert.deepEqual(CONTROLLED_VALUES.bid_decision, ['Pending', 'Bid', 'No bid', 'Deferred'])
  assert.deepEqual(CONTROLLED_VALUES.bid_status, [
    'Researching',
    'Preparing',
    'Submitted',
    'Opened',
    'Under evaluation',
    'Clarification',
    'Awarded',
    'Not awarded',
    'Withdrawn',
    'Cancelled',
    'On hold',
  ])
  assert.deepEqual(CONTROLLED_VALUES.security_posted_status, [
    'Not required',
    'Not submitted',
    'Submitted',
    'Released',
    'Forfeited',
  ])
  assert.deepEqual(CONTROLLED_VALUES.contract_basis, [
    'Awarded after competitive bid',
    'Single source',
    'Negotiated',
    'Letter of intent',
    'Direct award',
  ])
  // `Opened` is retained even though Phase 1's open-decision set omits it. It is
  // harmless when unused and honest when a sealed tender is actually opened, so
  // dropping it would lose a real state to keep a list tidy.
  assert.ok(CONTROLLED_VALUES.bid_status.includes('Opened'))
  // `contract_basis` is optional here and becomes required on Contract (Phase 6)
  // exactly when `bid` is blank — an award with no bid behind it.
  assert.ok(SCHEMAS.bid.some((f) => f.name === 'contract_basis' && !f.required))
  // The three axes are distinct vocabularies with no value in common except
  // where the overlap is the point.
  const axes = ['eligibility_status', 'bid_decision', 'bid_status'] as const
  assert.equal(new Set(axes.map((a) => CONTROLLED_VALUES[a].join('|'))).size, 3)
})

test('a Bid controlled value outside the Phase 1 vocabulary is rejected', () => {
  rejects('bid_status', 'Pending review', ['not an allowed value', 'Researching'])
  // The near-misses that matter are the axis confusions. `No bid` is the
  // decision, `Submitted` is the lifecycle, `Withdrawn` is neither. Putting any
  // of them on the wrong axis is the specific error this schema must refuse.
  rejects('bid_decision', 'Submitted', ['not an allowed value', 'Bid'])
  rejects('bid_decision', 'Withdrawn', ['not an allowed value', 'No bid'])
  rejects('bid_status', 'No bid', ['not an allowed value', 'Submitted'])
  // The em dash in `Eligible—verified` is not optional.
  rejects('eligibility_status', 'Eligible', ['not an allowed value', 'Eligible—verified'])
  rejects('contract_basis', 'Competitive', ['not an allowed value', 'Single source'])
  rejects('security_posted_status', 'Posted', ['not an allowed value', 'Submitted'])
})

/* ------------------------------------------------------------------ */
/* Required fields and link shape                                       */
/* ------------------------------------------------------------------ */

test('a blank required Bid field is rejected', () => {
  for (const name of BID_REQUIRED) {
    if (name === 'bid_id') continue
    rejects(name, '', ['required', 'blank'])
  }
})

test('company and notice are single links, evidence_sources is a list of them', () => {
  // `company` being a single link is the mechanical form of decision D6. A list
  // of two Companies is a consortium, which is not implemented, so it must be a
  // type error rather than a silently accepted value.
  rejects('company', ['[[COMP-001 — A]]', '[[COMP-002 — B]]'], ['link'])
  rejects('notice', ['[[RFB-001 — A]]', '[[RFB-002 — B]]'], ['link'])
  // The opposite case: many Sources are explicitly allowed, because a bid's
  // eligibility can rest on several documents.
  assert.doesNotThrow(() =>
    passesAllFields({
      company: '[[COMP-001 — A]]',
      notice: '[[RFB-001 — A]]',
      evidence_sources: ['[[SRC-001 — A]]', '[[SRC-002 — B]]'],
    }),
  )
})

test('pre_bid_attended is a boolean, so it cannot be left blank', () => {
  // This is why the design's prose count of seven required fields was not
  // implemented as seven: a boolean is non-blankable anyway.
  rejects('pre_bid_attended', '', ['boolean'])
  rejects('pre_bid_attended', 'yes', ['boolean'])
  assert.doesNotThrow(() => passesAllFields({ pre_bid_attended: false }))
  assert.doesNotThrow(() => passesAllFields({ pre_bid_attended: true }))
})

/* ------------------------------------------------------------------ */
/* The shipped vault is consistent                                      */
/* ------------------------------------------------------------------ */

test('the vault Bids resolve to exactly one real Company and one real Notice', () => {
  const snapshot = testFixtureSnapshot
  const byId = new Map(
    [...snapshot.records.companies, ...snapshot.records.notices].map((r) => [r.id, r.type]),
  )
  const bids = snapshot.records.bids
  assert.ok(bids.length >= 1, 'the Bid directory must hold records')
  for (const b of bids) {
    const company = b.links.fields.company
    const notice = b.links.fields.notice
    assert.equal(company?.length, 1, `${b.id} must name one Company`)
    assert.equal(notice?.length, 1, `${b.id} must name one Notice`)
    assert.equal(company?.[0].unresolved, false, `${b.id} Company must resolve`)
    assert.equal(notice?.[0].unresolved, false, `${b.id} Notice must resolve`)
    // Resolving is not enough: the target must be the right TYPE. A link that
    // happens to resolve to some other record is still a schema error, and this
    // is the assertion that catches it.
    assert.equal(byId.get(company![0].resolvedId ?? ''), 'company', b.id)
    assert.equal(byId.get(notice![0].resolvedId ?? ''), 'notice', b.id)
  }
})

test('Bid carries no Opportunity, Match, or Application link', () => {
  // Phase 1 section 7.2 rules Match out of procurement entirely, and decision
  // D12 keeps the funding and procurement domains apart. A Bid names one
  // Company, one Notice, and zero or more Sources — nothing else.
  for (const b of vaultBids()) {
    assert.deepEqual(
      Object.keys(b.links.fields).sort(),
      ['company', 'evidence_sources', 'notice'],
      `${b.id} may carry only these link fields`,
    )
    const fm = b.frontmatter as unknown as Record<string, unknown>
    for (const banned of ['opportunity', 'match', 'application']) {
      assert.equal(fm[banned], undefined, `${b.id} must not link a ${banned}`)
    }
  }
})

test('the demo Bids are synthetic and say so on the record', () => {
  for (const b of vaultBids()) {
    assert.equal(b.fictional.isFictional, true, `${b.id} must be flagged fictional`)
    assert.equal(b.fictional.ambiguous, false, b.id)
    assert.ok(b.fictional.rules.includes('filename-marker'), b.id)
    // Bid has no name field, so `name-field-marker` cannot fire for it at all.
    // It is caught by the filename, the body banner, and `demo-link` to its
    // fictional Company and Notice — which is exactly why the classifier needs
    // the link rule for this type.
    assert.ok(b.fictional.rules.includes('body-banner'), b.id)
    // `demo-link` is deliberately NOT asserted here, and its absence is correct:
    // the classifier evaluates authored markers first, so a Bid that already has
    // a filename token and a body banner is decided in pass 1 and the link rule
    // never runs. Asserting it would be asserting the weaker classification.
    assert.ok(!b.fictional.rules.includes('demo-link'), `${b.id} should not need the link rule`)
    assert.match(b.body, /FICTIONAL DEMONSTRATION RECORD/, `${b.id} must carry the banner`)
  }
})

test('no synthetic Bid claims verified eligibility', () => {
  // Gate 5, asserted on the real vault rather than only on a fixture. No
  // procurement Source exists in this vault, so no synthetic Bid may reach
  // `Eligible—verified`: doing so would assert a real-world qualification on the
  // strength of prose that cannot be checked against anything.
  for (const b of vaultBids()) {
    assert.notEqual(b.frontmatter.eligibility_status, 'Eligible—verified', b.id)
    assert.deepEqual(b.frontmatter.evidence_sources, [], `${b.id} must cite no evidence`)
  }
  // And the gate holds structurally: at least one Bid sits below the ceiling, so
  // this test is not passing only because nothing was recorded at all.
  const statuses = new Set(vaultBids().map((b) => b.frontmatter.eligibility_status))
  assert.ok(statuses.size >= 2, `expected varied eligibility, got ${[...statuses].join(', ')}`)
})

test('every Bid in the vault satisfies all seven design rules', () => {
  // Re-asserted here independently of the importer, so a validator bug cannot
  // hide behind itself.
  const snapshot = testFixtureSnapshot
  const noticeOf = new Map(snapshot.records.notices.map((n) => [n.id, n]))
  const bids = snapshot.records.bids
  assert.ok(bids.length >= 1)

  for (const b of bids) {
    const fm = b.frontmatter as unknown as Record<string, unknown>
    // Parsed with the importer's own resolver, not an ad-hoc regex. A hand-rolled
    // strip of the brackets would leave "RFB-001 — DEMO — Rooftop..." and miss,
    // which is exactly the kind of private parsing that drifts from the code it
    // is supposed to be checking. `idFromTarget` takes the INNER text, so the
    // brackets come off first, the same way links.ts does it.
    const raw = String(fm.notice).replace(/^\[\[|\]\]$/g, '')
    const noticeId = idFromTarget(raw)
    const notice = noticeId ? noticeOf.get(noticeId) : undefined
    assert.ok(notice, `${b.id} must resolve to a Notice in this vault`)
    const nfm = notice!.frontmatter as unknown as Record<string, unknown>

    // Rule 2, both directions of the biconditional.
    const lots = Array.isArray(fm.lot_numbers) ? (fm.lot_numbers as string[]) : []
    const structure = String(nfm.lot_structure)
    if (structure === 'Multi lot') assert.ok(lots.length > 0, `${b.id} must name a lot`)
    else assert.equal(lots.length, 0, `${b.id} must name no lot on a ${structure} notice`)

    // Rules 6 and 10: a submission asserts a physical fact, and the datetime
    // must agree with the date it is layered on.
    if (fm.bid_status === 'Submitted') {
      assert.ok(String(fm.bid_submission_date).length > 0, `${b.id} needs a submission date`)
      assert.ok(String(nfm.bid_submission_deadline ?? '').length > 0, `${b.id} needs a Notice deadline`)
    }
    if (typeof fm.bid_submission_datetime === 'string' && fm.bid_submission_datetime !== '') {
      assert.equal(
        String(fm.bid_submission_datetime).slice(0, 10),
        String(fm.bid_submission_date),
        `${b.id} datetime and date must agree`,
      )
      assert.match(String(fm.bid_submission_datetime), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/, b.id)
    }

    // Rule 7: never late-and-submitted.
    const deadline = String(nfm.bid_submission_deadline ?? '')
    if (deadline && String(fm.bid_submission_date) > deadline) {
      assert.ok(
        ['Withdrawn', 'Not awarded'].includes(String(fm.bid_status)),
        `${b.id} is late, so its status must be Withdrawn or Not awarded`,
      )
    }

    // Rule 8: an award names a date and something identifiable, and the lot must
    // be one this bid actually named.
    if (fm.bid_status === 'Awarded') {
      assert.ok(String(fm.award_date).length > 0, `${b.id} needs an award date`)
      const hasValue = typeof fm.awarded_value === 'number'
      const hasLot = typeof fm.awarded_lot === 'string' && fm.awarded_lot !== ''
      assert.ok(hasValue || hasLot, `${b.id} needs an awarded value or lot`)
      if (hasLot) {
        assert.ok(lots.includes(fm.awarded_lot as string), `${b.id} won a lot it never bid on`)
      }
    }

    // Rule 11: completed is a subset of required.
    const required = Array.isArray(fm.required_documents) ? (fm.required_documents as string[]) : []
    const completed = Array.isArray(fm.completed_documents) ? (fm.completed_documents as string[]) : []
    for (const d of completed) {
      assert.ok(required.includes(d), `${b.id} completed a document never required: ${d}`)
    }

    // Blank is not zero. A published score of nothing and a score never
    // published are different facts, and 0 asserts the first.
    //
    // Deliberately NOT asserted here: that a stated amount must carry a
    // currency. Phase 1 rule 12 forbids summing across currencies; it does not
    // require every amount to name one, and the shipped records happen to do so
    // rather than being required to. The rule itself is enforced as a schema
    // property - no field can hold a mixed-currency total - and is tested in
    // schema-validation.test.ts.
    for (const amount of ['quoted_value', 'awarded_value', 'security_posted_amount', 'technical_score'] as const) {
      if (typeof fm[amount] === 'number') {
        assert.notEqual(fm[amount], 0, `${b.id}.${amount} must be blank rather than 0`)
      }
    }

    // All three axes populated from their own vocabulary. Deliberately NOT
    // asserted equal to each other: they are supposed to be allowed to disagree.
    for (const axis of ['eligibility_status', 'bid_decision', 'bid_status'] as const) {
      assert.ok(CONTROLLED_VALUES[axis].includes(String(fm[axis])), `${b.id}.${axis} not in vocabulary`)
    }
  }
})

/* ------------------------------------------------------------------ */
/* Cardinality, from the importer's indexes                             */
/* ------------------------------------------------------------------ */

test('the vault demonstrates both sides of every cardinality it claims', () => {
  const rel = testFixtureSnapshot.relationships

  // Notice is 1:N Bid. One notice with two bids is the whole reason Bid is a
  // separate type rather than a field on Notice.
  const multiNotice = Object.entries(rel.noticeToBid).filter(([, ids]) => ids.length > 1)
  assert.ok(multiNotice.length >= 1, 'expected at least one notice with more than one bid')
  for (const [noticeId, ids] of multiNotice) {
    assert.match(noticeId, /^RFB-\d{3}$/)
    // Every listed bid points back at that notice, so the two directions cannot
    // disagree. This is what `bidsForNotice` relies on.
    for (const bidId of ids) assert.equal(rel.bidToNotice[bidId], noticeId)
  }

  // Company is 1:N Bid as well, and the demo data shows one company with two.
  assert.ok(
    Object.values(rel.companyToBid).filter((ids) => ids.length > 1).length >= 1,
    'expected at least one company with more than one bid',
  )

  // Bid is N:1 to both, so these are strings and never arrays.
  for (const bidId of Object.keys(rel.bidToCompany)) {
    assert.equal(typeof rel.bidToCompany[bidId], 'string')
    assert.equal(typeof rel.bidToNotice[bidId], 'string')
  }

  // Bid -> Source is N:N. Every source is pre-seeded with an empty list, so the
  // reverse lookup returns [] rather than undefined — the difference between
  // "no evidence" and "not implemented".
  for (const sourceId of Object.keys(rel.sourceToBid)) {
    assert.deepEqual(rel.sourceToBid[sourceId], [], sourceId)
  }
})

test('the shipped selectors answer from the indexes, not by inference', () => {
  // The Phase 3 placeholder returned [] unconditionally and said so. These are
  // the Phase 4 replacements, and they must read the real indexes.
  const all = COLLECTION_KEYS.flatMap((k) => listRecords(k))
  const row = (id: string) => all.find((r) => r.id === id)

  // One notice really does resolve to several bid rows through the public
  // selector. The expected length comes from the index rather than a literal, so
  // adding a bid to a multi-bid notice updates the index and this assertion
  // follows it instead of failing on a stale constant. RFB-002 is the concrete
  // case and is pinned below at three.
  const rel = testFixtureSnapshot.relationships
  const [noticeId, ids] = Object.entries(rel.noticeToBid).find(([, v]) => v.length > 1) ?? []
  assert.ok(noticeId && ids, 'fixture needs a notice with two bids')
  assert.equal(bidsForNotice(noticeId).length, ids.length)
  assert.deepEqual(bidsForNotice(noticeId).map((r) => r.id), ids)
  // Pinned concretely, and deliberately more than two: RFB-002 carries BID-002,
  // BID-004, and BID-005. Phase 6 added BID-005 so a multi-lot award exists, and
  // it answered on the same demonstration notice.
  assert.equal(noticeId, 'RFB-002')
  assert.deepEqual(ids, ['BID-002', 'BID-004', 'BID-005'])

  // The forward direction resolves through a selector too, to the right types.
  for (const id of ids) {
    assert.equal(noticeForBid(id)?.id, noticeId, id)
    assert.equal(noticeForBid(id)?.type, 'notice', id)
    assert.equal(companyForBid(id)?.type, 'company', id)
    assert.equal(row(id)?.type, 'bid', id)
  }

  // An unknown ID resolves to nothing rather than throwing.
  assert.equal(companyForBid('BID-999'), undefined)
  assert.equal(noticeForBid('BID-999'), undefined)
  assert.deepEqual(bidsForNotice('RFB-999'), [])
  assert.deepEqual(bidsForCompany('COMP-999'), [])
  assert.deepEqual(bidsForSource('SRC-999'), [])
  assert.deepEqual(sourcesForBid('BID-999'), [])

  // No procurement evidence exists, so the selector returns an empty list for
  // every real Bid — an honest answer, and the reason none is verified.
  for (const b of listBids()) {
    assert.deepEqual(sourcesForBid(b.id), [], `${b.id} cites no source`)
    assert.deepEqual(bidsForSource('SRC-001'), [], 'no source is cited by any bid')
  }
})

/* ------------------------------------------------------------------ *
 * Rule 12 as written, and failure paths.
 *
 * Rule 12 in Phase 1 section 7.4 says: "No monetary value is ever summed
 * across currencies. Aggregate views group by currency." It is a rule about
 * totals, not about individual records, so it is enforced as a schema
 * property: the three Bid amounts are separate scalars with three separate
 * currency fields, which is what makes "group by currency" the only way to
 * total them.
 *
 * An earlier version of this work rejected any record whose stated amount
 * lacked a currency. That was a stricter policy than the design states, and it
 * was wrong: a notice that quotes a figure without naming its currency is a
 * gap worth recording honestly, not a record to refuse. The tests below pin
 * the rule to the design's actual wording.
 * ------------------------------------------------------------------ */

test('Rule 12: Bid holds three separate amounts with three separate currency fields', () => {
  const pairs = [
    ['quoted_value', 'quoted_currency'],
    ['security_posted_amount', 'security_posted_currency'],
    ['awarded_value', 'awarded_currency'],
  ] as const

  const kindOf = (name: string): string | undefined => SCHEMAS.bid.find((f) => f.name === name)?.kind
  for (const [amount, currency] of pairs) {
    assert.equal(kindOf(amount), 'number', `${amount} is a single scalar amount`)
    assert.equal(kindOf(currency), 'text', `${currency} is a separate free-text ISO code`)
  }

  // Two amounts sharing one currency field is exactly the shape that invites a
  // mixed-currency total, so the pairing must be one-to-one.
  const currencies = pairs.map(([, c]) => c)
  assert.equal(new Set(currencies).size, currencies.length, 'no currency field is reused')

  const amounts = pairs.map(([a]) => a)
  assert.equal(new Set(amounts).size, amounts.length, 'no amount field is reused')
})

test('Rule 12: neither Bid nor Notice can express a cross-currency total', () => {
  // The check the importer runs, restated independently so a regression in
  // either the schema or the validator is caught here rather than silently.
  for (const type of ['bid', 'notice'] as const) {
    const spec = SCHEMAS[type]
    const offending = spec.filter((f) => TOTAL_FIELD_PATTERN.test(f.name))
    assert.deepEqual(offending, [], `${type} must expose no field that could hold a mixed-currency sum`)
  }

  // And nothing in the shipped records smuggles one in through an undeclared key.
  for (const b of listBids()) {
    const smuggled = Object.keys(b.frontmatter).filter((k) => TOTAL_FIELD_PATTERN.test(k))
    assert.deepEqual(smuggled, [], `${b.id} carries a total-shaped field`)
  }
})
