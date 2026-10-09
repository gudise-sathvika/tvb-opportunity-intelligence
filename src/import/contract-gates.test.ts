/**
 * Contract validator — failure paths.
 *
 * The shipped vault contains only valid records, so it can only ever prove that
 * the gates do not fire on good data. It cannot prove they fire at all. That is
 * what this file is for: each gate is driven with a deliberately broken record in
 * a throwaway vault, and the specific check is asserted to have failed.
 *
 * The pattern throughout is "break exactly one thing". A fixture that trips three
 * gates proves nothing about any of them, so each case names the gate it targets
 * and asserts on that gate's own failure message.
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
import { runValidation } from './validate'
import type { CheckResult } from './validate'
import type { VaultSnapshot } from '../types/records'
import type { Manifest } from './manifest'
import { snapshot as testFixtureSnapshot } from '../data/selectors'

/**
 * A valid base vault, derived from the shipped records.
 *
 * Hand-written minimal fixtures cannot work here. The importer requires every
 * schema field to be present, not merely every required one, so a fixture with
 * only the required keys fails on the first missing text field long before the
 * gate under test is reached. Copying the real records and overriding single
 * fields is the only way to change exactly one thing.
 *
 * The base is a competitive single-lot award: RFB-001, BID-001 awarded to
 * COMP-001, and CON-001 pointing back at that bid with `contract_basis` blank.
 * That is the pairing invariant 3 permits and the one most cases start from.
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

const CONTRACT_PATH = '11 - Contracts/CON-001 — Test contract.md'
const BID_PATH = '10 - Bids/BID-001 — Test bidder on Test tender.md'
const NOTICE_PATH = '09 - Notices/RFB-001 — Test buyer — Test tender.md'
const COMPANY_PATH = '02 - Companies/COMP-001 — Test bidder.md'

/**
 * Multi-lot overrides, applied only by the cases that need them.
 *
 * RFB-001 ships as Single lot, which is the honest starting point for most
 * fixtures. The lot gate and the one-to-many case need a notice with two lots, and
 * they need the bid's own lots known, so both are pinned here rather than
 * inherited — a fixture whose behaviour depends on a shipped record is a fixture
 * that breaks when that record is edited.
 *
 * Rule 2 ties the two together: `lot_numbers` is non-empty exactly when the Notice
 * is Multi lot. So a multi-lot fixture must set both, which is why these overrides
 * are always passed as a pair.
 */
const MULTI_LOT_NOTICE = {
  lot_structure: 'Multi lot',
  number_of_lots: 2,
  lot_details: ['Lot 1', 'Lot 2'],
} as const

const TWO_LOTS = ['Lot 1', 'Lot 2']

function baseFiles(
  contractOverrides: Record<string, unknown> = {},
  bidOverrides: Record<string, unknown> = {},
  noticeOverrides: Record<string, unknown> = {},
) {
  return {
    [COMPANY_PATH]: { ...realOf('company', 'COMP-001'), file: undefined },
    '05 - Organizations/ORG-005 — Test buyer — Buyer.md': {
      ...realOf('organization', 'ORG-005'),
      file: undefined,
    },
    [NOTICE_PATH]: {
      ...realOf('notice', 'RFB-001'),
      file: undefined,
      notice_id: 'RFB-001',
      // Pinned rather than inherited, because several Bid gates compare against the
      // deadline.
      bid_submission_deadline: '2026-09-23',
      lot_structure: 'Single lot',
      number_of_lots: 1,
      lot_details: [],
      ...noticeOverrides,
    },
    [BID_PATH]: {
      ...realOf('bid', 'BID-001'),
      file: undefined,
      notice: '[[RFB-001 — Test buyer — Test tender]]',
      company: '[[COMP-001 — Test bidder]]',
      // Empty, because the base notice is single-lot.
      lot_numbers: [],
      bid_status: 'Awarded',
      award_date: '2026-09-01',
      awarded_lot: '',
      awarded_value: 640000,
      awarded_currency: 'INR',
      // A competitive award records no basis, on both sides of the link.
      contract_basis: '',
      ...bidOverrides,
    },
    [CONTRACT_PATH]: {
      ...realOf('contract', 'CON-001'),
      file: undefined,
      contract_id: 'CON-001',
      notice: '[[RFB-001 — Test buyer — Test tender]]',
      bid: '[[BID-001 — Test bidder on Test tender]]',
      company: '[[COMP-001 — Test bidder]]',
      // No lot, because the base notice is single-lot.
      lot_number: '',
      contract_status: 'Active',
      contract_basis: '',
      ...contractOverrides,
    },
  } as Record<string, Record<string, unknown>>
}

const NO_MANIFEST: Manifest = { root: '', entries: [], aggregate: '' }

/** Write a throwaway vault and return its snapshot. */
function buildSnapshotFrom(files: Record<string, Record<string, unknown>>): VaultSnapshot {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvb-contract-gate-'))
  try {
    for (const type of RECORD_TYPES) {
      fs.mkdirSync(path.join(root, RECORD_DIRS[type as RecordType]), { recursive: true })
    }
    for (const [rel, frontmatter] of Object.entries(files)) {
      const abs = path.join(root, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, `---\n${YAML.stringify(frontmatter)}---\n\nBody.\n`, 'utf8')
    }
    return buildSnapshot(root).snapshot
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

/**
 * Build a throwaway vault, run the full validation pass, and return the results.
 * Every registered directory is created so an absent one is empty rather than
 * missing.
 */
function validateResults(
  files: Record<string, Record<string, unknown>>,
): { results: CheckResult[]; failures: CheckResult[] } {
  const out = validateFiles(files)
  assert.ok(out, 'expected the fixture to build')
  return out
}

/**
 * As above, but tolerating a parse-time rejection and returning null for it.
 *
 * A blank required field never becomes a record, so some fixtures have no snapshot
 * to validate. Returning null lets a caller assert the rejection rather than
 * catching an exception.
 */
function validateFiles(
  files: Record<string, Record<string, unknown>>,
): { results: CheckResult[]; failures: CheckResult[] } | null {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvb-contract-gate-'))
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
    } catch {
      return null
    }
    return runValidation(built.snapshot, root, NO_MANIFEST, NO_MANIFEST, built.excludedFictionalIds)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

/** The single failed check whose label contains `fragment`. */
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

/**
 * The exact Contract gate labels.
 *
 * Spelled out in full rather than matched on a short fragment, because a fragment
 * like "lot" also matches the Notice's own lot-structure check and "Bid" matches
 * several unrelated ones. Using full labels means a rename breaks these tests
 * loudly instead of quietly turning a negative assertion into a no-op.
 */
const GATE = {
  bidOrBasis: 'Rule 3: every Contract has a linked Bid or a non-blank contract_basis',
  parents: 'Rule 3: every Contract resolves exactly one Notice and exactly one Company',
  noDanglingBid: 'Contract.bid is either absent or exactly one resolved Bid — never dangling',
  lot: 'Rule 4: Contract.lot_number is one of the parent Bid lot_numbers',
  noTotal: 'Contract exposes no cross-currency total field (Rule 12)',
  noAwardDate: 'No award date is stored on Contract — Bid.award_date owns it',
  oneToMany: 'Bid 1:0..N Contract — a Bid may produce several Contracts',
  noFundingEdge: 'Contract carries no Opportunity, Match, Application, or Lot link',
} as const

/* ------------------------------------------------------------------ *
 * The control case, asserted first. If the base fixture tripped a gate, every
 * negative result below would be meaningless, because a broken base fails
 * everything at once.
 *
 * Unrelated gates legitimately fire on a synthetic fixture — the documented-anchor
 * check wants Phase 1's demo records, which a four-record vault does not contain —
 * so the assertion is scoped to the eight Contract gates rather than to the whole
 * result set.
 * ------------------------------------------------------------------ */

test('the base fixture trips none of the Contract gates', () => {
  const { results } = validateResults(baseFiles())
  for (const [key, gate] of Object.entries(GATE)) {
    const hit = results.find((r) => r.name === gate)
    assert.ok(hit, `the Contract gate ${key} did not run at all`)
    assert.equal(hit.pass, true, `${key} failed on the base fixture: ${hit.detail}`)
  }
})

/* ------------------------------------------------------------------ *
 * Rule 3 — a bid or a stated reason, never neither.
 * ------------------------------------------------------------------ */

test('rule 3: a Contract with neither a bid nor a contract_basis fails', () => {
  const { results } = validateResults(baseFiles({ bid: '', contract_basis: '' }))
  const check = failedWith(results, GATE.bidOrBasis)
  assert.match(check.detail, /CON-001/)
  assert.match(check.detail, /contract_basis is blank/)
})

test('rule 3: a blank bid with a stated basis passes', () => {
  // The single-source case, and it must be allowed: the field exists precisely so a
  // non-competitive award can be recorded.
  const { results } = validateResults(baseFiles({ bid: '', contract_basis: 'Single source' }))
  passes(results, GATE.bidOrBasis)
})

test("rule 3: a contract_basis that disagrees with the bid's basis fails", () => {
  // One vocabulary, two owners. If the bid says the award was competitive and the
  // contract claims it was a direct award, one of the two records is wrong and the
  // importer cannot guess which, so it refuses.
  const { results } = validateResults(
    baseFiles({ contract_basis: 'Direct award' }, { contract_basis: 'Single source' }),
  )
  const check = failedWith(results, GATE.bidOrBasis)
  assert.match(check.detail, /disagrees/)
})

test('rule 3: a blank bid on a contract whose bid recorded a basis fails', () => {
  // The mirror image: the contract dropped its bid link while the bid still claims
  // a non-competitive reason. Recording a reason on only one side of the link is
  // the same inconsistency.
  const { results } = validateResults(
    baseFiles({ bid: '', contract_basis: '' }, { contract_basis: 'Direct award' }),
  )
  failedWith(results, GATE.bidOrBasis)
})

/* ------------------------------------------------------------------ *
 * Required parents, and the one optional link.
 * ------------------------------------------------------------------ */

test('a Contract whose Notice does not resolve fails', () => {
  const { results } = validateResults(baseFiles({ notice: '[[RFB-999 — Does not exist]]' }))
  const check = failedWith(results, GATE.parents)
  assert.match(check.detail, /CON-001/)
})

test('a Contract whose Company does not resolve fails', () => {
  const { results } = validateResults(baseFiles({ company: '[[COMP-999 — Does not exist]]' }))
  failedWith(results, GATE.parents)
})

test('a Contract naming an optional Bid that does not resolve fails', () => {
  // Optional does not mean unvalidated. A dangling reference is a broken link, not a
  // recorded absence, and conflating the two would let a typo pass silently.
  const { results } = validateResults(baseFiles({ bid: '[[BID-999 — Does not exist]]' }))
  const check = failedWith(results, GATE.noDanglingBid)
  assert.match(check.detail, /CON-001/)
})

test('a blank bid resolves to no Bid and is not an error', () => {
  const { results } = validateResults(baseFiles({ bid: '', contract_basis: 'Direct award' }))
  passes(results, GATE.noDanglingBid)
})

/* ------------------------------------------------------------------ *
 * The lot biconditional.
 * ------------------------------------------------------------------ */

test('a Contract naming a lot its Bid did not bid on fails', () => {
  // The bid bids on Lot 1 and Lot 2, so Lot 3 is the clean near-miss: a lot of the
  // same shape on the same notice, just not one this bid bid on.
  const { results } = validateResults(
    baseFiles({ lot_number: 'Lot 3' }, { lot_numbers: TWO_LOTS }, MULTI_LOT_NOTICE),
  )
  const check = failedWith(results, GATE.lot)
  assert.match(check.detail, /Lot 3/)
})

test('a Contract with no lot passes, because a framework covers the whole notice', () => {
  const { results } = validateResults(baseFiles({ lot_number: '' }))
  passes(results, GATE.lot)
})

test('a lot-less contract with no bid passes', () => {
  // CON-005's shape: a works order called off under a framework, with no lot and no
  // bid. Both blanks are recorded facts, not omissions.
  const { results } = validateResults(
    baseFiles({ lot_number: '', bid: '', contract_basis: 'Direct award' }),
  )
  passes(results, GATE.lot)
  passes(results, GATE.bidOrBasis)
  passes(results, GATE.noDanglingBid)
})

test('a lot named by the bid passes', () => {
  const { results } = validateResults(
    baseFiles({ lot_number: 'Lot 2' }, { lot_numbers: TWO_LOTS }, MULTI_LOT_NOTICE),
  )
  passes(results, GATE.lot)
})

/* ------------------------------------------------------------------ *
 * One-to-many, and the absence of a lot entity.
 * ------------------------------------------------------------------ */

test('one Bid may produce several Contracts, and the reverse index is a list', () => {
  // Two contracts from one bid on different lots of one notice. This is the direction
  // the source corrected from 0..1, so it gets a positive test rather than only
  // negatives.
  const files = baseFiles({ lot_number: 'Lot 1' }, { lot_numbers: TWO_LOTS }, MULTI_LOT_NOTICE)
  files['11 - Contracts/CON-002 — Second contract, second lot.md'] = {
    ...(files[CONTRACT_PATH] as Record<string, unknown>),
    file: undefined,
    contract_id: 'CON-002',
    contract_number: 'DEMO/TEST/002',
    lot_number: 'Lot 2',
  }
  const { results } = validateResults(files)
  passes(results, GATE.oneToMany)
  passes(results, GATE.lot)
  passes(results, GATE.bidOrBasis)
  // The two lots are recorded separately, which is the whole point: a single-valued
  // field could not have held this award.
  assert.deepEqual(buildSnapshotFrom(files).relationships.bidToContract['BID-001'], [
    'CON-001',
    'CON-002',
  ])
})

test('a Contract carrying its five legitimate dates passes the no-award-date gate', () => {
  // The positive half, so the gate cannot be satisfied simply by refusing all dates.
  // A contract legitimately carries signature, start, end, warranty and acceptance.
  const { results } = validateResults(
    baseFiles({
      contract_signature_date: '2026-09-10',
      contract_start_date: '2026-10-01',
      contract_end_date: '2027-09-30',
      warranty_end_date: '2028-03-30',
      acceptance_date: '2027-09-25',
    }),
  )
  passes(results, GATE.noAwardDate)
})

/* ------------------------------------------------------------------ *
 * Fields that are not in the schema.
 *
 * These three gates all scan record frontmatter for keys the schema does not
 * declare. That scan cannot be reached by editing a vault file, because the
 * importer drops undeclared keys before a record exists. The schema is therefore the
 * real enforcement point for all three, and the tests below pin that layering rather
 * than pretending the record-level halves are reachable.
 * ------------------------------------------------------------------ */

test('an undeclared field on a Contract is dropped at build time', () => {
  // Concretely: a hand-added `award_date:` on a contract file is inert, a hand-added
  // `total_contract_value:` is inert, and a hand-added `opportunity:` link is inert.
  const snapshot = buildSnapshotFrom(
    baseFiles({
      award_date: '2026-09-01',
      contract_award_date: '2026-09-01',
      total_contract_value: 1000000,
      opportunity: '[[OPP-001 — Anything]]',
      lot: 'Lot 1',
    }),
  )
  const contract = snapshot.records.contracts[0]
  assert.ok(contract, 'the fixture should produce one Contract')
  const fm = contract.frontmatter as unknown as Record<string, unknown>
  for (const key of [
    'award_date',
    'contract_award_date',
    'total_contract_value',
    'opportunity',
    'lot',
  ]) {
    assert.equal(fm[key], undefined, `${key} must not reach the record`)
  }
  // The declared fields are untouched, so the extras were dropped rather than the
  // record being rebuilt from something else.
  assert.equal(fm.contract_id, 'CON-001')
  assert.equal(fm.contract_number, 'DEMO/NWIC/2026/WQ/047')
})

test('the frontmatter-scanning gates stay green on a file carrying those keys', () => {
  // Following from the test above: the keys are dropped, so these gates cannot be made
  // to fail by editing a vault file. Asserted as passing so the reason is on the
  // record. The reachable guards are the schema-level ones in
  // contract-validation.test.ts.
  const { results } = validateResults(
    baseFiles({
      award_date: '2026-09-01',
      total_contract_value: 1000000,
      opportunity: '[[OPP-001 — Anything]]',
    }),
  )
  passes(results, GATE.noAwardDate)
  passes(results, GATE.noTotal)
  passes(results, GATE.noFundingEdge)
})

test('the currency pairing that makes a bare amount unrepresentable is enforced', () => {
  // `contract_value` is required, and so is its currency. That is what stops a bare
  // amount from existing at all, which is the point of Phase 1 splitting the old
  // compound "contract_value + currency" field into two.
  assert.equal(
    validateFiles(baseFiles({ contract_value: '' })),
    null,
    'a Contract with no contract_value must not build',
  )
  assert.equal(
    validateFiles(baseFiles({ contract_value_currency: '' })),
    null,
    'a Contract with a value but no currency must not build',
  )
  // A guarantee amount with no currency beside it is legitimate, because the source
  // makes only the pair conditional on the amount being present at all.
  const { results } = validateResults(
    baseFiles({ performance_guarantee_required: false, performance_guarantee_amount: '' }),
  )
  passes(results, GATE.noTotal)
})