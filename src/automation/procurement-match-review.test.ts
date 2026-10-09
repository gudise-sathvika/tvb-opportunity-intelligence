/**
 * Phase Q procurement match review logic tests: pending review appearance,
 * approve/reject transitions, terminal immutability, reviewer + timestamp
 * enforcement, append-only audit, and proposal immutability. No scores, no
 * ProcurementMatch records, no I/O anywhere.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProcurementMatchProposal } from './procurement-proposal'
import { PMATCH_RULES_VERSION } from './procurement-proposal'
import {
  applyProcurementMatchReviewDecision,
  canProcurementMatchTransition,
  createProcurementMatchReviewItem,
} from './procurement-match-review'

const REVIEWER = 'RVW-900'
const DECIDED_AT = '2026-10-12T00:00:00.000Z'
const CREATED_AT = '2026-10-07T00:00:00.000Z'

function proposal(overrides: Partial<ProcurementMatchProposal> = {}): ProcurementMatchProposal {
  return {
    proposalId: 'PP:PMATCH-RULES-v1:RFB-001:COMP-001',
    ruleVersion: PMATCH_RULES_VERSION,
    recordType: 'notice' as const,
    noticeId: 'RFB-001',
    companyId: 'COMP-001',
    matchedSignals: ['country-compatibility'],
    missingSignals: ['industry-overlap'],
    evidence: [],
    status: 'PROPOSED',
    ...overrides,
  }
}

function decide(proposalId: string, decision: 'APPROVED' | 'REJECTED', extra: Record<string, unknown> = {}) {
  return { proposalId, decision, reviewerId: REVIEWER, decidedAt: DECIDED_AT, ...extra }
}

test('a wrapped proposal appears as pending with its identity and names', () => {
  const item = createProcurementMatchReviewItem(proposal(), {
    noticeName: 'DEMO — Rooftop Solar Installation — Works Framework',
    companyName: 'DEMO — AgriSolar Systems Private Limited',
    createdAt: CREATED_AT,
  })
  assert.equal(item.reviewStatus, 'PENDING')
  assert.deepEqual(item.audit, [])
  assert.equal(item.noticeName, 'DEMO — Rooftop Solar Installation — Works Framework')
  assert.equal(item.companyName, 'DEMO — AgriSolar Systems Private Limited')
  assert.equal(item.createdAt, CREATED_AT)
  assert.equal(item.updatedAt, CREATED_AT)
  assert.ok(Object.isFrozen(item))
})

test('pending approves and rejects with reviewer, timestamp, and history', () => {
  const approved = applyProcurementMatchReviewDecision(
    createProcurementMatchReviewItem(proposal(), { createdAt: CREATED_AT }),
    decide('PP:PMATCH-RULES-v1:RFB-001:COMP-001', 'APPROVED'),
  )
  assert.equal(approved.reviewStatus, 'APPROVED')
  assert.equal(approved.updatedAt, DECIDED_AT)
  assert.deepEqual(approved.audit, [
    {
      proposalId: 'PP:PMATCH-RULES-v1:RFB-001:COMP-001',
      previousStatus: 'PENDING',
      newStatus: 'APPROVED',
      reviewerId: REVIEWER,
      decidedAt: DECIDED_AT,
      reason: null,
    },
  ])

  const rejected = applyProcurementMatchReviewDecision(
    createProcurementMatchReviewItem(proposal(), { createdAt: CREATED_AT }),
    decide('PP:PMATCH-RULES-v1:RFB-001:COMP-001', 'REJECTED', { reason: 'Wrong sector.' }),
  )
  assert.equal(rejected.reviewStatus, 'REJECTED')
  assert.equal(rejected.audit[0].reason, 'Wrong sector.')
})

test('terminal reviews cannot be decided again', () => {
  assert.deepEqual(canProcurementMatchTransition('PENDING', 'APPROVED'), true)
  assert.deepEqual(canProcurementMatchTransition('PENDING', 'REJECTED'), true)
  assert.deepEqual(canProcurementMatchTransition('APPROVED', 'APPROVED'), false)
  assert.deepEqual(canProcurementMatchTransition('APPROVED', 'REJECTED'), false)
  assert.deepEqual(canProcurementMatchTransition('REJECTED', 'APPROVED'), false)

  const approved = applyProcurementMatchReviewDecision(
    createProcurementMatchReviewItem(proposal(), { createdAt: CREATED_AT }),
    decide('PP:PMATCH-RULES-v1:RFB-001:COMP-001', 'APPROVED'),
  )
  assert.throws(
    () =>
      applyProcurementMatchReviewDecision(
        approved,
        decide('PP:PMATCH-RULES-v1:RFB-001:COMP-001', 'REJECTED'),
      ),
    /invalid procurement match review transition: APPROVED -> REJECTED/,
  )
})

test('reviewer and decided-at are required for both decisions', () => {
  const item = () => createProcurementMatchReviewItem(proposal(), { createdAt: CREATED_AT })
  for (const decision of ['APPROVED', 'REJECTED'] as const) {
    assert.throws(
      () =>
        applyProcurementMatchReviewDecision(
          item(),
          { ...decide('PP:PMATCH-RULES-v1:RFB-001:COMP-001', decision), reviewerId: '' },
        ),
      /reviewer id is required/,
    )
    assert.throws(
      () =>
        applyProcurementMatchReviewDecision(
          item(),
          { ...decide('PP:PMATCH-RULES-v1:RFB-001:COMP-001', decision), decidedAt: '' },
        ),
      /decided-at timestamp is required/,
    )
  }
  assert.throws(
    () =>
      applyProcurementMatchReviewDecision(
        item(),
        decide('PP:PMATCH-RULES-v1:RFB-002:COMP-003', 'APPROVED'),
      ),
    /does not match review item/,
  )
})

test('decisions never modify the underlying proposal', () => {
  const original = proposal()
  const snapshot = JSON.parse(JSON.stringify(original)) as unknown
  const item = createProcurementMatchReviewItem(original, { createdAt: CREATED_AT })
  const decided = applyProcurementMatchReviewDecision(
    item,
    decide(original.proposalId, 'APPROVED'),
  )
  assert.deepEqual(original, snapshot, 'the input proposal object is untouched')
  assert.deepEqual(decided.proposal, snapshot, 'the wrapped proposal is byte-identical after deciding')
  assert.ok(Object.isFrozen(decided))
  assert.ok(!('score' in decided.proposal) && !('procurement_match_id' in decided), 'no score, no record identity')
})