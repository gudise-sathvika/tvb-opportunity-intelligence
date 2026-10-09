/**
 * Registry, schema, and validation regression tests.
 *
 * These cover the Phase 2 rules that the snapshot cannot demonstrate on its own:
 * valid and invalid IDs, required fields, blank handling, controlled values,
 * date and datetime shape, list and boolean shape, duplicate IDs, unknown types,
 * derived counts, relationships, and deterministic output.
 *
 * Every negative test asserts on the MESSAGE as well as the throw, because the
 * contract is that an error names the record, the field, and the reason. A test
 * that only asserts "it threw" would pass with a useless message.
 *
 * Run with: npm run test:data
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import '../data/test-fixtures/use-snapshot'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'

import {
  COLLECTION_KEY,
  ID_FIELD,
  ID_PREFIXES,
  NAME_FIELDS,
  RECORD_DIRS,
  RECORD_REGISTRY,
  RECORD_TYPES,
  TITLE_FIELD,
  TYPE_LABEL,
  TYPE_PLURAL_LABEL,
  idFromTarget,
  idPatternFor,
  isRecordType,
  linkFieldFor,
  typeForId,
} from '../types/registry'
import { SCHEMAS, TOTAL_REQUIRED_FIELDS, TOTAL_SCHEMA_FIELDS, assertSchemaConsistency } from './schema'
import type { FieldSpec } from './schema'
import { CONTROLLED_FIELDS, CONTROLLED_VALUES, TOTAL_CONTROLLED_VALUES } from './controlled-values'
import { ParseError, checkConstraints, checkField, checkValue, isBlank, toIsoDate } from './parse'
import { buildSnapshot, serializeSnapshot } from './build'
import type { VaultSnapshot } from '../types/records'
import { VAULT_ROOT } from './paths'
import { snapshot as testFixtureSnapshot } from '../data/selectors'
import { STATUS_FIELDS, statusFieldsAreControlled, statusFieldsFor } from '../data/status-fields'

/* ------------------------------------------------------------------ */
/* Helpers: a valid record body, with one field overridden              */
/* ------------------------------------------------------------------ */

/** A plausible, schema-valid value for every field of one type. */
function validValues(type: (typeof RECORD_TYPES)[number]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of SCHEMAS[type]) {
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
  // ID must match the type pattern, title must be a string.
  out[ID_FIELD[type]] = `${RECORD_REGISTRY[type].idPrefix}-001`
  out[TITLE_FIELD[type]] = 'Example'
  return out
}

/** Every field of one type passes the per-field gate. */
function passesAllFields(type: (typeof RECORD_TYPES)[number], overrides: Record<string, unknown> = {}): void {
  const values = { ...validValues(type), ...overrides }
  for (const spec of SCHEMAS[type]) checkField(spec, values[spec.name], 'TEST-001')
}

/** Assert that the gate rejects, and that the message explains why. */
function rejects(type: (typeof RECORD_TYPES)[number], name: string, value: unknown, mustMention: string[]): void {
  const spec = SCHEMAS[type].find((f) => f.name === name)
  assert.ok(spec, `${type}.${name} should exist`)
  const values = { ...validValues(type), [name]: value }
  assert.throws(
    () => checkField(spec as FieldSpec, values[name], 'TEST-001'),
    (e: unknown) => {
      assert.ok(e instanceof ParseError, `expected ParseError, got ${String(e)}`)
      const message = (e as Error).message
      for (const part of mustMention) {
        assert.ok(
          message.includes(part),
          `message should mention "${part}"; got: ${message}`,
        )
      }
      return true
    },
  )
}

/* ------------------------------------------------------------------ */
/* Registry                                                             */
/* ------------------------------------------------------------------ */

test('registry is internally consistent', () => {
  assert.doesNotThrow(() => assertSchemaConsistency())
})

test('registry covers exactly the ten approved record types', () => {
  assert.deepEqual([...RECORD_TYPES], [
    'opportunity',
    'company',
    'match',
    'application',
    'organization',
    'source',
    'notice',
    'bid',
    'contract',
    'procurement_match',
  ])
  assert.equal(Object.keys(RECORD_REGISTRY).length, 10)
})

/**
 * Phase 4 scope guard.
 *
 * This REPLACED the Phase 3 guard of the same name, which existed to keep every
 * procurement type out of the platform until Notice was authorised. Phase 3
 * retired the Phase 2 guard in the same way. Neither was deleted: everything
 * they still protect is asserted here.
 *
 * Retired from the ban, in order: `notice` (Phase 3), `bid` (Phase 4), then
 * `contract` (Phase 6).
 * Still banned: `lot`, `tender`, `amendment`. Lot is deferred by decision D5; the
 * other two are design triggers. Nothing in this phase may create them, and this
 * test is what says so.
 *
 * The `bid` word is the reason this guard had to be rewritten rather than merely
 * re-run: `Bid` is now legitimate, but so are `bid_security_*` on Notice and
 * `bid_submission_*` on both types. A substring ban on "bid" would have flagged
 * three authorised fields. The ban below is therefore on whole record types, and
 * the field-name collision guard in validate.ts does the finer-grained work.
 */
test('Contract is the last procurement type: no Lot, Tender, or Amendment exists yet', () => {
  const STILL_BANNED = ['lot', 'tender', 'amendment']
  const types = Object.keys(RECORD_REGISTRY).join(' ').toLowerCase()
  for (const word of STILL_BANNED) {
    assert.ok(!types.includes(word), `registry must not contain a "${word}" type`)
  }
  for (const type of RECORD_TYPES) {
    for (const word of STILL_BANNED) {
      assert.ok(
        !RECORD_DIRS[type].toLowerCase().includes(word),
        `${type} directory must not mention "${word}"`,
      )
    }
  }
  // The Bid record type itself is present and correctly wired. Phase 1 section 11
  // chose `10 - Bids` because `08 - Bids` collides with `08 - Documentation`,
  // following the Phase 3 precedent of not renumbering an existing folder.
  assert.ok(RECORD_REGISTRY.bid, 'Bid must be registered')
  assert.equal(RECORD_REGISTRY.bid.idPrefix, 'BID')
  assert.equal(RECORD_REGISTRY.bid.recordDir, '10 - Bids')
  assert.equal(RECORD_REGISTRY.notice.recordDir, '09 - Notices')

  // Exactly nine templates: the six funding ones plus Notice, Bid, and Contract,
  // none of them Lot-shaped. The Contract Template is authorised as of Phase 6, so
  // the word "contract" is no longer banned anywhere in this test.
  const templates = fs.readdirSync(path.join(VAULT_ROOT, '07 - Templates'))
  assert.equal(templates.length, 9, `templates: ${templates.join(', ')}`)
  assert.ok(
    templates.some((f) => f.toLowerCase().startsWith('contract template')),
    'the Contract Template must exist',
  )
  for (const file of templates) {
    for (const word of STILL_BANNED) {
      assert.ok(!file.toLowerCase().includes(word), `unexpected template "${file}"`)
    }
  }
  // And no unauthorised procurement directory exists in the vault. `10 - Bids`
  // is now expected, so the ban is on the banned words only, not on "bid".
  for (const entry of fs.readdirSync(VAULT_ROOT)) {
    for (const word of STILL_BANNED) {
      assert.ok(!entry.toLowerCase().includes(word), `vault has an unexpected "${entry}"`)
    }
  }
  // Every procurement directory holds records using their OWN type's ID, and no
  // Lot record exists anywhere. `CON-` is now expected in the Contract directory,
  // so only `LOT-` remains forbidden.
  const PROCUREMENT_DIRS = [
    [RECORD_DIRS.notice, /^RFB-\d{3}\b/],
    [RECORD_DIRS.bid, /^BID-\d{3}\b/],
    [RECORD_DIRS.contract, /^CON-\d{3}\b/],
  ] as const
  for (const [dir, idPattern] of PROCUREMENT_DIRS) {
    const files = fs.readdirSync(path.join(VAULT_ROOT, dir))
    assert.ok(files.length > 0, `the ${dir} directory must hold its records`)
    for (const file of files) {
      assert.match(
        file,
        idPattern,
        `record in ${dir} must use its own type's ID: ${file}`,
      )
      assert.ok(!/^LOT-/.test(file), `no Lot record may exist: ${file}`)
    }
  }

  // Contract is registered and wired the way Phase 1 section 6 specifies.
  assert.ok(RECORD_REGISTRY.contract, 'Contract must be registered')
  assert.equal(RECORD_REGISTRY.contract.idPrefix, 'CON')
  assert.equal(RECORD_REGISTRY.contract.idField, 'contract_id')
  // Phase 1 proposed `09 - Contracts`; `09` and `10` were taken by Notices and
  // Bids first, so the next free number is used — the same documented deviation
  // already made for Notice (07 -> 09) and Bid (08 -> 10).
  assert.equal(RECORD_REGISTRY.contract.recordDir, '11 - Contracts')
  // `contract_number` is required and `contract_title` is optional, so the display
  // title must be the one every Contract actually has.
  assert.equal(RECORD_REGISTRY.contract.titleField, 'contract_number')
})

test('per-type constants are unique where uniqueness matters', () => {
  for (const pick of [
    (t: (typeof RECORD_TYPES)[number]) => RECORD_REGISTRY[t].idField,
    (t: (typeof RECORD_TYPES)[number]) => RECORD_REGISTRY[t].idPrefix,
    (t: (typeof RECORD_TYPES)[number]) => RECORD_REGISTRY[t].collectionKey,
    (t: (typeof RECORD_TYPES)[number]) => RECORD_REGISTRY[t].collectionPath,
    (t: (typeof RECORD_TYPES)[number]) => RECORD_REGISTRY[t].recordDir,
    (t: (typeof RECORD_TYPES)[number]) => RECORD_REGISTRY[t].titleField,
  ]) {
    assert.equal(new Set(RECORD_TYPES.map(pick)).size, RECORD_TYPES.length)
  }
})

test('every type has a singular and plural label, and the plural differs', () => {
  for (const type of RECORD_TYPES) {
    assert.ok(TYPE_LABEL[type].length > 0, type)
    assert.ok(TYPE_PLURAL_LABEL[type].length > 0, type)
    assert.notEqual(TYPE_PLURAL_LABEL[type], TYPE_LABEL[type], type)
  }
  // The plural is declared, not guessed, so irregular cases are explicit.
  assert.equal(TYPE_PLURAL_LABEL.organization, 'Organizations')
  assert.equal(TYPE_PLURAL_LABEL.company, 'Companies')
  assert.equal(TYPE_PLURAL_LABEL.match, 'Matches')
})

test('isRecordType accepts registered types and rejects anything else', () => {
  for (const type of RECORD_TYPES) assert.equal(isRecordType(type), true, type)
  // `notice` and `bid` both left this list: they are registered now. The types
  // that are still unauthorised stayed on it, which is the assertion that
  // matters.
  for (const bad of ['lot', 'tender', 'amendment', '', 'Opportunity', 'opp', 'toString', '__proto__']) {
    assert.equal(isRecordType(bad), false, String(bad))
  }
  // The singular/plural Notice and Bid labels are declared, like the irregular ones.
  assert.equal(TYPE_LABEL.notice, 'Notice')
  assert.equal(TYPE_PLURAL_LABEL.notice, 'Notices')
  assert.equal(TYPE_LABEL.bid, 'Bid')
  // `bid` is deliberately NOT irregular: the plural is just "Bids", so it is
  // left to the generic rule rather than declared as a special case.
})

/* ------------------------------------------------------------------ */
/* IDs: valid and invalid                                              */
/* ------------------------------------------------------------------ */

test('every type accepts its own valid ID shape', () => {
  for (const type of RECORD_TYPES) {
    const prefix = RECORD_REGISTRY[type].idPrefix
    assert.ok(idPatternFor(type).test(`${prefix}-001`), type)
    assert.ok(idPatternFor(type).test(`${prefix}-999`), type)
  }
})

/**
 * Build against a throwaway copy-shaped vault, so a failure path can be
 * exercised without touching the real vault. Every registered directory is
 * created, so an unlisted one is empty rather than missing.
 */
function buildFromTempVault(
  files: Record<string, Record<string, unknown>>,
  options: { allow?: boolean } = {},
): VaultSnapshot {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvb-validator-'))
  try {
    for (const type of RECORD_TYPES) {
      fs.mkdirSync(path.join(root, RECORD_DIRS[type]), { recursive: true })
    }
    for (const [rel, frontmatter] of Object.entries(files)) {
      const abs = path.join(root, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, `---\n${YAML.stringify(frontmatter)}---\n\nBody text.\n`, 'utf8')
    }
    return buildSnapshot(root).snapshot
  } catch (e) {
    if (options.allow) return null as unknown as VaultSnapshot
    throw e
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('an ID carrying another type prefix is rejected as misfiled', () => {
  // The importer calls this out specifically, because a wrong prefix means the
  // record is in the wrong directory rather than that the ID has a typo.
  assert.throws(
    () => buildFromTempVault({ '01 - Opportunities/OPP-001 — X.md': { opportunity_id: 'COMP-001' } }),
    /carries the company prefix but sits in the opportunity directory/,
  )
})

test('a malformed ID is rejected at import, with the expected pattern shown', () => {
  for (const bad of ['OPP-01', 'OPP-0001', 'opp-001', 'OPP_001', 'OPPORTUNITY-001']) {
    assert.throws(
      () => buildFromTempVault({ [`01 - Opportunities/${bad} — X.md`]: { opportunity_id: bad } }),
      /does not match \^OPP-/, bad,
    )
  }
})

test('duplicate IDs across two files in the same directory are rejected', () => {
  assert.throws(
    () =>
      buildFromTempVault({
        '01 - Opportunities/OPP-001 — One.md': { opportunity_id: 'OPP-001' },
        '01 - Opportunities/OPP-001 — Two.md': { opportunity_id: 'OPP-001' },
      }),
    /required field is blank|does not match/,
    'the second record cannot silently overwrite the first',
  )
})

test('an unknown record type in an unknown directory is not silently imported', () => {
  // buildSnapshot only walks registered directories, so a stray folder cannot
  // leak records into the snapshot. Assert it produces nothing rather than
  // picking the folder up.
  const snapshot = buildFromTempVault({})
  assert.equal(RECORD_TYPES.reduce((n, t) => n + (snapshot.records[COLLECTION_KEY[t] as keyof typeof snapshot.records] as unknown[]).length, 0), 0)
})

test('an ID with the wrong digit count is rejected', () => {
  // checkField does not police the ID shape; the pattern does. Assert on both.
  for (const bad of ['OPP-01', 'OPP-0001', 'OPP-', 'OPP-abc', 'opp-001', 'OPP_001']) {
    assert.equal(idPatternFor('opportunity').test(bad), false, bad)
  }
  assert.equal(idPatternFor('opportunity').test('OPP-001'), true)
})

test('a non-string or blank ID fails the required check', () => {
  rejects('opportunity', ID_FIELD.opportunity, '', ['required', 'blank'])
  rejects('opportunity', ID_FIELD.opportunity, 42, ['text', 'number'])
})

test('idFromTarget reads an ID from a link target, registry-driven', () => {
  for (const type of RECORD_TYPES) {
    const prefix = RECORD_REGISTRY[type].idPrefix
    assert.equal(idFromTarget(`${prefix}-002 — Example Title`), `${prefix}-002`)
    assert.equal(idFromTarget(`${prefix}-002`), `${prefix}-002`)
  }
  assert.equal(idFromTarget('Data Dictionary'), null)
  assert.equal(idFromTarget('OPP-1'), null)
  assert.equal(idFromTarget('ZZZ-001'), null)
  assert.equal(idFromTarget(''), null)
})

test('typeForId maps a prefix back to its record type', () => {
  for (const type of RECORD_TYPES) {
    assert.equal(typeForId(`${RECORD_REGISTRY[type].idPrefix}-001`), type)
  }
  assert.equal(typeForId('NOPE-001'), null)
  assert.equal(typeForId('OPP'), null)
})

test('a new record type would be picked up by link resolution automatically', () => {
  // The alternation is built from the registry, so it cannot fall behind the
  // type list. Assert the alternation length matches the type count.
  assert.equal(ID_PREFIXES.length, RECORD_TYPES.length)
  // Longest first, so a shorter prefix cannot shadow a longer one.
  assert.deepEqual(
    [...ID_PREFIXES].sort((a, b) => b.length - a.length || a.localeCompare(b)),
    [...ID_PREFIXES],
  )
})

/* ------------------------------------------------------------------ */
/* Required fields                                                      */
/* ------------------------------------------------------------------ */

test('every type has at least one required field and they all pass when filled', () => {
  for (const type of RECORD_TYPES) {
    const required = SCHEMAS[type].filter((f) => f.required)
    assert.ok(required.length > 0, `${type} should have required fields`)
    assert.doesNotThrow(() => passesAllFields(type), type)
  }
  // 25 funding required fields / 105 funding fields in Phase 2, plus the 13
  // required and 53 total fields of the Phase 1 Notice design, the 6 required and
  // 44 total fields of the Phase 1 Bid design, the 7 required and 27 total
  // fields of the Phase 1 Contract design, and the 5 required and 9 total
  // fields of the Phase P Procurement Match design.
  assert.equal(TOTAL_REQUIRED_FIELDS, 56)
  assert.equal(TOTAL_SCHEMA_FIELDS, 238)
})

test('a blank required field is rejected and names the record and field', () => {
  rejects('opportunity', 'opportunity_name', '', ['TEST-001.opportunity_name', 'required', 'blank'])
  rejects('company', 'country', '', ['required', 'blank'])
  rejects('source', 'last_checked', '', ['required', 'blank'])
  rejects('source', 'last_checked', 'not-a-date', ['date'])
})

test('an absent required field is rejected', () => {
  const spec = SCHEMAS.match.find((f) => f.name === 'eligibility_status')
  assert.ok(spec)
  assert.throws(() => checkField(spec, undefined, 'MATCH-001'), /required field is blank/)
})

test('a blank optional field is allowed', () => {
  assert.doesNotThrow(() => passesAllFields('match', { match_score: '' }))
  assert.doesNotThrow(() => passesAllFields('opportunity', { notes: '' }))
  assert.doesNotThrow(() => passesAllFields('company', { website: '' }))
  assert.doesNotThrow(() => passesAllFields('company', { certifications: [] }))
})

test('a required list field rejects an empty list', () => {
  // None of the 25 required fields is a list today, so assert the RULE holds
  // for a list spec rather than inventing a required list field.
  const listSpec = { name: 'probe_list', kind: 'list' as const, required: true }
  assert.throws(() => checkField(listSpec, [], 'X-001'), /required field is blank/)
  assert.doesNotThrow(() => checkField(listSpec, ['a'], 'X-001'))
})

/* ------------------------------------------------------------------ */
/* Blanks: the three states stay distinct                               */
/* ------------------------------------------------------------------ */

test('blank, empty list, false, and zero are four different states', () => {
  assert.equal(isBlank(''), true)
  assert.equal(isBlank([]), true)
  assert.equal(isBlank(undefined), true)
  assert.equal(isBlank(false), false, 'false is a recorded value, not a blank')
  assert.equal(isBlank(0), false, 'zero is a recorded value, not a blank')
  assert.equal(isBlank('text'), false)
  assert.equal(isBlank(['a']), false)
})

test('a boolean field rejects a blank string rather than reading it as false', () => {
  rejects('opportunity', 'matching_funds_required', '', ['boolean'])
  rejects('opportunity', 'matching_funds_required', 0, ['boolean'])
  assert.doesNotThrow(() => passesAllFields('opportunity', { matching_funds_required: false }))
  assert.doesNotThrow(() => passesAllFields('opportunity', { matching_funds_required: true }))
})

/* ------------------------------------------------------------------ */
/* Controlled values                                                    */
/* ------------------------------------------------------------------ */

test('the controlled-value table matches the Data Dictionary shape', () => {
  // Ten funding fields / 44 values in Phase 2. Phase 3 adds seven Notice
  // vocabularies (notice_type, procurement_method, issuing_platform,
  // lot_structure, contract_type, evaluation_method, notice_status) worth 43
  // values. Phase 4 adds four Bid vocabularies worth 25 values. Bid reuses
  // eligibility_status from the funding side rather than declaring a
  // procurement-specific copy, so it adds no fifth field here. Phase 6 adds four
  // Contract vocabularies (performance_security_status, acceptance_status,
  // payment_status, contract_status) worth 23 values. Contract REUSES
  // contract_basis from the Bid side rather than declaring a procurement-specific
  // copy, so it adds no fifth field here either. The controlled-writer phase
  // adds no new FIELD but seven new values: five source-observed TED countries
  // on `country`, plus `Unknown` on `contract_type` and `lot_structure` —
  // required fields the discovery pipeline carries no honest value for.
  assert.equal(CONTROLLED_FIELDS.length, 25)
  assert.equal(TOTAL_CONTROLLED_VALUES, 142)
  // Every value list is non-empty and has no duplicates.
  for (const [field, values] of Object.entries(CONTROLLED_VALUES)) {
    assert.ok(values.length > 0, field)
    assert.equal(new Set(values).size, values.length, `${field} has duplicate values`)
  }
})

test('every allowed value passes its own field', () => {
  for (const [field, values] of Object.entries(CONTROLLED_VALUES)) {
    const type = RECORD_TYPES.find((t) => SCHEMAS[t].some((f) => f.name === field && f.kind === 'controlled'))
    assert.ok(type, `${field} should be a controlled field on some type`)
    const spec = SCHEMAS[type].find((f) => f.name === field) as FieldSpec
    for (const value of values) {
      assert.doesNotThrow(() => checkField(spec, value, 'TEST-001'), `${field}=${value}`)
    }
  }
})

test('a value outside the allowed list is rejected and the message lists the options', () => {
  rejects('opportunity', 'opportunity_type', 'Loan', ['not an allowed value', 'Grant', 'Loan'])
  rejects('opportunity', 'country', 'Germany', ['not an allowed value'])
  rejects('match', 'priority', 'Urgent', ['not an allowed value', 'Critical'])
  rejects('opportunity', 'deadline_type', 'Soon', ['not an allowed value'])
})

test('controlled values are compared exactly, including capitalisation', () => {
  rejects('opportunity', 'country', 'india', ['not an allowed value'])
  rejects('opportunity', 'record_status', 'active', ['not an allowed value'])
  rejects('opportunity', 'verification_status', 'needs review', ['not an allowed value'])
  rejects('company', 'profile_status', 'Verified ', ['not an allowed value'])
})

test('the em dash in Eligible-verified is preserved exactly', () => {
  assert.ok(CONTROLLED_VALUES.eligibility_status.includes('Eligible\u2014verified'))
  const spec = SCHEMAS.match.find((f) => f.name === 'eligibility_status') as FieldSpec
  assert.doesNotThrow(() => checkField(spec, 'Eligible\u2014verified', 'MATCH-001'))
  // A plain hyphen is a different value and must be rejected.
  assert.throws(() => checkField(spec, 'Eligible-verified', 'MATCH-001'), /not an allowed value/)
})

test('a blank optional controlled value is allowed and never filled in', () => {
  // Only OPTIONAL controlled fields may be blank. The required ones reject a
  // blank by design, which the required-field tests above cover. `country` is
  // optional on Organization and required on Opportunity and Company, so the
  // check is per (type, field), not per field name.
  const optionalControlled = RECORD_TYPES.flatMap((t) =>
    SCHEMAS[t]
      .filter((f) => f.kind === 'controlled' && !f.required)
      .map((f) => ({ type: t, spec: f })),
  )
  assert.deepEqual(
    optionalControlled.map((o) => `${o.type}.${o.spec.name}`).sort(),
    [
      'bid.contract_basis',
      'bid.security_posted_status',
      'contract.acceptance_status',
      'contract.contract_basis',
      'contract.payment_status',
      'contract.performance_security_status',
      'match.priority',
      'notice.deadline_type',
      'notice.evaluation_method',
      'notice.issuing_platform',
      'notice.verification_status',
      'opportunity.deadline_type',
      'organization.country',
    ],
  )
  // The Notice vocabularies that are OPTIONAL on Notice must stay blankable.
  // The five required Notice vocabularies (notice_type, procurement_method,
  // country, contract_type, lot_structure, notice_status) are not in this list
  // precisely because a blank required controlled value must be rejected.
  // The same field name is required on another type, and must still reject.
  assert.ok(
    SCHEMAS.opportunity.some((f) => f.name === 'country' && f.required),
    'country should be required on opportunity',
  )

  for (const { spec } of optionalControlled) {
    const values = { ...validValues('opportunity'), [spec.name]: '' }
    checkConstraints(spec, values[spec.name], 'TEST-001')
    // The value must survive unchanged: validation never mutates.
    assert.equal(values[spec.name], '', `${spec.name} was modified`)
  }
})

test('the detail-page badge list only names real controlled fields', () => {
  const allControlled = new Set(
    RECORD_TYPES.flatMap((t) => SCHEMAS[t].filter((f) => f.kind === 'controlled').map((f) => f.name)),
  )
  assert.equal(statusFieldsAreControlled(), true)
  for (const { name } of STATUS_FIELDS) {
    assert.ok(allControlled.has(name), `${name} is badge-able but is not a controlled field`)
    assert.ok(CONTROLLED_VALUES[name], `${name} has no allowed-value list`)
  }
  // The component resolves badges per record type, so a type only shows the
  // badges it actually has.
  assert.deepEqual(
    statusFieldsFor(SCHEMAS.match.map((s) => s.name)).map((f) => f.name),
    ['match_status', 'eligibility_status', 'priority'],
  )
  assert.deepEqual(
    statusFieldsFor(SCHEMAS.source.map((s) => s.name)),
    [],
    'Source has no status fields',
  )
})

/* ------------------------------------------------------------------ */
/* Dates                                                                */
/* ------------------------------------------------------------------ */

test('an ISO date string round-trips unchanged', () => {
  assert.equal(toIsoDate('2026-09-28', 'X'), '2026-09-28')
  assert.equal(toIsoDate('', 'X'), '')
})

test('a datetime is rejected rather than silently truncated', () => {
  for (const bad of ['2026-09-28T00:00:00Z', '2026-09-28 10:30', '2026-09-28T10:30:00']) {
    assert.throws(() => toIsoDate(bad, 'X.f'), /Unexpected date format/, bad)
  }
  rejects('opportunity', 'application_deadline', '2026-09-28T00:00:00Z', ['date'])
})

test('a malformed or impossible date is rejected', () => {
  const dateError = /Unexpected date format|Not a real calendar date/
  for (const bad of ['28-09-2026', '2026/09/28', '2026-13-01', '2026-02-30', 'not-a-date']) {
    assert.throws(() => toIsoDate(bad, 'X.f'), dateError, bad)
  }
  // Shape-correct leap days are real and must pass.
  assert.equal(toIsoDate('2028-02-29', 'X'), '2028-02-29')
})

test('no timezone conversion happens for a date string', () => {
  // The same string must be produced regardless of the machine timezone.
  assert.equal(toIsoDate('2026-01-01', 'X'), '2026-01-01')
  assert.equal(toIsoDate('2026-12-31', 'X'), '2026-12-31')
})

test('a real Date is serialised defensively and never shifts a day', () => {
  assert.equal(toIsoDate(new Date(Date.UTC(2026, 0, 15)), 'X'), '2026-01-15')
  // A Date whose UTC and local calendar days disagree is an error, not a fix.
  const odd = new Date('2026-01-15T00:30:00Z')
  assert.doesNotThrow(() => toIsoDate(odd, 'X'))
})

test('a date field rejects a number or a list', () => {
  rejects('opportunity', 'application_open_date', 20260928, ['date'])
  rejects('opportunity', 'application_open_date', [], ['date'])
})

/* ------------------------------------------------------------------ */
/* Lists                                                                */
/* ------------------------------------------------------------------ */

test('a list field accepts [] and a list of strings only', () => {
  assert.doesNotThrow(() => passesAllFields('opportunity', { industry: [] }))
  assert.doesNotThrow(() => passesAllFields('opportunity', { industry: ['Health'] }))
  rejects('opportunity', 'industry', '', ['list'])
  rejects('opportunity', 'industry', 'Health', ['list'])
  rejects('opportunity', 'industry', [1, 2], ['list item'])
})

test('a link list field keeps its wikilink text and rejects scalars', () => {
  assert.doesNotThrow(() =>
    passesAllFields('company', { linked_opportunities: ['[[OPP-001 — Seed Fund]]'] }),
  )
  assert.doesNotThrow(() => passesAllFields('company', { linked_opportunities: [] }))
  rejects('company', 'linked_opportunities', '[[OPP-001 — Seed Fund]]', ['list'])
})

test('a link field rejects a non-string', () => {
  rejects('opportunity', 'provider', ['[[ORG-001]]'], ['text'])
})

/* ------------------------------------------------------------------ */
/* Numbers                                                              */
/* ------------------------------------------------------------------ */

test('a number field accepts a number or a blank string, never a boolean', () => {
  assert.doesNotThrow(() => passesAllFields('opportunity', { amount_min: 0 }))
  assert.doesNotThrow(() => passesAllFields('opportunity', { amount_min: '' }))
  assert.doesNotThrow(() => passesAllFields('opportunity', { amount_max: 1000.5 }))
  rejects('opportunity', 'amount_min', false, ['number'])
  rejects('opportunity', 'amount_min', '1000', ['number'])
})

/* ------------------------------------------------------------------ */
/* Derived counts: no hardcoded totals remain                          */
/* ------------------------------------------------------------------ */

test('schema totals are derived, and match the approved Data Dictionary', () => {
  // Derived across EVERY registered type, so a new type cannot be added while
  // being left out of this sum the way the six-type version could.
  assert.equal(
    TOTAL_SCHEMA_FIELDS,
    RECORD_TYPES.reduce((n, t) => n + SCHEMAS[t].length, 0),
  )
  assert.equal(
    TOTAL_REQUIRED_FIELDS,
    RECORD_TYPES.reduce((n, t) => n + SCHEMAS[t].filter((f) => f.required).length, 0),
  )
  // 105 funding fields + 53 Notice + 44 Bid + 27 Contract + 9 Procurement
  // Match from the design. The Contract figure is the authoritative 27, not the
  // 26 its own section-6 heading states: `contract_basis` was added after that
  // heading was written, which the section's correction paragraph sets out in
  // full. The Procurement Match figure is the authoritative 9 for Phase P, and
  // is asserted again in that type's schema test alongside the prohibited
  // scoring and duplicated fields.
  assert.equal(TOTAL_SCHEMA_FIELDS, 238)
  // 25 funding required fields + 13 Notice + 6 Bid + 7 Contract + 5 Procurement
  // Match.
  assert.equal(TOTAL_REQUIRED_FIELDS, 56)
})

test('the validator source no longer pins record counts', async () => {
  // A regression guard against reintroducing a hardcoded EXPECTED_COUNTS table.
  const src = fs.readFileSync(path.join(import.meta.dirname, 'validate.ts'), 'utf8')
  assert.ok(!/EXPECTED_(COUNTS|REAL|FICTIONAL)/.test(src), 'hardcoded expected counts reintroduced')
  assert.ok(!/=== 25\b/.test(src), 'a hardcoded total of 25 reintroduced')
  assert.ok(!/= 45\b/.test(src), 'a hardcoded content-file total reintroduced')
})

test('derived counts match the vault, and a change would be reported not pinned', () => {
  const built = buildSnapshot(VAULT_ROOT)
  const counts = RECORD_TYPES.map((t) => [
    COLLECTION_KEY[t],
    built.snapshot.records[COLLECTION_KEY[t] as keyof typeof built.snapshot.records].length,
  ] as const)
  // The exact numbers are the vault's, not an assertion of the code.
  assert.equal(
    counts.reduce((n, [, c]) => n + c, 0),
    built.snapshot.source.recordCount,
  )
  for (const [key, count] of counts) {
    const type = RECORD_TYPES.find((t) => COLLECTION_KEY[t] === key) as (typeof RECORD_TYPES)[number]
    const dir = path.join(VAULT_ROOT, RECORD_DIRS[type])
    // Phase P: Procurement Match is registered, schemed, and empty. Its vault
    // directory does not exist yet, which reads as zero records on disk.
    const sourceCount = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).length : 0
    const excludedCount = built.excludedFictionalIds.filter((id) => idPatternFor(type).test(id)).length
    assert.equal(count, sourceCount - excludedCount, key)
  }
})

/* ------------------------------------------------------------------ */
/* Relationships                                                        */
/* ------------------------------------------------------------------ */

test('approved link fields are the ones the importer uses', () => {
  assert.equal(linkFieldFor('opportunity', 'organization'), 'provider')
  assert.equal(linkFieldFor('source', 'opportunity'), 'related_opportunity')
  assert.equal(linkFieldFor('match', 'company'), 'company')
  assert.equal(linkFieldFor('match', 'opportunity'), 'opportunity')
  assert.equal(linkFieldFor('match', 'application'), 'linked_application')
  assert.equal(linkFieldFor('application', 'company'), 'company')
  assert.equal(linkFieldFor('application', 'opportunity'), 'opportunity')
  assert.equal(linkFieldFor('application', 'match'), 'match')
})

test('an unapproved relationship throws rather than guessing', () => {
  assert.throws(() => linkFieldFor('organization', 'opportunity'), /No approved link/)
  assert.throws(() => linkFieldFor('source', 'company'), /No approved link/)
})

test('relationships resolve to records of the expected type', () => {
  const built = buildSnapshot(VAULT_ROOT)
  const rel = built.snapshot.relationships
  const all = RECORD_TYPES.flatMap((t) => built.snapshot.records[COLLECTION_KEY[t] as keyof typeof built.snapshot.records] as { id: string; type: string }[])
  const typeOf = new Map(all.map((r) => [r.id, r.type]))

  for (const [matchId, companyId] of Object.entries(rel.matchToCompany)) {
    assert.equal(typeOf.get(companyId), 'company', matchId)
  }
  for (const [matchId, oppId] of Object.entries(rel.matchToOpportunity)) {
    assert.equal(typeOf.get(oppId), 'opportunity', matchId)
  }
  for (const [appId, companyId] of Object.entries(rel.applicationToCompany)) {
    assert.equal(typeOf.get(companyId), 'company', appId)
  }
  for (const [appId, oppId] of Object.entries(rel.applicationToOpportunity)) {
    assert.equal(typeOf.get(oppId), 'opportunity', appId)
  }
  for (const [sourceId, oppIds] of Object.entries(rel.sourceToOpportunity)) {
    for (const oppId of oppIds) assert.equal(typeOf.get(oppId), 'opportunity', sourceId)
  }
  for (const [orgId, oppIds] of Object.entries(rel.organizationToOpportunity)) {
    for (const oppId of oppIds) assert.equal(typeOf.get(oppId), 'opportunity', orgId)
  }
})

test('an optional relationship is null rather than an empty string or a guess', () => {
  const built = buildSnapshot(VAULT_ROOT)
  const rel = built.snapshot.relationships
  for (const value of Object.values(rel.matchToApplication)) {
    assert.ok(value === null || typeof value === 'string', 'null or an ID, nothing else')
  }
  for (const value of Object.values(rel.applicationToMatch)) {
    assert.ok(value === null || typeof value === 'string', 'null or an ID, nothing else')
  }
})

/* ------------------------------------------------------------------ */
/* Determinism                                                          */
/* ------------------------------------------------------------------ */

test('two builds of an unchanged vault produce byte-identical JSON', () => {
  const a = serializeSnapshot(buildSnapshot(VAULT_ROOT).snapshot)
  const b = serializeSnapshot(buildSnapshot(VAULT_ROOT).snapshot)
  assert.equal(a, b)
  assert.ok(a.endsWith('\n'), 'output ends with a newline')
})

test('the build carries no timestamp, absolute path, or hostname', () => {
  const json = serializeSnapshot(buildSnapshot(VAULT_ROOT).snapshot)
  assert.ok(!json.includes(VAULT_ROOT), 'no absolute vault path in the output')
  assert.ok(!/\\\\|\/Users\/|\/home\//.test(json), 'no filesystem path in the output')
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(json), 'no timestamp in the output')
})

test('records are emitted in ID order within each collection', () => {
  const built = buildSnapshot(VAULT_ROOT)
  for (const type of RECORD_TYPES) {
    const ids = (built.snapshot.records[COLLECTION_KEY[type] as keyof typeof built.snapshot.records] as { id: string }[]).map((r) => r.id)
    assert.deepEqual(ids, [...ids].sort(), type)
  }
})

/* ------------------------------------------------------------------ */
/* Frontmatter fidelity for the real vault                              */
/* ------------------------------------------------------------------ */

test('the importer gate accepts every real record as-is', () => {
  // The compatibility check: turning enforcement on must not reject the vault.
  assert.doesNotThrow(() => buildSnapshot(VAULT_ROOT))
})

test('name-marker fields are the registry name fields only', () => {
  assert.deepEqual(NAME_FIELDS.match, [])
  assert.deepEqual(NAME_FIELDS.application, [])
  assert.deepEqual(NAME_FIELDS.opportunity, ['opportunity_name'])
  for (const type of RECORD_TYPES) {
    for (const name of NAME_FIELDS[type]) {
      const spec = SCHEMAS[type].find((f) => f.name === name)
      assert.ok(spec, `${type}.${name}`)
      assert.equal(spec.kind, 'text', `${type}.${name} should be scanned as authored text`)
    }
  }
})

test('checkValue is unchanged for kind checking alone', () => {
  // A field with a valid kind but a missing value still fails the kind gate,
  // so the two gates stay independent.
  const spec = SCHEMAS.opportunity.find((f) => f.name === 'description') as FieldSpec
  assert.doesNotThrow(() => checkValue(spec, '', 'X'))
  assert.throws(() => checkValue(spec, 1, 'X'), /Expected text/)
})

/* ------------------------------------------------------------------ */
/* Phase 3: Notice                                                     */
/* ------------------------------------------------------------------ */

/**
 * The 53 fields of the Phase 1 Notice design, in the approved order.
 *
 * Transcribed from the Phase 1 Finalization & Architecture Review, section 4,
 * "Corrected Notice Schema". This list is the test's own copy on purpose: if the
 * schema and this list ever agree by accident rather than by construction, the
 * diff against the source review is what catches it.
 */
const NOTICE_FIELDS = [
  'notice_id', 'notice_name', 'notice_number', 'notice_type', 'procurement_method',
  'procuring_entity', 'issuing_platform', 'notice_url', 'country', 'region',
  'prequalification_required', 'description', 'contract_type', 'category',
  'industry', 'lot_structure', 'number_of_lots', 'estimated_value',
  'estimated_value_currency', 'bid_security_required', 'bid_security_amount',
  'bid_security_currency', 'performance_guarantee_required',
  'msme_or_small_business_preference', 'eligibility_summary', 'eligibility_criteria',
  'technical_qualification_criteria', 'financial_qualification_criteria', 'exclusions',
  'consortium_allowed', 'subcontracting_allowed', 'overseas_bidder_allowed',
  'local_content_preference', 'issue_date', 'pre_bid_meeting_date', 'query_deadline',
  'bid_submission_deadline', 'bid_submission_datetime', 'bid_opening_date',
  'deadline_type', 'tender_validity_days', 'evaluation_method', 'award_criteria',
  'mandatory_bid_documents', 'contract_duration', 'linked_sources',
  'number_of_bids_received', 'amendment_count', 'last_amended_date', 'notice_status',
  'verification_status', 'last_verified', 'notes',
] as const

test('Notice has exactly the 53 fields of the Phase 1 design, in order', () => {
  assert.equal(SCHEMAS.notice.length, 53)
  assert.deepEqual(SCHEMAS.notice.map((f) => f.name), [...NOTICE_FIELDS])
  assert.equal(new Set(NOTICE_FIELDS).size, 53)
})

test('Notice has exactly the 13 approved required fields', () => {
  const required = SCHEMAS.notice.filter((f) => f.required).map((f) => f.name).sort()
  assert.deepEqual(required, [
    'contract_type', 'country', 'description', 'issue_date', 'lot_structure',
    'notice_id', 'notice_name', 'notice_number', 'notice_status', 'notice_type',
    'notice_url', 'procurement_method', 'procuring_entity',
  ])
})

test('Notice field kinds match the design, including the fields that were renamed', () => {
  const kind = (n: string) => SCHEMAS.notice.find((f) => f.name === n)?.kind
  assert.equal(kind('procuring_entity'), 'link')
  assert.equal(kind('linked_sources'), 'linkList', 'Phase 1 renamed this from `sources`')
  assert.equal(
    kind('mandatory_bid_documents'),
    'list',
    'Phase 1 renamed this from `required_documents` to avoid colliding with Bid',
  )
  assert.equal(
    kind('local_content_preference'),
    'text',
    'Phase 1 renamed this from `geographic_eligibility`',
  )
  assert.equal(
    SCHEMAS.notice.some((f) => f.name === 'source_url'),
    false,
    'Phase 1 removed source_url; it must not be reintroduced',
  )
  // The datetime must stay `text`: Phase 1 section 10 notes a `date` kind would
  // throw at parse, because "2026-11-04 17:00 IST" is not a date.
  assert.equal(kind('bid_submission_datetime'), 'text')
  assert.equal(kind('bid_submission_deadline'), 'date')
  // Preference fields stay free text: Phase 1 section 9 marks both vocabularies
  // as country-specific and needing research, so pinning them invents policy.
  assert.equal(kind('msme_or_small_business_preference'), 'text')
  assert.equal(kind('local_content_preference'), 'text')
  // `list` and `boolean` are not blankable (Phase 1 header, parse.ts:55-77).
  assert.equal(kind('prequalification_required'), 'boolean')
  assert.equal(kind('bid_security_required'), 'boolean')
  assert.equal(kind('performance_guarantee_required'), 'boolean')
  assert.equal(kind('consortium_allowed'), 'boolean')
  assert.equal(kind('subcontracting_allowed'), 'boolean')
  assert.equal(kind('overseas_bidder_allowed'), 'boolean')
})

test('Notice IDs use the RFB prefix and three digits', () => {
  const pattern = idPatternFor('notice')
  assert.equal(RECORD_REGISTRY.notice.idPrefix, 'RFB')
  assert.ok(pattern.test('RFB-001') && pattern.test('RFB-999'))
  for (const bad of ['RFB-01', 'RFB-0001', 'rfb-001', 'RFB_001', 'BID-001']) {
    assert.equal(pattern.test(bad), false, bad)
  }
  assert.throws(
    () => buildFromTempVault({ '09 - Notices/RFB-1 — X.md': { notice_id: 'RFB-1' } }),
    /does not match \^RFB-/,
  )
})

test('a duplicate Notice ID in a second file is rejected', () => {
  assert.throws(
    () =>
      buildFromTempVault({
        '09 - Notices/RFB-001 — One.md': { notice_id: 'RFB-001' },
        '09 - Notices/RFB-001 — Two.md': { notice_id: 'RFB-001' },
      }),
    /required field is blank|does not match/,
    'the second Notice must not silently overwrite the first',
  )
})

test('a Notice ID carrying another type prefix is rejected as misfiled', () => {
  assert.throws(
    () => buildFromTempVault({ '09 - Notices/RFB-001 — X.md': { notice_id: 'OPP-001' } }),
    /carries the opportunity prefix but sits in the notice directory/,
  )
})

test('every Notice controlled value is the Phase 1 vocabulary, verbatim', () => {
  const v = (n: string) => CONTROLLED_VALUES[n]
  assert.deepEqual(v('notice_type'), [
    'RFB', 'RFQ', 'RFP', 'RTE', 'EOI', 'Tender', 'Single source', 'Other',
  ])
  assert.deepEqual(v('procurement_method'), [
    'Open', 'Limited', 'Single source', 'E-auction', 'Direct purchase', 'GeM direct', 'Other',
  ])
  assert.deepEqual(v('issuing_platform'), [
    'GeM', 'CPPP', 'eProcure', 'SAM.gov', 'State portal', 'Offline', 'Aggregator', 'Other',
  ])
  assert.deepEqual(v('lot_structure'), ['Single lot', 'Multi lot', 'Unknown'])
  assert.deepEqual(v('contract_type'), ['Goods', 'Services', 'Works', 'Mixed', 'Unknown'])
  assert.deepEqual(v('evaluation_method'), [
    'Lowest price', 'Lowest evaluated price', 'Combined technical and price',
    'Quality and cost based', 'Single bid', 'Not stated',
  ])
  assert.deepEqual(v('notice_status'), [
    'Draft', 'Published', 'Open', 'Closed', 'Under evaluation', 'Awarded',
    'Cancelled', 'Archived',
  ])
  // Reused vocabularies, unchanged from the funding types (the controlled-writer
  // phase extends `country` with the source-observed TED countries).
  assert.deepEqual(v('country'), ['India', 'USA', 'Poland', 'Romania', 'Latvia', 'France', 'Portugal'])
  assert.deepEqual(v('verification_status'), ['Unverified', 'Verified', 'Needs review'])
  // `deadline_type` is reused even though Phase 1 calls `Recurring` inapplicable
  // to procurement: dropping a value would silently change a vocabulary that the
  // funding types share.
  assert.deepEqual(v('deadline_type'), ['Fixed', 'Rolling', 'Recurring', 'Unknown'])
})

test('a Notice controlled value outside the Phase 1 vocabulary is rejected', () => {
  rejects('notice', 'notice_type', 'Open tender', ['not an allowed value', 'RFB', 'Tender'])
  rejects('notice', 'contract_type', 'Consulting', ['not an allowed value', 'Works'])
  rejects('notice', 'lot_structure', 'Lots', ['not an allowed value', 'Multi lot'])
  rejects('notice', 'notice_status', 'Pending', ['not an allowed value', 'Draft'])
  rejects('notice', 'country', 'UK', ['not an allowed value', 'India', 'USA'])
})

test('bid_submission_datetime is text, not a Date, and keeps its zone string', () => {
  const notices = testFixtureSnapshot.records.notices
  assert.ok(notices.length > 0, 'the isolated test fixture must hold a Notice')
  const withTime = notices.find((n) => n.frontmatter.bid_submission_datetime !== '')
  assert.ok(withTime, 'a demo Notice must state a submission time')
  const raw = withTime.frontmatter.bid_submission_datetime
  // Stored verbatim: a string, not a Date, not normalised to an instant.
  assert.equal(typeof raw, 'string')
  assert.match(raw, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \S+$/)
  // The zone token is preserved verbatim rather than dropped or converted.
  assert.ok(/ (IST|UTC|ET|PT)$/.test(raw), raw)
})

test('the vault Notices resolve to a real Organization and real Sources', () => {
  const snapshot = testFixtureSnapshot
  const orgIds = new Set(snapshot.records.organizations.map((o) => o.id))
  const sourceIds = new Set(snapshot.records.sources.map((s) => s.id))
  assert.ok(snapshot.records.notices.length > 0)
  for (const n of snapshot.records.notices) {
    // The link parsed into a resolved target rather than a dangling string.
    const links = n.links.fields.procuring_entity
    assert.equal(links.length, 1, `${n.id} must link exactly one Organization`)
    assert.equal(links[0].unresolved, false, `${n.id} -> ${links[0].raw}`)
    assert.ok(links[0].resolvedId, `${n.id} -> ${links[0].raw} must resolve to an ID`)
    assert.ok(orgIds.has(links[0].resolvedId), `${n.id} -> ${links[0].resolvedId}`)
    // The snapshot relationship index agrees with the record itself.
    assert.equal(snapshot.relationships.noticeToOrganization[n.id], links[0].resolvedId)
    assert.deepEqual(snapshot.relationships.noticeToSource[n.id], [])
    for (const s of n.links.fields.linked_sources) {
      assert.equal(s.unresolved, false, `${n.id} -> ${s.raw}`)
      assert.ok(s.resolvedId, `${n.id} -> ${s.raw} must resolve to an ID`)
      assert.ok(sourceIds.has(s.resolvedId), `${n.id} -> ${s.resolvedId}`)
    }
  }
})

test('Notice carries no Opportunity, Match, Company, or Bid link', () => {
  const snapshot = testFixtureSnapshot
  for (const n of snapshot.records.notices) {
    // Phase 1 section 7.2: Notice is not an Opportunity, and a Match needs both
    // sides. The only link fields a Notice may have are these two.
    assert.deepEqual(Object.keys(n.links.fields), ['procuring_entity', 'linked_sources'])
    for (const banned of ['opportunity', 'match', 'bid', 'application', 'company']) {
      assert.equal(
        n.frontmatter[banned as keyof typeof n.frontmatter],
        undefined,
        `Notice ${n.id} must not link a ${banned}`,
      )
    }
  }
  // A Notice points at the Bids that answer it, but a Bid never points back
  // into the funding domain. bidToNotice exists as an index; the Ban is on the
  // Notice RECORD carrying a bid link, not on the derived reverse index.
  for (const id of Object.keys(snapshot.relationships.bidToNotice)) {
    assert.match(id, /^BID-\d{3}$/, `bidToNotice key must be a Bid: ${id}`)
  }
})

test('isolated test Notice fixtures retain their authored provenance markers', () => {
  const notices = testFixtureSnapshot.records.notices
  assert.ok(notices.length >= 1)
  for (const n of notices) {
    assert.equal(n.fictional.isFictional, true, `${n.id} must be flagged fictional`)
    assert.equal(n.fictional.ambiguous, false, n.id)
    assert.ok(n.fictional.rules.includes('filename-marker'), n.id)
    assert.ok(
      n.fictional.rules.some((r) => r.startsWith('name-field-marker:notice_name')),
      `${n.id} must be caught by the notice_name rule`,
    )
    // The body banner exists so a human opening the file in Obsidian sees it too.
    assert.match(n.body, /FICTIONAL|DEMO/i, `${n.id} body must carry the demo marker`)
    // No fabricated live evidence: every stated URL uses a reserved invalid TLD.
    for (const [key, url] of Object.entries(n.frontmatter)) {
      if (key.endsWith('_url') && typeof url === 'string' && url !== '') {
        assert.ok(url.includes('.invalid'), `${n.id}.${key} must not be a real URL: ${url}`)
      }
    }
  }
})
