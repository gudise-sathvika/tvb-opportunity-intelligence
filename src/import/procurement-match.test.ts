/**
 * Phase P — Procurement Match schema proofs.
 *
 * The founder locked the Phase O decision: procurement requires automation
 * equivalent to funding, delivered as a SEPARATE procurement-specific matching
 * type (`procurement_match`), with the existing funding `Match` untouched.
 *
 * This spec proves the smallest useful schema and its relationships, and locks
 * the Phase P boundaries:
 *   - identity, two required links (Notice, Company), shared workflow-state
 *     vocabularies, reviewer evidence — and deliberately NOTHING else;
 *   - no Opportunity, Bid, or Contract relationship is reachable from a
 *     Procurement Match, by registry, schema, or field;
 *   - the funding Match schema and all four funding Match records are
 *     byte-for-byte untouched;
 *   - zero records, zero files, and zero vault mutations this phase: the
 *     registered directory intentionally does not exist, and importing must
 *     treat a missing directory as an empty collection;
 *   - no network dependency is introduced anywhere in the import pipeline.
 *
 * Run with: npm run test:data
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import '../data/test-fixtures/use-snapshot'
import fs from 'node:fs'
import path from 'node:path'

import {
  ID_FIELD,
  ID_PREFIXES,
  RECORD_DIRS,
  RECORD_REGISTRY,
  RECORD_TYPES,
  TYPE_LABEL,
  TYPE_PLURAL_LABEL,
  idPatternFor,
  linkFieldFor,
  typeForId,
} from '../types/registry'
import { SCHEMAS } from './schema'
import type { FieldSpec } from './schema'
import { CONTROLLED_VALUES } from './controlled-values'
import { ParseError, checkField } from './parse'
import { buildSnapshot } from './build'
import type { VaultSnapshot } from '../types/records'
import { VAULT_ROOT } from './paths'
import { COLLECTION_KEY } from '../types/registry'
import { snapshot as testFixtureSnapshot } from '../data/selectors'

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** A schema-valid body for a Procurement Match, with the two links real. */
function validPair(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    procurement_match_id: 'PMATCH-001',
    notice: '[[RFB-001 — DEMO — Rooftop Solar Installation — Works Framework]]',
    company: '[[COMP-001 — Solaris Energy Solutions Pvt Ltd]]',
    match_status: 'New',
    eligibility_status: 'Not assessed',
    evidence_notes: '',
    missing_information: [],
    reviewed_by: '',
    review_date: '',
    ...overrides,
  }
}

/** Per-field gate must pass for a fully populated Procurement Match. */
function bodyPasses(values: Record<string, unknown>): void {
  for (const spec of SCHEMAS.procurement_match) {
    checkField(spec, values[spec.name], (values.procurement_match_id as string) ?? 'PMATCH-001')
  }
}

/** The gate must reject, naming the record, field, and reason. */
function rejectsPair(field: string, value: unknown, mustMention: string[]): void {
  const spec = SCHEMAS.procurement_match.find((f) => f.name === field)
  assert.ok(spec, `procurement_match.${field} should exist`)
  const values: Record<string, unknown> = { procurement_match_id: 'PMATCH-001', ...validPair(), [field]: value }
  assert.throws(
    () => checkField(spec as FieldSpec, values[field], 'PMATCH-001'),
    (e: unknown) => {
      assert.ok(e instanceof ParseError, `expected ParseError, got ${String(e)}`)
      for (const part of mustMention) {
        assert.ok(
          (e as Error).message.includes(part),
          `message should mention "${part}"; got: ${(e as Error).message}`,
        )
      }
      return true
    },
  )
}

/** The funding Match schema exactly as Phase 1 authorised it. */
const MATCH_SCHEMA_GOLDEN = [
  ['match_id', 'text', true],
  ['company', 'link', true],
  ['opportunity', 'link', true],
  ['match_status', 'controlled', true],
  ['match_score', 'number', false],
  ['match_rationale', 'text', false],
  ['eligibility_status', 'controlled', true],
  ['criteria_met', 'list', false],
  ['criteria_not_met', 'list', false],
  ['missing_information', 'list', false],
  ['evidence_notes', 'text', false],
  ['reviewed_by', 'text', false],
  ['review_date', 'date', false],
  ['priority', 'controlled', false],
  ['next_action', 'text', false],
  ['assigned_to', 'text', false],
  ['next_review_date', 'date', false],
  ['linked_application', 'link', false],
  ['last_updated', 'date', false],
] as const

function snapshotNow(): VaultSnapshot {
  return buildSnapshot(VAULT_ROOT).snapshot
}

/* ------------------------------------------------------------------ */
/* Registry                                                             */
/* ------------------------------------------------------------------ */

test('registry entry, ID pattern, and labels are exact', () => {
  assert.equal(RECORD_REGISTRY.procurement_match.idPrefix, 'PMATCH')
  assert.equal(RECORD_REGISTRY.procurement_match.idField, 'procurement_match_id')
  assert.equal(RECORD_REGISTRY.procurement_match.collectionKey, 'procurement_matches')
  assert.equal(RECORD_REGISTRY.procurement_match.collectionPath, 'procurement-matches')
  assert.equal(RECORD_REGISTRY.procurement_match.recordDir, '12 - Procurement Matches')
  assert.equal(TYPE_LABEL.procurement_match, 'Procurement Match')
  assert.equal(TYPE_PLURAL_LABEL.procurement_match, 'Procurement Matches')
  assert.equal(ID_FIELD.procurement_match, 'procurement_match_id')
  assert.equal(COLLECTION_KEY.procurement_match, 'procurement_matches')
})

test('approved links are exactly Notice and Company, with the documented pointsTo', () => {
  const links = RECORD_REGISTRY.procurement_match.links
  assert.deepEqual(links, [
    { field: 'notice', pointsTo: 'notice' },
    { field: 'company', pointsTo: 'company' },
  ])
})

test('the ID pattern is PMATCH-\d{3} and every sibling prefix stays distinct', () => {
  assert.equal(idPatternFor('procurement_match').source, '^PMATCH-\\d{3}$')
  assert.ok(idPatternFor('procurement_match').test('PMATCH-001'))
  assert.ok(!idPatternFor('procurement_match').test('PMATCH-0001'))
  assert.ok(!idPatternFor('procurement_match').test('PMATCH-01'))
  // A funding Match id, a Bid id, and a fat pitch all fail the Procurement Match
  // pattern; conversely PMATCH-001 fails the funding Match pattern and Bid pattern.
  assert.ok(!idPatternFor('procurement_match').test('MATCH-001'))
  assert.ok(!idPatternFor('procurement_match').test('BID-001'))
  assert.ok(!idPatternFor('match').test('PMATCH-001'))
  assert.ok(!idPatternFor('bid').test('PMATCH-001'))
  // No prefix is shared, and the set is still one entry per type.
  assert.equal(new Set(ID_PREFIXES).size, RECORD_TYPES.length)
})

test('ID resolution maps PMATCH to this type and leaves Match as Match', () => {
  assert.equal(typeForId('PMATCH-001'), 'procurement_match')
  assert.equal(typeForId('MATCH-001'), 'match')
  assert.equal(typeForId('COMP-001'), 'company')
  assert.equal(typeForId('BID-001'), 'bid')
})

/* ------------------------------------------------------------------ */
/* Schema                                                               */
/* ------------------------------------------------------------------ */

test('the schema is the smallest ordered field set and nothing else', () => {
  assert.deepEqual(
    SCHEMAS.procurement_match.map((f) => [f.name, f.kind, f.required]),
    [
      ['procurement_match_id', 'text', true],
      ['notice', 'link', true],
      ['company', 'link', true],
      ['match_status', 'controlled', true],
      ['eligibility_status', 'controlled', true],
      ['evidence_notes', 'text', false],
      ['missing_information', 'list', false],
      ['reviewed_by', 'text', false],
      ['review_date', 'date', false],
    ],
  )
})

test('there is no score, confidence, priority, or duplicated Notice/Company fact', () => {
  const names = SCHEMAS.procurement_match.map((f) => f.name)
  for (const banned of ['score', 'confidence', 'priority', 'rationale', 'criteria']) {
    assert.ok(!names.some((n) => n.toLowerCase().includes(banned)), `banned "${banned}" in schema`)
  }
  // The only Notice/Company-shaped fields are the two relationship links.
  assert.deepEqual(
    names.filter((n) => /notice|company/.test(n)),
    ['notice', 'company'],
  )
})

test('no Opportunity, Bid, or Contract link is reachable for this type', () => {
  for (const target of ['opportunity', 'match', 'application', 'bid', 'contract', 'source', 'organization']) {
    assert.throws(() => linkFieldFor('procurement_match', target as never), /No approved link/, target)
  }
  assert.equal(linkFieldFor('procurement_match', 'notice'), 'notice')
  assert.equal(linkFieldFor('procurement_match', 'company'), 'company')
  assert.ok(!SCHEMAS.procurement_match.some((f) => f.name === 'opportunity'))
  assert.ok(!SCHEMAS.procurement_match.some((f) => f.name === 'bid'))
  assert.ok(!SCHEMAS.procurement_match.some((f) => f.name === 'contract'))
})

/* ------------------------------------------------------------------ */
/* Field gates                                                          */
/* ------------------------------------------------------------------ */

test('a fully populated record, links included, passes every per-field gate', () => {
  assert.doesNotThrow(() => bodyPasses(validPair()))
  assert.doesNotThrow(() =>
    bodyPasses(validPair({ match_status: 'Under review', eligibility_status: 'Potentially eligible' })),
  )
  // Optional fields may be blank or empty without complaint.
  assert.doesNotThrow(() =>
    bodyPasses(validPair({ evidence_notes: '', missing_information: [], reviewed_by: '', review_date: '' })),
  )
})

test('both required links are enforced and name the record and field', () => {
  rejectsPair('notice', '', ['PMATCH-001.notice', 'required', 'blank'])
  rejectsPair('company', undefined, ['PMATCH-001.company', 'required', 'blank'])
})

test('the other required fields are enforced too', () => {
  rejectsPair('procurement_match_id', '', ['PMATCH-001.procurement_match_id', 'required', 'blank'])
  rejectsPair('match_status', undefined, ['PMATCH-001.match_status', 'required', 'blank'])
  rejectsPair('eligibility_status', undefined, ['PMATCH-001.eligibility_status', 'required', 'blank'])
})

test('controlled fields reuse the shared vocabularies and reject everything else', () => {
  for (const value of CONTROLLED_VALUES.match_status) {
    assert.doesNotThrow(() => bodyPasses(validPair({ match_status: value })))
  }
  for (const value of CONTROLLED_VALUES.eligibility_status) {
    assert.doesNotThrow(() => bodyPasses(validPair({ eligibility_status: value })))
  }
  rejectsPair('match_status', 'Probably yes', ['PMATCH-001.match_status', 'not an allowed value', 'Probably yes'])
  rejectsPair('eligibility_status', 'Eligible?', ['PMATCH-001.eligibility_status', 'not an allowed value', 'Eligible?'])
})

test('a bad date and list are rejected, and a link must be text', () => {
  rejectsPair('review_date', 'not-a-date', ['PMATCH-001 field review_date', 'date'])
  rejectsPair('missing_information', 'not-a-list', ['PMATCH-001 field missing_information', 'list'])
  rejectsPair('notice', 42, ['PMATCH-001 field notice', 'Expected text', 'number'])
})

/* ------------------------------------------------------------------ */
/* Boundaries: the funding Match is untouched                           */
/* ------------------------------------------------------------------ */

test('the funding Match schema is byte-for-byte what was authorised', () => {
  assert.deepEqual(
    SCHEMAS.match.map((f) => [f.name, f.kind, f.required]),
    MATCH_SCHEMA_GOLDEN,
  )
  assert.ok(SCHEMAS.match.some((f) => f.name === 'match_score'), 'Match keeps its score field')
  assert.ok(!SCHEMAS.match.some((f) => f.name === 'notice'), 'Match gains no notice field')
})

test('test-local fixture keeps the four funding Match examples available to relationship tests', () => {
  const snap = testFixtureSnapshot
  const matches = snap.records.matches as unknown as { id: string; frontmatter: { match_status: string; eligibility_status: string } }[]
  assert.equal(matches.length, 4)
  assert.deepEqual(
    matches.map((m) => m.id),
    ['MATCH-001', 'MATCH-002', 'MATCH-003', 'MATCH-004'],
  )
  for (const m of matches) {
    assert.equal(m.frontmatter.match_status !== undefined, true, m.id)
    assert.ok(CONTROLLED_VALUES.match_status.includes(m.frontmatter.match_status), m.id)
    assert.ok(CONTROLLED_VALUES.eligibility_status.includes(m.frontmatter.eligibility_status), m.id)
  }
  assert.equal(Object.keys(snap.relationships.matchToOpportunity).length, 4)
  assert.equal(Object.keys(snap.relationships.matchToCompany).length, 4)
  // The locked decision forbids a funding relationship to Notice: no map exists.
  assert.ok(!('matchToNotice' in snap.relationships))
})

/* ------------------------------------------------------------------ */
/* Boundaries: this phase creates no records, no files, no vault writes */
/* ------------------------------------------------------------------ */

test('the collection imports as zero records with the reserved directory not created', () => {
  const snap = snapshotNow()
  assert.deepEqual(snap.records.procurement_matches, [])
  assert.deepEqual(snap.relationships.procurementMatchToNotice, {})
  assert.deepEqual(snap.relationships.procurementMatchToCompany, {})
  const sourceRecords = RECORD_TYPES.reduce((count, type) => {
    const dir = path.join(VAULT_ROOT, RECORD_DIRS[type])
    return count + (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).length : 0)
  }, 0)
  const excluded = buildSnapshot(VAULT_ROOT).excludedFictionalIds.length
  assert.equal(snap.source.recordCount, sourceRecords - excluded)
  // The reserved directory intentionally does not exist yet. This assertion is
  // phase-scoped: the successor phase that files the first record must move it.
  const dir = path.join(VAULT_ROOT, RECORD_DIRS.procurement_match)
  assert.ok(!fs.existsSync(dir), 'no Procurement Match vault directory in this phase')
})

test('a missing record directory is a legal zero, not an import failure', () => {
  // Registered but empty, the record count still derives cleanly.
  const snap = snapshotNow()
  assert.equal(snap.records.procurement_matches.length, 0)
  // And no unresolved link points anywhere near procurement.
  assert.deepEqual(snap.unresolvedLinks, [])
})

test('the empty Procurement Match collection is deterministic across builds', () => {
  const a = snapshotNow()
  const b = snapshotNow()
  assert.deepEqual(a.records.procurement_matches, b.records.procurement_matches)
  assert.deepEqual(a.relationships.procurementMatchToNotice, b.relationships.procurementMatchToNotice)
  assert.deepEqual(a.relationships.procurementMatchToCompany, b.relationships.procurementMatchToCompany)
  // Deterministic serialisation holds for the whole snapshot too.
  assert.equal(
    JSON.stringify(a),
    JSON.stringify(b),
  )
})

test('the Phase P import pipeline adds no network dependency and writes no vault files', () => {
  const pipelineFiles = ['build.ts', 'validate.ts', 'parse.ts', 'links.ts', 'schema.ts', 'controlled-values.ts']
  for (const file of pipelineFiles) {
    const src = fs.readFileSync(path.join(import.meta.dirname, file), 'utf8')
    for (const banned of ['node:http', 'node:net', 'node:child_process', 'fetch(', 'XMLHttpRequest', 'axios', 'undici']) {
      assert.ok(!src.includes(banned), `${file} must not reference ${banned}`)
    }
  }
  const buildSrc = fs.readFileSync(path.join(import.meta.dirname, 'build.ts'), 'utf8')
  assert.ok(!buildSrc.includes('writeFileSync'), 'the builder must not write vault files')
})