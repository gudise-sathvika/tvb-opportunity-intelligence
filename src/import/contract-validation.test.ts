/**
 * Contract — the Phase 6 record type.
 *
 * What the Contract IS: the 27 field names in authoritative order, the seven
 * required ones, the kinds, and the four vocabularies transcribed verbatim with
 * their near-misses rejected. What the importer REFUSES lives in
 * `contract-gates.test.ts`.
 *
 * The field list is transcribed rather than generated. `deepEqual` against the
 * schema makes an addition, a removal, a rename, or a REORDERING all fail, which
 * is the point: the order is the template order, and a reader following
 * `07 - Templates/Contract Template.md` must find the same fields in the same
 * places.
 *
 * Several assertions here are deliberately about ABSENCE — that the schema does
 * not constrain the currency fields, that no field invites a total, that no
 * award date crept in. Those are the rules most likely to be "helpfully"
 * implemented in a way the source never asked for.
 *
 * Run with: npm run test:data
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import '../data/test-fixtures/use-snapshot'

import { RECORD_REGISTRY, RECORD_TYPES, idPatternFor } from '../types/registry'
import { SCHEMAS } from './schema'
import { CONTROLLED_VALUES } from './controlled-values'
import { ParseError, checkConstraints, checkField, isBlank } from './parse'
import type { FieldSpec } from './schema'
import { TOTAL_FIELD_PATTERN } from './validate'
import {
  COLLECTION_KEYS,
  snapshot as testFixtureSnapshot,
  bidForContract,
  companyForContract,
  contractsForBid,
  contractsForNotice,
  contractsWithoutBid,
  listContracts,
  noticeForContract,
} from '../data/selectors'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** A plausible, schema-valid value for every Contract field. */
function validValues(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of SCHEMAS.contract) {
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
  out.contract_id = 'CON-001'
  // `bid` is the one optional link, so the default fixture is a competitive
  // award: bid present, basis blank.
  out.contract_basis = ''
  return { ...out, ...overrides }
}

/** Every Contract field passes both the kind gate and the constraint gate. */
function passesAllFields(overrides: Record<string, unknown> = {}): void {
  const values = validValues(overrides)
  for (const spec of SCHEMAS.contract) {
    checkField(spec, values[spec.name], 'TEST-001')
    checkConstraints(spec, values[spec.name], 'TEST-001')
  }
}

/** Assert the per-field gate rejects, and that the message explains why. */
function rejects(name: string, value: unknown, mustMention: string[]): void {
  const spec = SCHEMAS.contract.find((f) => f.name === name)
  assert.ok(spec, `contract.${name} should exist`)
  assert.throws(
    () => checkField(spec as FieldSpec, value, 'TEST-001'),
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

/** The shipped Contracts, read once. */
function vaultContracts() {
  return testFixtureSnapshot.records.contracts
}

/* ------------------------------------------------------------------ */
/* The schema is the design                                            */
/* ------------------------------------------------------------------ */

/**
 * The 27 field names of the Phase 1 section 6 Contract design, in design order.
 *
 * Section 6's own heading says 26. The correction paragraph immediately below it
 * states the total is 27, because `contract_basis` was added to close the gap
 * where a contract could have neither a bid nor a stated reason. 7 required plus
 * 20 optional is 27, which is the arithmetic the source claims, so 27 is what the
 * schema carries. The 26 in the heading is a stale count in prose, not a design.
 */
const CONTRACT_FIELDS = [
  'contract_id',
  'notice',
  'bid',
  'company',
  'lot_number',
  'contract_number',
  'contract_title',
  'contract_value',
  'contract_value_currency',
  'contract_signature_date',
  'contract_start_date',
  'contract_end_date',
  'delivery_scope',
  'milestones',
  'performance_guarantee_required',
  'performance_guarantee_amount',
  'performance_guarantee_currency',
  'performance_security_status',
  'acceptance_status',
  'acceptance_date',
  'payment_status',
  'payment_received_to_date',
  'retention_percentage',
  'warranty_end_date',
  'contract_status',
  'contract_basis',
  'notes',
]

test('the Contract has the 27 authoritative fields, in design order', () => {
  assert.deepEqual(
    SCHEMAS.contract.map((f) => f.name),
    CONTRACT_FIELDS,
  )
})

test('the 27 fields are 7 required and 20 optional', () => {
  // The split the correction paragraph claims. Asserted as a list as well as a
  // count, because "27 fields" alone would also be satisfied by 8 required and
  // 19 optional.
  assert.deepEqual(
    SCHEMAS.contract.filter((f) => f.required).map((f) => f.name),
    [
      'contract_id',
      'notice',
      'company',
      'contract_number',
      'contract_value',
      'contract_value_currency',
      'contract_status',
    ],
  )
  assert.equal(SCHEMAS.contract.length, 27)
  assert.equal(SCHEMAS.contract.filter((f) => f.required).length, 7)
  assert.equal(SCHEMAS.contract.filter((f) => !f.required).length, 20)
})

test('the field kinds match the design', () => {
  const kind = (name: string) => SCHEMAS.contract.find((f) => f.name === name)?.kind
  // Money is a number plus a separate currency field, never a formatted string
  // and never a currency symbol embedded in the amount.
  assert.equal(kind('contract_value'), 'number')
  assert.equal(kind('performance_guarantee_amount'), 'number')
  assert.equal(kind('payment_received_to_date'), 'number')
  assert.equal(kind('retention_percentage'), 'number')
  // The currency fields are plain text. Phase 1 section 6 types them `text` and
  // leaves the controlled column empty, unlike the four status fields which are
  // marked `C`. So the schema must NOT invent a currency list: doing so would
  // reject a legitimate code the source never restricted.
  assert.equal(kind('contract_value_currency'), 'text')
  assert.equal(kind('performance_guarantee_currency'), 'text')
  // Three links: two required parents, one optional.
  assert.equal(kind('notice'), 'link')
  assert.equal(kind('company'), 'link')
  assert.equal(kind('bid'), 'link')
  // The design dated no field as a datetime, because a contract has no clock
  // time worth distinguishing: a signature is a day.
  for (const d of [
    'contract_signature_date',
    'contract_start_date',
    'contract_end_date',
    'acceptance_date',
    'warranty_end_date',
  ]) {
    assert.equal(kind(d), 'date', `${d} should be a date`)
  }
  // Milestones are a list of strings, not a table.
  assert.equal(kind('milestones'), 'list')
  assert.equal(kind('performance_guarantee_required'), 'boolean')
  // And no field is a datetime anywhere in the type.
  assert.equal(
    SCHEMAS.contract.filter((f) => String(f.kind).includes('dateTime')).length,
    0,
    'no Contract field should be a datetime',
  )
})

test('lot_number is a single optional value, not a list', () => {
  // This is the field that makes the Bid relationship one-to-many rather than
  // one-to-one: a single award across two lots is TWO contracts, each with one
  // lot_number. Widening this to a list would quietly make the relationship
  // ambiguous again, so the schema is pinned to a scalar here.
  const spec = SCHEMAS.contract.find((f) => f.name === 'lot_number')
  assert.ok(spec, 'contract.lot_number should exist')
  assert.notEqual(spec.kind, 'list')
  assert.notEqual(spec.kind, 'linkList')
  assert.equal(spec.required, false)
})

test('performance_guarantee_required is optional but can never be blank', () => {
  // Phase 1 does not mark it required, because "no guarantee" is a valid answer.
  // But Boolean kind means blank is rejected: "the buyer requires no guarantee"
  // and "we do not know whether one is required" are different situations, and
  // collapsing them loses the second one.
  const spec = SCHEMAS.contract.find((f) => f.name === 'performance_guarantee_required')
  assert.ok(spec)
  assert.equal(spec.required, false)
  assert.equal(spec.kind, 'boolean')
  rejects('performance_guarantee_required', '', ['Expected boolean'])
  rejects('performance_guarantee_required', 'yes', ['Expected boolean'])
  // Both real answers are accepted, and neither is read as blank.
  passesAllFields({ performance_guarantee_required: true })
  passesAllFields({ performance_guarantee_required: false })
  assert.equal(isBlank(false), false, 'false is a recorded answer, not a blank')
})

test('no Contract field invites a total', () => {
  // Five contracts in two currencies. A field named like a total would invite
  // arithmetic across incompatible units, so the schema must not contain one.
  for (const spec of SCHEMAS.contract) {
    assert.ok(
      !TOTAL_FIELD_PATTERN.test(spec.name),
      `contract.${spec.name} looks like a total, and totals are never aggregated here`,
    )
  }
})

test('no Contract field repeats the award date', () => {
  // Phase 1 replaced the Contract's duplicate `award_date` with
  // `contract_signature_date`, on the stated ground that a fact owned in two
  // places will eventually disagree in two places. Naming any of these would
  // reintroduce the duplication the source removed.
  const forbidden = ['award_date', 'contract_award_date', 'awarded_date', 'awardDate']
  for (const name of CONTRACT_FIELDS) {
    for (const bad of forbidden) {
      assert.notEqual(name, bad, `contract.${bad} must not exist`)
    }
  }
  // And the field that replaced it is present.
  assert.ok(CONTRACT_FIELDS.includes('contract_signature_date'))
})

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

test('the registry describes Contract consistently', () => {
  const cfg = RECORD_REGISTRY.contract
  assert.equal(cfg.idField, 'contract_id')
  assert.equal(cfg.idPrefix, 'CON')
  assert.equal(cfg.collectionKey, 'contracts')
  assert.equal(cfg.collectionPath, 'contracts')
  assert.equal(cfg.label, 'Contract')
  // Declared plural, so the sidebar is not built by guessing a suffix.
  assert.equal(cfg.pluralLabel, 'Contracts')
  assert.equal(cfg.titleField, 'contract_number')
  // titleField must be a real, required field: an optional title would render an
  // empty heading for some records.
  const title = SCHEMAS.contract.find((f) => f.name === cfg.titleField)
  assert.ok(title, 'titleField must exist in the schema')
  assert.equal(title.required, true, 'titleField must be required')
  // The three declared links are exactly the three link fields, in schema order.
  assert.deepEqual(
    cfg.links.map((l) => l.field),
    ['notice', 'bid', 'company'],
  )
  for (const l of cfg.links) {
    assert.equal(l.pointsTo, l.field, `${l.field} should point at its own type`)
    const spec = SCHEMAS.contract.find((f) => f.name === l.field)
    assert.ok(spec, `${l.field} must exist in the schema`)
    assert.equal(spec.kind, 'link')
  }
  // Checked by behaviour rather than by literal, so an equivalent-but-differently
  // written pattern does not fail while a genuinely wrong one still does.
  const pattern = new RegExp(idPatternFor('contract').source)
  assert.ok(pattern.test('CON-001'), 'the pattern must accept a real Contract ID')
  for (const bad of ['CON-1', 'CON-0001', 'contract-001', 'CON-ABC']) {
    assert.ok(!pattern.test(bad), `the pattern must reject ${bad}`)
  }
  assert.ok(COLLECTION_KEYS.includes('contracts'))
})

test('the record directory is 11 - Contracts, and the deviation is deliberate', () => {
  // Phase 1 named folder 09 for Contracts. 09 and 10 were taken by Phases 3 and 4,
  // so Contract went to 11. The vault's own numbering is authoritative and the
  // importer resolves by directory name, so this pins the choice rather than the
  // original number.
  assert.equal(RECORD_REGISTRY.contract.recordDir, '11 - Contracts')
  // Every record type still has a distinct directory.
  const dirs = RECORD_TYPES.map((t) => RECORD_REGISTRY[t].recordDir)
  assert.equal(new Set(dirs).size, dirs.length, 'record directories must be distinct')
})

/* ------------------------------------------------------------------ */
/* Required and optional                                              */
/* ------------------------------------------------------------------ */

test('every required field rejects a blank value', () => {
  // Blank-required is a separate gate from the per-field kind gate: an empty
  // string is a perfectly good `text` value, and only the required flag makes it
  // an error. Both gates are exercised, because a validator holding only one of
  // them would let a required field through.
  for (const spec of SCHEMAS.contract.filter((f) => f.required)) {
    assert.throws(
      () => checkConstraints(spec, '', 'TEST-001'),
      (e: unknown) => {
        assert.ok(e instanceof ParseError)
        assert.match((e as Error).message, /required field is blank/)
        assert.match((e as Error).message, new RegExp(spec.name))
        return true
      },
      `${spec.name} must reject an empty string`,
    )
    // An absent key counts as blank, which is what makes a field genuinely
    // required rather than merely present.
    assert.equal(isBlank(undefined), true)
    assert.throws(() => checkConstraints(spec, undefined, 'TEST-001'), ParseError)
    // A real value passes both gates.
    const values = validValues()
    checkField(spec, values[spec.name], 'TEST-001')
    checkConstraints(spec, values[spec.name], 'TEST-001')
  }
})

test('every optional field accepts a blank value', () => {
  // The mirror image, and the reason the required flag means anything: twenty
  // fields may be blank, and a blanket "reject blanks" rule would make CON-005's
  // honest sparseness impossible to record.
  for (const spec of SCHEMAS.contract.filter((f) => !f.required)) {
    assert.doesNotThrow(
      () => checkConstraints(spec, '', 'TEST-001'),
      `${spec.name} should be allowed to be blank`,
    )
  }
})

test('a blank notice or company is never acceptable', () => {
  // Enforced by the required flag, not by the link kind, so it is asserted
  // separately from the kind gate above.
  for (const name of ['notice', 'company']) {
    const spec = SCHEMAS.contract.find((f) => f.name === name)
    assert.ok(spec)
    assert.throws(() => checkConstraints(spec, '', 'TEST-001'), /required field is blank/)
  }
})

test('the two optional references may be blank because blank is a recorded fact', () => {
  // `bid: ""` means a non-competitive award, and `lot_number: ""` means the
  // instrument covers a whole framework rather than one lot.
  passesAllFields({ bid: '', lot_number: '', contract_basis: 'Direct award' })
  passesAllFields({ bid: '', lot_number: '', contract_basis: 'Single source' })
})

/* ------------------------------------------------------------------ */
/* The four vocabularies                                              */
/* ------------------------------------------------------------------ */

test('the four lifecycle vocabularies are transcribed verbatim', () => {
  // Phase 1 section 6 rows 18, 19, 21 and 25, in the source's own order. The
  // lifecycle lists Completed last because the source lists it last; the ordering
  // is the source's, not a tidy-up.
  assert.deepEqual(CONTROLLED_VALUES.contract_status, [
    'Awarded',
    'Active',
    'Delivered',
    'Accepted',
    'Under dispute',
    'Terminated',
    'Completed',
  ])
  assert.deepEqual(CONTROLLED_VALUES.acceptance_status, [
    'Not applicable',
    'Pending',
    'Under inspection',
    'Accepted',
    'Rejected',
  ])
  assert.deepEqual(CONTROLLED_VALUES.payment_status, [
    'Not started',
    'Partially paid',
    'Fully paid',
    'Withheld',
    'Disputed',
  ])
  assert.deepEqual(CONTROLLED_VALUES.performance_security_status, [
    'Not required',
    'Not submitted',
    'Submitted',
    'Released',
    'Forfeited',
    'Claimed',
  ])
})

test('each lifecycle field is declared controlled, with exactly one vocabulary', () => {
  for (const name of [
    'contract_status',
    'acceptance_status',
    'payment_status',
    'performance_security_status',
  ]) {
    const spec = SCHEMAS.contract.find((f) => f.name === name)
    assert.ok(spec, `${name} should exist`)
    assert.equal(spec.kind, 'controlled', `${name} should be controlled`)
    const values = CONTROLLED_VALUES[name]
    assert.ok(Array.isArray(values) && values.length > 0, `${name} needs a vocabulary`)
    // No duplicates, which would make a filter offer the same value twice.
    assert.equal(new Set(values).size, values.length, `${name} has a duplicate value`)
  }
})

test('the four clocks reject values borrowed from another clock', () => {
  // The confusion this module exists to prevent: filling acceptance_status with
  // a payment value, or contract_status with an acceptance value. Each of these
  // is a real string elsewhere in the module, so a naive implementation that
  // checked "is it some controlled value somewhere" would accept it.
  rejects('acceptance_status', 'Partially paid', ['is not an allowed value'])
  rejects('payment_status', 'Under inspection', ['is not an allowed value'])
  rejects('performance_security_status', 'Delivered', ['is not an allowed value'])
  rejects('contract_status', 'Not started', ['is not an allowed value'])
  rejects('contract_status', 'Award', ['is not an allowed value'])
  rejects('acceptance_status', 'accepted', ['is not an allowed value'])
  rejects('payment_status', 'Fully Paid', ['is not an allowed value'])
})

test('Not applicable is a real answer, distinct from Pending', () => {
  // CON-003 and CON-005 record "Not applicable": no acceptance process is running.
  // It is not a synonym for "not yet", and treating it as one would make an
  // unmolested contract look like a stalled one.
  passesAllFields({ acceptance_status: 'Not applicable' })
  passesAllFields({ acceptance_status: 'Pending' })
  rejects('acceptance_status', 'N/A', ['is not an allowed value'])
  rejects('acceptance_status', 'None', ['is not an allowed value'])
})

test('a blank optional controlled field stays blank and is never filled in', () => {
  // Phase 1 treats blank as "not established". Defaulting it to the first value in
  // the list would silently assert something the record never said, and would put
  // "Not applicable" on every contract that had not been evaluated.
  for (const name of ['acceptance_status', 'payment_status', 'performance_security_status']) {
    const spec = SCHEMAS.contract.find((f) => f.name === name)
    assert.ok(spec)
    assert.equal(spec.required, false, `${name} should be optional`)
    // An explicit blank is a recorded unknown and is allowed. An ABSENT key is
    // not: a controlled field must be present, because "we have not decided" and
    // "nobody wrote this field down" are different, and only the first is
    // expressible as a blank.
    assert.doesNotThrow(() => checkConstraints(spec, '', 'TEST-001'))
    assert.throws(
      () => checkConstraints(spec, undefined, 'TEST-001'),
      /expected one of the controlled values/,
      `${name} must be present as a key, even if blank`,
    )
  }
  // contract_status is the exception: it is required, so blank is an error rather
  // than a recorded unknown. A contract always has a lifecycle position.
  const status = SCHEMAS.contract.find((f) => f.name === 'contract_status')
  assert.ok(status)
  assert.equal(status.required, true)
  assert.throws(() => checkConstraints(status, '', 'TEST-001'), /required field is blank/)
})

test('KNOWN GAP: a whitespace-only value is not treated as blank', () => {
  // `isBlank` compares against the empty string exactly, so a required field
  // holding three spaces passes. This affects every record type, not just
  // Contract, and fixing it would change shared importer behaviour established in
  // earlier phases, so Phase 6 records it rather than silently changing it.
  //
  // It is a real gap: `contract_number: "   "` would be accepted and render as a
  // blank-looking heading. Trimming in `isBlank` is the one-line fix, and it is
  // left as a decision for the owner rather than taken unilaterally mid-phase.
  const spec = SCHEMAS.contract.find((f) => f.name === 'contract_number')
  assert.ok(spec)
  assert.equal(spec.required, true)
  assert.equal(isBlank('   '), false, 'documents the current, gap behaviour')
  assert.doesNotThrow(() => checkConstraints(spec, '   ', 'TEST-001'))
  // The empty string, which is the case that actually occurs in the vault, is
  // still rejected.
  assert.throws(() => checkConstraints(spec, '', 'TEST-001'), /required field is blank/)
})

/* ------------------------------------------------------------------ */
/* Shared vocabulary and simple kinds                                 */
/* ------------------------------------------------------------------ */

test('contract_basis reuses the Bid basis vocabulary rather than declaring a second one', () => {
  assert.deepEqual(CONTROLLED_VALUES.contract_basis, [
    'Awarded after competitive bid',
    'Single source',
    'Negotiated',
    'Letter of intent',
    'Direct award',
  ])
  // Declared once, on both types, under the same name. If either type grew its own
  // list the two could drift and a value valid on a Bid would be rejected on a
  // Contract, which is the exact confusion the validator's cross-type check exists
  // to catch.
  assert.equal(SCHEMAS.contract.filter((f) => f.name === 'contract_basis').length, 1)
  assert.equal(SCHEMAS.bid.filter((f) => f.name === 'contract_basis').length, 1)
  assert.equal(SCHEMAS.contract.find((f) => f.name === 'contract_basis')?.kind, 'controlled')
  assert.equal(SCHEMAS.bid.find((f) => f.name === 'contract_basis')?.kind, 'controlled')
  // And the shipped corpus only ever uses values from that one list.
  for (const c of listContracts()) {
    const v = String(c.frontmatter.contract_basis ?? '')
    if (v === '') continue
    assert.ok(
      (CONTROLLED_VALUES.contract_basis as string[]).includes(v),
      `${c.id} uses contract_basis ${JSON.stringify(v)}, which is not in the shared vocabulary`,
    )
  }
})

test('the currency fields are unconstrained text, because the source says so', () => {
  // Phase 1 types both currency fields `text` with an empty controlled column.
  // The schema therefore imposes no ISO list, and this test pins that absence on
  // purpose: adding a closed list here would be a design change wearing a
  // validation's clothes, and it would reject codes the source never excluded.
  passesAllFields({ contract_value_currency: 'INR', performance_guarantee_currency: 'INR' })
  passesAllFields({ contract_value_currency: 'KES' })
  // What IS enforced is that the currency accompanies the amount, so a reader is
  // never left holding a bare figure.
  const cur = SCHEMAS.contract.find((f) => f.name === 'contract_value_currency')
  assert.ok(cur)
  assert.equal(cur.required, true)
  assert.throws(() => checkConstraints(cur, '', 'TEST-001'), /required field is blank/)
})

test('dates reject a datetime and malformed input', () => {
  rejects('contract_signature_date', '2026-01-15T10:30', ['Unexpected date format'])
  rejects('contract_signature_date', '15/01/2026', ['Unexpected date format'])
  rejects('contract_end_date', 'soon', ['Unexpected date format'])
  // Blank is fine: a contract that has not ended has no end date.
  passesAllFields({ contract_end_date: '', warranty_end_date: '' })
})

test('money fields take a number or a blank, never a formatted string', () => {
  // Phase 1 types these `number` and says nothing about the sign, so the gate
  // enforces the type only. Inventing a non-negative rule here would exceed the
  // source.
  rejects('contract_value', '640000', ['Expected number'])
  rejects('performance_guarantee_amount', 'lots', ['Expected number'])
  rejects('payment_received_to_date', '1,250,000', ['Expected number'])
  // Zero is a number and must not be read as blank.
  passesAllFields({ contract_value: 0, performance_guarantee_amount: 0, payment_received_to_date: 0 })
  // Blank is legitimate for every optional amount: money not yet received is not
  // zero, it is unrecorded, and the two must stay distinguishable.
  passesAllFields({ payment_received_to_date: '', retention_percentage: '' })
  // The money pairs are recorded separately, each with its own currency field.
  assert.deepEqual(
    ['contract_value', 'contract_value_currency', 'performance_guarantee_amount', 'performance_guarantee_currency'].map(
      (n) => SCHEMAS.contract.find((f) => f.name === n)?.kind,
    ),
    ['number', 'text', 'number', 'text'],
  )
})

test('milestones is a list and an empty one is legitimate', () => {
  // A contract with no agreed milestones is a real state, and CON-005 uses it.
  passesAllFields({ milestones: [] })
  passesAllFields({ milestones: ['DEMO milestone 1: 2026-10-15'] })
  rejects('milestones', 'DEMO milestone 1', ['Expected list'])
})

/* ------------------------------------------------------------------ */
/* The shipped vault is internally consistent                          */
/* ------------------------------------------------------------------ */

test('the shipped Contracts re-assert the schema independently of the importer', () => {
  // Same technique as the Bid file: read the real records and re-run both gates,
  // so a validator bug cannot hide behind itself.
  const contracts = vaultContracts()
  assert.ok(contracts.length > 0, 'the vault should ship some Contracts')
  for (const c of contracts) {
    const fm = c.frontmatter as unknown as Record<string, unknown>
    for (const spec of SCHEMAS.contract) {
      checkField(spec, fm[spec.name], c.id)
      checkConstraints(spec, fm[spec.name], c.id)
    }
  }
})

test('every shipped Contract is fictional', () => {
  // No phase has invented a real procurement record, so a real Contract would be a
  // fabrication dressed as data. This asserts the absence rather than any
  // particular marker mechanism.
  for (const c of vaultContracts()) {
    assert.equal(c.fictional.isFictional, true, `${c.id} must be marked fictional`)
  }
})

test('no shipped Contract repeats the award date from its Bid', () => {
  // The working brief suggested moving the award date onto the Contract. The
  // Phase 1 source keeps it on the Bid, and the owner chose to follow the source.
  // This is the regression guard: no Contract may carry an award date under any
  // name, and the Bid must still have its own.
  const forbidden = ['award_date', 'contract_award_date', 'awarded_date', 'awardDate']
  for (const c of vaultContracts()) {
    for (const f of forbidden) {
      assert.equal(
        f in c.frontmatter,
        false,
        `${c.id} must not carry ${f}; the award date belongs to the Bid`,
      )
    }
  }
  // BID-005 is the awarded demonstration bid, so it must still record one.
  const bid = testFixtureSnapshot.records.bids.find((b) => b.id === 'BID-005')
  assert.ok(bid, 'BID-005 should exist')
  assert.notEqual(String(bid.frontmatter.award_date ?? ''), '', 'BID-005.award_date should be recorded')
})

test('both non-competitive award reasons appear in the corpus', () => {
  // Single source and direct award are two recorded reasons a contract can have no
  // bid. A corpus containing only one would not demonstrate that the vocabulary
  // distinguishes them, which is the whole point of the field.
  const reasons = new Set(contractsWithoutBid().map((c) => String(c.frontmatter.contract_basis ?? '')))
  assert.ok(reasons.size >= 2, `expected two distinct reasons, got ${[...reasons].join(', ')}`)
  for (const r of reasons) {
    assert.notEqual(r.trim(), '', 'a no-bid contract must state a reason')
  }
  // And every one of them is blank-bid, which is the invariant being tested.
  for (const c of contractsWithoutBid()) {
    assert.equal(bidForContract(c.id), undefined, `${c.id} is in the no-bid list`)
    assert.notEqual(String(c.frontmatter.contract_basis ?? '').trim(), '')
  }
})

test('one bid produced more than one contract, so 1:N is demonstrated', () => {
  // A corpus where every bid has at most one contract cannot show the one-to-many
  // the source specifies, and a reviewer would have no way to tell the
  // relationship apart from a one-to-one that happens to be unused.
  const counts = new Map<string, number>()
  for (const c of listContracts()) {
    const bid = bidForContract(c.id)
    if (bid) counts.set(bid.id, (counts.get(bid.id) ?? 0) + 1)
  }
  assert.ok(
    [...counts.values()].some((n) => n > 1),
    `no bid produced two contracts: ${JSON.stringify([...counts])}`,
  )
})

test('a contract with a lot names a lot its bid actually bid on', () => {
  // Phase 1 requires this. Re-asserted from the shipped data rather than from the
  // validator, so the rule is checked against the records themselves.
  for (const c of listContracts()) {
    const lot = String(c.frontmatter.lot_number ?? '').trim()
    const bid = bidForContract(c.id)
    if (!bid) {
      assert.equal(lot, '', `${c.id} has no bid, so it must not name a lot`)
      continue
    }
    if (lot === '') continue
    const lots = (bid.frontmatter.lot_numbers as string[] | undefined) ?? []
    assert.ok(
      lots.includes(lot),
      `${c.id} names lot "${lot}", which ${bid.id} did not bid on (${lots.join(', ')})`,
    )
  }
})

test('the required parents of every Contract resolve to the right types', () => {
  for (const c of listContracts()) {
    assert.equal(noticeForContract(c.id)?.type, 'notice', `${c.id} -> Notice`)
    assert.equal(companyForContract(c.id)?.type, 'company', `${c.id} -> Company`)
    const bid = bidForContract(c.id)
    if (bid) assert.equal(bid.type, 'bid', `${c.id} -> Bid`)
  }
})

test('the one-to-many relationships are reachable from both ends', () => {
  for (const c of listContracts()) {
    const fromNotice = contractsForNotice(noticeForContract(c.id)?.id ?? '')
    assert.ok(
      fromNotice.some((x) => x.id === c.id),
      `${c.id} must appear in its Notice's contract list`,
    )
    const bid = bidForContract(c.id)
    if (bid) {
      assert.ok(
        contractsForBid(bid.id).some((x) => x.id === c.id),
        `${c.id} must appear in its Bid's contract list`,
      )
    }
  }
})

test('the mixed-currency corpus is preserved, so the no-total rule is not theoretical', () => {
  // If every contract were in one currency, a total could be computed without
  // anyone noticing the rule exists. CON-005 is the deliberate outlier.
  const currencies = new Set(
    listContracts().map((c) => String(c.frontmatter.contract_value_currency ?? '')),
  )
  assert.ok(currencies.size > 1, `expected mixed currencies, got ${[...currencies].join(', ')}`)
})