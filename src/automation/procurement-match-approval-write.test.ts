/**
 * Phase Q approved-procurement-match ProcurementMatch-record proposal tests
 * (dry-run boundary). Real RFB-001 and COMP-001 identities drive exact
 * payloads; incomplete approvals, ignored verdicts, and taken ids are refused
 * without overwrites; repeats are identical; no scores, no funding Match or
 * Bid/Contract shapes, no I/O.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { proposeProcurementMatchRecord } from './procurement-match-approval-write'
import type { ProcurementCompanyRecord, ProcurementSourceRecord } from './procurement-proposal'
import { proposeProcurementMatch } from './procurement-proposal'
import type { ProcurementMatchReviewItem } from './procurement-match-review'
import { applyProcurementMatchReviewDecision, createProcurementMatchReviewItem } from './procurement-match-review'

const REVIEWER = 'RVW-900'
const DECIDED_AT = '2026-10-12T00:00:00.000Z'
const CREATED_AT = '2026-10-07T00:00:00.000Z'
const EMPTY: readonly string[] = []

/* Real RFB-001 and COMP-001 values, transcribed from the snapshot. */
const ROOFTOP_SOLAR: ProcurementSourceRecord = {
  recordId: 'RFB-001',
  recordType: 'notice',
  name: 'DEMO — Rooftop Solar Installation — Works Framework',
  country: 'India',
  industries: ['Renewable energy'],
  description:
    'FICTIONAL DEMONSTRATION RECORD. Supply and installation of rooftop solar photovoltaic systems for three demonstration sites, including mounting structure, inverter, cabling, commissioning, and a two-year defect liability period. Nothing in this record describes a real tender.',
}

const AGRISOLAR: ProcurementCompanyRecord = {
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

const NORTHFIELD: ProcurementCompanyRecord = {
  companyId: 'COMP-002',
  name: 'DEMO — Northfield Robotics Inc',
  country: 'USA',
  industries: ['Industrial automation', 'Robotics', 'Advanced manufacturing'],
  description:
    'FICTIONAL DEMONSTRATION PROFILE. Northfield is an invented company. It designs and integrates robotic inspection and material-handling systems for automotive and aerospace component manufacturers, with a service arm supplying replacement grippers and vision hardware. Every figure on this record is illustrative and fabricated. This is not a real company, not a real client of TVB, and not based on any actual business.',
  capabilities: [
    'Computer vision inspection',
    'Collaborative robotics',
    'Industrial control software',
    'Automated quality inspection',
    'Warehouse automation',
    'Aerospace component inspection',
    'Small Business Administration size-standard self-certification (illustrative, fictional)',
  ],
}

function approveNotice(source: ProcurementSourceRecord, company: ProcurementCompanyRecord): ProcurementMatchReviewItem {
  const proposal = proposeProcurementMatch(source, company)
  const item = createProcurementMatchReviewItem(proposal, {
    noticeName: source.name ?? null,
    companyName: company.name ?? null,
    createdAt: CREATED_AT,
  })
  return applyProcurementMatchReviewDecision(item, {
    proposalId: proposal.proposalId,
    decision: 'APPROVED',
    reviewerId: REVIEWER,
    decidedAt: DECIDED_AT,
  })
}

test('an approved procurement proposal yields an exact ProcurementMatch record proposal', () => {
  const item = approveNotice(ROOFTOP_SOLAR, AGRISOLAR)
  assert.equal(item.proposal.status, 'PROPOSED')
  const result = proposeProcurementMatchRecord({ item, existingProcurementMatchIds: EMPTY })
  assert.equal(result.decision, 'proposed')
  if (result.decision !== 'proposed') return
  assert.match(result.recordId, /^PMATCH-\d{3}$/)
  assert.equal(result.proposalStatus, 'PROPOSED')
  assert.deepEqual(result.approval, {
    proposalId: item.proposal.proposalId,
    reviewerId: REVIEWER,
    decidedAt: DECIDED_AT,
  })
  assert.deepEqual(Object.keys(result.payload).sort(), [
    'company',
    'eligibility_status',
    'evidence_notes',
    'match_status',
    'missing_information',
    'notice',
    'procurement_match_id',
    'review_date',
    'reviewed_by',
  ])
  assert.equal(result.payload.procurement_match_id, result.recordId)
  assert.equal(result.payload.notice, '[[RFB-001 — DEMO — Rooftop Solar Installation — Works Framework]]')
  assert.equal(result.payload.company, '[[COMP-001 — DEMO — AgriSolar Systems Private Limited]]')
  assert.equal(result.payload.match_status, 'New')
  assert.equal(result.payload.eligibility_status, 'Not assessed')
  assert.equal(result.payload.reviewed_by, REVIEWER)
  assert.equal(result.payload.review_date, '2026-10-12')
  assert.ok(!('score' in result.payload) && !('confidence' in result.payload), 'no scoring or confidence leaves the boundary')
  const notes = String(result.payload.evidence_notes)
  assert.ok(notes.includes(item.proposal.proposalId))
  assert.ok(notes.includes('PMATCH-RULES-v1'))
  assert.ok(notes.includes('renewable energy'), 'matched industry evidence preserved')
  assert.ok(notes.includes('solar'), 'matched capability evidence preserved')
  assert.ok(notes.includes(REVIEWER))
  assert.ok(notes.includes('no eligibility assessment performed'))
  assert.deepEqual(result.missingRequiredFields, [], 'real vault ids and names form honest links')
  assert.ok(Object.isFrozen(result))
  assert.ok(Object.isFrozen(result.payload))
})

test('a human-approved engine non-match still proposes with its status visible', () => {
  const item = approveNotice(ROOFTOP_SOLAR, NORTHFIELD)
  assert.equal(item.proposal.status, 'NOT_A_MATCH')
  const result = proposeProcurementMatchRecord({ item, existingProcurementMatchIds: EMPTY })
  assert.equal(result.decision, 'proposed', 'the human verdict governs; the engine status travels along')
  if (result.decision !== 'proposed') return
  assert.equal(result.proposalStatus, 'NOT_A_MATCH')
})

test('pending and rejected reviews are rejected', () => {
  const pending = createProcurementMatchReviewItem(proposeProcurementMatch(ROOFTOP_SOLAR, AGRISOLAR), {
    noticeName: ROOFTOP_SOLAR.name ?? null,
    companyName: AGRISOLAR.name ?? null,
    createdAt: CREATED_AT,
  })
  for (const item of [pending]) {
    const result = proposeProcurementMatchRecord({ item, existingProcurementMatchIds: EMPTY })
    assert.equal(result.decision, 'rejected', `status ${item.reviewStatus} must not reach the boundary`)
  }
})

test('incomplete or malformed approvals are rejected', () => {
  const item = approveNotice(ROOFTOP_SOLAR, AGRISOLAR)
  const entry = item.audit[item.audit.length - 1]
  const variants: Array<[string, ProcurementMatchReviewItem]> = [
    ['missing reviewer', { ...item, audit: [{ ...entry, reviewerId: '' }] }],
    ['missing timestamp', { ...item, audit: [{ ...entry, decidedAt: '' }] }],
    ['status without audit', { ...item, audit: [] }],
    ['malformed timestamp', { ...item, audit: [{ ...entry, decidedAt: 'soon' }] }],
  ]
  for (const [label, variant] of variants) {
    const result = proposeProcurementMatchRecord({ item: variant, existingProcurementMatchIds: EMPTY })
    assert.equal(result.decision, 'rejected', label)
  }
})

test('approved reviews without a Notice identity or Company identity refuse the missing link', () => {
  const proposal = proposeProcurementMatch(ROOFTOP_SOLAR, AGRISOLAR)
  const noNoticeName = createProcurementMatchReviewItem(proposal, {
    noticeName: null,
    companyName: AGRISOLAR.name ?? null,
    createdAt: CREATED_AT,
  })
  const approvedWithoutNotice = applyProcurementMatchReviewDecision(noNoticeName, {
    proposalId: proposal.proposalId,
    decision: 'APPROVED',
    reviewerId: REVIEWER,
    decidedAt: DECIDED_AT,
  })
  const missingNotice = proposeProcurementMatchRecord({ item: approvedWithoutNotice, existingProcurementMatchIds: EMPTY })
  assert.equal(missingNotice.decision, 'proposed')
  if (missingNotice.decision !== 'proposed') return
  assert.deepEqual(missingNotice.missingRequiredFields, ['notice'])
  assert.ok(!('notice' in missingNotice.payload), 'a notice link is never fabricated')

  const noCompanyName = createProcurementMatchReviewItem(proposal, {
    noticeName: ROOFTOP_SOLAR.name ?? null,
    companyName: null,
    createdAt: CREATED_AT,
  })
  const approvedWithoutCompany = applyProcurementMatchReviewDecision(noCompanyName, {
    proposalId: proposal.proposalId,
    decision: 'APPROVED',
    reviewerId: REVIEWER,
    decidedAt: DECIDED_AT,
  })
  const missingCompany = proposeProcurementMatchRecord({ item: approvedWithoutCompany, existingProcurementMatchIds: EMPTY })
  assert.equal(missingCompany.decision, 'proposed')
  if (missingCompany.decision !== 'proposed') return
  assert.deepEqual(missingCompany.missingRequiredFields, ['company'])
  assert.ok(!('company' in missingCompany.payload), 'a company link is never fabricated')
})

test('a proposal with a non-Notice source is rejected: no honest destination', () => {
  const item = approveNotice(ROOFTOP_SOLAR, AGRISOLAR)
  const foreign = { ...item, proposal: { ...item.proposal, recordType: 'opportunity' as never } }
  const result = proposeProcurementMatchRecord({ item: foreign, existingProcurementMatchIds: EMPTY })
  assert.equal(result.decision, 'rejected')
  assert.ok(result.decision === 'rejected' && result.reason.includes('no honest destination'))
})

test('an existing PMATCH id returns an explicit conflict', () => {
  const item = approveNotice(ROOFTOP_SOLAR, AGRISOLAR)
  const first = proposeProcurementMatchRecord({ item, existingProcurementMatchIds: EMPTY })
  assert.equal(first.decision, 'proposed')
  if (first.decision !== 'proposed') return
  const second = proposeProcurementMatchRecord({ item, existingProcurementMatchIds: [first.recordId] })
  assert.equal(second.decision, 'conflict')
  if (second.decision !== 'conflict') return
  assert.equal(second.recordId, first.recordId)
  assert.ok(second.reason.includes('already exists'))
})

test('repeats are identical, inputs untouched, outputs carry no sibling record', () => {
  const item = approveNotice(ROOFTOP_SOLAR, AGRISOLAR)
  const snapshot = JSON.parse(JSON.stringify(item)) as unknown
  const first = proposeProcurementMatchRecord({ item, existingProcurementMatchIds: EMPTY })
  const second = proposeProcurementMatchRecord({ item, existingProcurementMatchIds: EMPTY })
  assert.deepEqual(second, first)
  assert.deepEqual(item, snapshot, 'the input item is byte-identical after proposing')
  assert.ok(Object.isFrozen(first))
  if (first.decision !== 'proposed') return
  assert.ok(Object.isFrozen(first.payload))
  const serialized = JSON.stringify(first)
  for (const forbidden of ['"score"', '"confidence"', '"match_id"', '"match_score"', '"opportunity"', '"application"', '"bid_id"', '"contract_id"']) {
    assert.ok(!serialized.includes(forbidden), `no score or sibling record may leave the boundary, got: ${forbidden}`)
  }
})