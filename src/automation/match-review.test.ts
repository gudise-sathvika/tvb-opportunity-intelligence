/**
 * Phase M match review logic tests: pending review appearance, approve/reject
 * transitions, terminal immutability, reviewer + timestamp enforcement,
 * append-only audit, and proposal immutability. No scores, no Match records,
 * no I/O anywhere.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { MatchProposal } from './match-proposal'
import { MATCH_RULES_VERSION } from './match-proposal'
import {
  applyMatchReviewDecision,
  canMatchTransition,
  createMatchReviewItem,
} from './match-review'

const REVIEWER = 'RVW-900'
const DECIDED_AT = '2026-10-12T00:00:00.000Z'
const CREATED_AT = '2026-10-07T00:00:00.000Z'

function proposal(overrides: Partial<MatchProposal> = {}): MatchProposal {
  return {
    proposalId: 'MP:MATCH-RULES-v1:RFB-T1:COMP-001',
    ruleVersion: MATCH_RULES_VERSION,
    sourceRecordId: 'RFB-T1',
    sourceRecordType: 'notice',
    companyId: 'COMP-001',
    matchedSignals: ['country-compatibility'],
    missingSignals: [],
    evidence: [],
    status: 'PROPOSED',
    ...overrides,
  }
}

function decide(proposalId: string, decision: 'APPROVED' | 'REJECTED', extra: Record<string, unknown> = {}) {
  return { proposalId, decision, reviewerId: REVIEWER, decidedAt: DECIDED_AT, ...extra }
}

test('a wrapped proposal appears as pending with its identity and names', () => {
  const item = createMatchReviewItem(proposal(), {
    companyName: 'DEMO — AgriSolar Systems Private Limited',
    sourceName: 'Fixture Rural Water Supply Tender',
    createdAt: CREATED_AT,
  })
  assert.equal(item.reviewStatus, 'PENDING')
  assert.deepEqual(item.audit, [])
  assert.equal(item.companyName, 'DEMO — AgriSolar Systems Private Limited')
  assert.equal(item.sourceName, 'Fixture Rural Water Supply Tender')
  assert.equal(item.createdAt, CREATED_AT)
  assert.ok(Object.isFrozen(item))
})

test('pending approves and rejects with reviewer, timestamp, and history', () => {
  const approved = applyMatchReviewDecision(
    createMatchReviewItem(proposal(), { createdAt: CREATED_AT }),
    decide('MP:MATCH-RULES-v1:RFB-T1:COMP-001', 'APPROVED'),
  )
  assert.equal(approved.reviewStatus, 'APPROVED')
  assert.equal(approved.updatedAt, DECIDED_AT)
  assert.deepEqual(approved.audit, [
    {
      proposalId: 'MP:MATCH-RULES-v1:RFB-T1:COMP-001',
      previousStatus: 'PENDING',
      newStatus: 'APPROVED',
      reviewerId: REVIEWER,
      decidedAt: DECIDED_AT,
      reason: null,
    },
  ])

  const rejected = applyMatchReviewDecision(
    createMatchReviewItem(proposal(), { createdAt: CREATED_AT }),
    decide('MP:MATCH-RULES-v1:RFB-T1:COMP-001', 'REJECTED', { reason: 'Wrong sector.' }),
  )
  assert.equal(rejected.reviewStatus, 'REJECTED')
  assert.equal(rejected.audit[0].reason, 'Wrong sector.')
})

test('terminal reviews cannot be decided again', () => {
  assert.deepEqual(canMatchTransition('PENDING', 'APPROVED'), true)
  assert.deepEqual(canMatchTransition('PENDING', 'REJECTED'), true)
  assert.deepEqual(canMatchTransition('APPROVED', 'APPROVED'), false)
  assert.deepEqual(canMatchTransition('APPROVED', 'REJECTED'), false)
  assert.deepEqual(canMatchTransition('REJECTED', 'APPROVED'), false)

  const approved = applyMatchReviewDecision(
    createMatchReviewItem(proposal(), { createdAt: CREATED_AT }),
    decide('MP:MATCH-RULES-v1:RFB-T1:COMP-001', 'APPROVED'),
  )
  assert.throws(
    () => applyMatchReviewDecision(approved, decide('MP:MATCH-RULES-v1:RFB-T1:COMP-001', 'REJECTED')),
    /invalid match review transition: APPROVED -> REJECTED/,
  )
})

test('reviewer and decided-at are required for both decisions', () => {
  const item = () => createMatchReviewItem(proposal(), { createdAt: CREATED_AT })
  for (const decision of ['APPROVED', 'REJECTED'] as const) {
    assert.throws(
      () => applyMatchReviewDecision(item(), { ...decide('MP:MATCH-RULES-v1:RFB-T1:COMP-001', decision), reviewerId: '' }),
      /reviewer id is required/,
    )
    assert.throws(
      () => applyMatchReviewDecision(item(), { ...decide('MP:MATCH-RULES-v1:RFB-T1:COMP-001', decision), decidedAt: '' }),
      /decided-at timestamp is required/,
    )
  }
  assert.throws(
    () => applyMatchReviewDecision(item(), decide('MP:MATCH-RULES-v1:OTHER:COMP-001', 'APPROVED')),
    /does not match review item/,
  )
})

test('decisions never modify the underlying proposal', () => {
  const original = proposal()
  const snapshot = JSON.parse(JSON.stringify(original)) as unknown
  const item = createMatchReviewItem(original, { createdAt: CREATED_AT })
  const decided = applyMatchReviewDecision(item, decide(original.proposalId, 'APPROVED'))
  assert.deepEqual(original, snapshot, 'the input proposal object is untouched')
  assert.deepEqual(decided.proposal, snapshot, 'the wrapped proposal is byte-identical after deciding')
  assert.ok(Object.isFrozen(decided))
  assert.ok(!('score' in decided.proposal) && !('match_id' in decided), 'no score, no Match identity')
})
