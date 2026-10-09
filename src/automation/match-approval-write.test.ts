/**
 * Phase N approved-match Match-record proposal tests (dry-run boundary).
 *
 * Funding approvals travel the REAL chain — engine → review → decision — into
 * exact Match payloads; procurement approvals are rejected because the Match
 * schema has no notice relationship; non-approved states, incomplete
 * approvals, and taken ids are refused without overwrites; repeats are
 * identical; no scores, no sibling records, no I/O.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { proposeMatchRecord } from './match-approval-write'
import type { MatchCompanyRecord, MatchSourceRecord } from './match-proposal'
import { proposeMatch } from './match-proposal'
import type { MatchReviewItem } from './match-review'
import { applyMatchReviewDecision, createMatchReviewItem } from './match-review'
import { matchReviewFixtureStore } from './match-review-fixture'

const REVIEWER = 'RVW-900'
const DECIDED_AT = '2026-10-12T00:00:00.000Z'
const CREATED_AT = '2026-10-07T00:00:00.000Z'
const EMPTY: readonly string[] = []

/* Real COMP-001 values mirrored (see match-proposal.test.ts). */
const AGRISOLAR: MatchCompanyRecord = {
  companyId: 'COMP-001',
  name: 'DEMO — AgriSolar Systems Private Limited',
  country: 'India',
  industries: ['Agricultural technology', 'Renewable energy', 'Manufacturing'],
  description:
    'FICTIONAL DEMONSTRATION PROFILE. AgriSolar is an invented company. It designs and manufactures small solar-powered irrigation pumping units and cold-storage enclosures for smallholder farmers, and services them through regional technicians. Every figure on this record is illustrative and fabricated. This is not a real company, not a real client of TVB, and not based on any actual business.',
  capabilities: [
    'Solar photovoltaic pumping systems',
    'IoT remote monitoring',
    'Cold-chain storage enclosures',
    'Decentralised rural electrification',
    'Farmer cold-chain infrastructure',
    'Water-efficient irrigation',
    'Udyam registration (illustrative, fictional)',
    'ISO 9001 (illustrative, fictional)',
  ],
}

const SOLAR_GRANT: MatchSourceRecord = {
  recordId: 'FX-M-3002',
  recordType: 'opportunity',
  name: 'Fixture Solar Irrigation Grant',
  country: 'India',
  industries: ['Energy'],
  description: null,
}

function approveFunding(source: MatchSourceRecord, company: MatchCompanyRecord): MatchReviewItem {
  const proposal = proposeMatch(source, company)
  const item = createMatchReviewItem(proposal, {
    companyName: company.name ?? null,
    sourceName: source.name ?? null,
    createdAt: CREATED_AT,
  })
  return applyMatchReviewDecision(item, {
    proposalId: proposal.proposalId,
    decision: 'APPROVED',
    reviewerId: REVIEWER,
    decidedAt: DECIDED_AT,
  })
}

test('an approved funding proposal yields an exact Match record proposal', () => {
  const item = approveFunding(SOLAR_GRANT, AGRISOLAR)
  assert.equal(item.proposal.status, 'PROPOSED')
  const result = proposeMatchRecord({ item, existingMatchIds: EMPTY })
  assert.equal(result.decision, 'proposed')
  if (result.decision !== 'proposed') return
  assert.match(result.recordId, /^MATCH-\d{3}$/)
  assert.equal(result.proposalStatus, 'PROPOSED')
  assert.deepEqual(result.approval, { proposalId: item.proposal.proposalId, reviewerId: REVIEWER, decidedAt: DECIDED_AT })
  assert.deepEqual(Object.keys(result.payload).sort(), [
    'company',
    'eligibility_status',
    'evidence_notes',
    'match_id',
    'match_status',
    'missing_information',
    'review_date',
    'reviewed_by',
  ])
  assert.equal(result.payload.match_id, result.recordId)
  assert.equal(result.payload.company, '[[COMP-001 — DEMO — AgriSolar Systems Private Limited]]')
  assert.equal(result.payload.match_status, 'New')
  assert.equal(result.payload.eligibility_status, 'Not assessed')
  assert.equal(result.payload.reviewed_by, REVIEWER)
  assert.equal(result.payload.review_date, '2026-10-12')
  assert.ok(!('match_score' in result.payload), 'the vault documents no scoring method — none is set')
  const notes = String(result.payload.evidence_notes)
  assert.ok(notes.includes(item.proposal.proposalId))
  assert.ok(notes.includes('MATCH-RULES-v1'))
  assert.ok(notes.includes('solar'), 'matched evidence preserved')
  assert.ok(notes.includes(REVIEWER))
  assert.ok(notes.includes('no assessment performed'))
  assert.deepEqual(result.missingRequiredFields, ['opportunity'], 'fixture ids are not vault links')
  assert.ok(Object.isFrozen(result))
})

test('an approved procurement proposal is rejected: the schema has no notice relationship', () => {
  matchReviewFixtureStore.reset()
  const approved = matchReviewFixtureStore.items().find((entry) => entry.reviewStatus === 'APPROVED')!
  assert.equal(approved.proposal.sourceRecordType, 'notice')
  const result = proposeMatchRecord({ item: approved, existingMatchIds: EMPTY })
  assert.equal(result.decision, 'rejected')
  assert.ok(result.decision === 'rejected' && result.reason.includes('no notice/procurement relationship'))
})

test('a human-approved engine non-match still proposes with its status visible', () => {
  const offshore: MatchSourceRecord = {
    recordId: 'FX-M-3999',
    recordType: 'opportunity',
    name: 'Fixture Harbour Dredging Services',
    country: 'USA',
    industries: ['Technology'],
    description: null,
  }
  const item = approveFunding(offshore, AGRISOLAR)
  assert.equal(item.proposal.status, 'NOT_A_MATCH')
  const result = proposeMatchRecord({ item, existingMatchIds: EMPTY })
  assert.equal(result.decision, 'proposed', 'the human verdict governs; the engine status travels along')
  if (result.decision !== 'proposed') return
  assert.equal(result.proposalStatus, 'NOT_A_MATCH')
})

test('pending and rejected reviews are rejected', () => {
  matchReviewFixtureStore.reset()
  for (const item of matchReviewFixtureStore.items().filter((entry) => entry.reviewStatus !== 'APPROVED')) {
    const result = proposeMatchRecord({ item, existingMatchIds: EMPTY })
    assert.equal(result.decision, 'rejected', `status ${item.reviewStatus} must not reach the boundary`)
  }
})

test('incomplete or malformed approvals are rejected', () => {
  const item = approveFunding(SOLAR_GRANT, AGRISOLAR)
  const entry = item.audit[item.audit.length - 1]
  const variants: Array<[string, MatchReviewItem]> = [
    ['missing reviewer', { ...item, audit: [{ ...entry, reviewerId: '' }] }],
    ['missing timestamp', { ...item, audit: [{ ...entry, decidedAt: '' }] }],
    ['status without audit', { ...item, audit: [] }],
    ['malformed timestamp', { ...item, audit: [{ ...entry, decidedAt: 'soon' }] }],
  ]
  for (const [label, variant] of variants) {
    const result = proposeMatchRecord({ item: variant, existingMatchIds: EMPTY })
    assert.equal(result.decision, 'rejected', label)
  }
})

test('an existing Match id returns an explicit conflict', () => {
  const item = approveFunding(SOLAR_GRANT, AGRISOLAR)
  const first = proposeMatchRecord({ item, existingMatchIds: EMPTY })
  assert.equal(first.decision, 'proposed')
  if (first.decision !== 'proposed') return
  const second = proposeMatchRecord({ item, existingMatchIds: [first.recordId] })
  assert.equal(second.decision, 'conflict')
  if (second.decision !== 'conflict') return
  assert.equal(second.recordId, first.recordId)
  assert.ok(second.reason.includes('already exists'))
})

test('repeats are identical, inputs untouched, outputs score-free', () => {
  const item = approveFunding(SOLAR_GRANT, AGRISOLAR)
  const snapshot = JSON.parse(JSON.stringify(item)) as unknown
  const first = proposeMatchRecord({ item, existingMatchIds: EMPTY })
  const second = proposeMatchRecord({ item, existingMatchIds: EMPTY })
  assert.deepEqual(second, first)
  assert.deepEqual(item, snapshot, 'the input item is byte-identical after proposing')
  assert.ok(Object.isFrozen(first))
  if (first.decision !== 'proposed') return
  assert.ok(Object.isFrozen(first.payload))
  const serialized = JSON.stringify(first)
  for (const forbidden of ['"score"', '"confidence"', '"application"', '"bid"', '"contract"']) {
    assert.ok(!serialized.includes(forbidden), `no score or sibling record may leave the boundary, got: ${forbidden}`)
  }
})
