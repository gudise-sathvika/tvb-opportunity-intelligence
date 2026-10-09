/**
 * Phase R ProcurementMatch → Bid decision tests. Focused proofs:
 *  approved + BID → deterministic Bid proposal; approved + DO_NOT_BID → no
 *  proposal; pending/rejected → rejected; approval enforcement; existing-Bid
 *  conflicts (id and pair); Notice/Company relationships preserved; no
 *  invented business fields; no Contract; no funding Match/Application
 *  shapes; no Vault writes; no network; repeated input deterministic.
 *  No scores, no I/O, no records anywhere.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

import type { ProcurementMatchProposal } from './procurement-proposal'
import { PMATCH_RULES_VERSION } from './procurement-proposal'
import type { ProcurementMatchReviewItem } from './procurement-match-review'
import {
  applyProcurementMatchReviewDecision,
  createProcurementMatchReviewItem,
} from './procurement-match-review'
import {
  BID_DECISION_VALUE,
  DEFAULT_BID_STATUS,
  DEFAULT_ELIGIBILITY_STATUS,
  deriveBidId,
  MANUAL_BID_FIELDS,
  proposeBidFromApprovedMatch,
} from './bid-proposal'
import { proposeBidDecision, REAL_BID_IDS, REAL_BID_PAIRS } from './bid-proposal-fixture'
import { procurementMatchReviewFixtureStore } from './procurement-match-fixture'

const REVIEWER = 'RVW-900'
const DECIDER = 'RVW-300'
const DECIDED_AT = '2026-10-19T00:00:00.000Z'
const CREATED_AT = '2026-10-13T00:00:00.000Z'

function proposal(overrides: Partial<ProcurementMatchProposal> = {}): ProcurementMatchProposal {
  return {
    proposalId: 'PP:PMATCH-RULES-v1:RFB-003:COMP-003',
    ruleVersion: PMATCH_RULES_VERSION,
    recordType: 'notice' as const,
    noticeId: 'RFB-003',
    companyId: 'COMP-003',
    matchedSignals: ['country-compatibility'],
    missingSignals: ['industry-overlap', 'keyword-overlap', 'capability-overlap'],
    status: 'PROPOSED',
    evidence: [
      { signal: 'country-compatibility', sourceField: 'country', companyField: 'country', values: ['india'], outcome: 'matched' as const, note: 'Company and notice are both India.' },
      { signal: 'industry-overlap', sourceField: 'industries', companyField: 'industries', values: [], outcome: 'missing' as const, note: 'RFP industry unavailable.' },
    ],
    ...overrides,
  }
}

function item(overrides: {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED'
  audit?: readonly unknown[]
  proposal?: ReturnType<typeof proposal>
} = {}): ProcurementMatchReviewItem {
  let base = createProcurementMatchReviewItem(proposal(overrides.proposal ?? {}), {
    noticeName: 'DEMO — Pump Station Rehabilitation — Single Source',
    companyName: 'DEMO — Sarva Jal Technologies LLP',
    createdAt: CREATED_AT,
  })
  if (overrides.status === 'APPROVED') {
    base = applyProcurementMatchReviewDecision(base, {
      proposalId: base.proposal.proposalId,
      decision: 'APPROVED',
      reviewerId: REVIEWER,
      decidedAt: '2026-10-15T00:00:00.000Z',
    })
  } else if (overrides.status === 'REJECTED') {
    base = applyProcurementMatchReviewDecision(base, {
      proposalId: base.proposal.proposalId,
      decision: 'REJECTED',
      reviewerId: REVIEWER,
      decidedAt: '2026-10-16T00:00:00.000Z',
    })
  }
  if (overrides.audit !== undefined) {
    base = { ...base, audit: overrides.audit as ProcurementMatchReviewItem['audit'] }
  }
  return base
}

const NO_EXISTING: { existingBidIds: readonly string[]; existingBidPairs: readonly string[] } = {
  existingBidIds: [],
  existingBidPairs: [],
}

test('1. an APPROVED procurement match with BID yields a deterministic Bid proposal', () => {
  const first = proposeBidFromApprovedMatch({ item: item({ status: 'APPROVED' }), decision: 'BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  const second = proposeBidFromApprovedMatch({ item: item({ status: 'APPROVED' }), decision: 'BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  assert.equal(first.outcome, 'proposed')
  assert.deepEqual(first, second, 'proposal and verdict identical on repeated input')
  if (first.outcome !== 'proposed') return
  assert.match(first.bidId, /^BID-\d{3}$/)
  assert.equal(first.bidId, deriveBidId('PP:PMATCH-RULES-v1:RFB-003:COMP-003'), 'bid id derives from the match proposal id')
  assert.deepEqual(first.missingRequiredFields, [], 'all schema-required Bid fields are covered')
  assert.deepEqual(first.manualFields, MANUAL_BID_FIELDS)
})

test('2. an APPROVED procurement match with DO_NOT_BID produces no Bid proposal', () => {
  const result = proposeBidFromApprovedMatch({ item: item({ status: 'APPROVED' }), decision: 'DO_NOT_BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  assert.equal(result.outcome, 'no_bid')
  assert.match((result as { reason: string }).reason, /no Bid proposal/)
})

test('3. a PENDING procurement match rejects the Bid decision', () => {
  const result = proposeBidFromApprovedMatch({ item: item({ status: 'PENDING' }), decision: 'BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  assert.equal(result.outcome, 'rejected')
  assert.match((result as { reason: string }).reason, /only APPROVED/)
})

test('4. a REJECTED procurement match rejects the Bid decision even with BID', () => {
  const result = proposeBidFromApprovedMatch({ item: item({ status: 'REJECTED' }), decision: 'BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  assert.equal(result.outcome, 'rejected')
  assert.match((result as { reason: string }).reason, /only APPROVED/)
})

test('5. reviewer/approval requirements stay enforced (status, audit, decider, timestamp)', () => {
  // APPROVED status but no complete human approval entry → rejected.
  const noAudit = proposeBidFromApprovedMatch({ item: item({ status: 'APPROVED', audit: [] }), decision: 'BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  assert.equal(noAudit.outcome, 'rejected')
  assert.match((noAudit as { reason: string }).reason, /no complete human approval/)
  // Missing decider / timestamp throw, as in the review boundary.
  const approved = item({ status: 'APPROVED' })
  assert.throws(
    () => proposeBidFromApprovedMatch({ item: approved, decision: 'BID', deciderId: '', decidedAt: DECIDED_AT, ...NO_EXISTING }),
    /decision-maker id is required/,
  )
  assert.throws(
    () => proposeBidFromApprovedMatch({ item: approved, decision: 'BID', deciderId: DECIDER, decidedAt: '', ...NO_EXISTING }),
    /decided-at timestamp is required/,
  )
})

test('6. existing Bid conflicts are detected and never overwritten', () => {
  const idConflict = proposeBidFromApprovedMatch({
    item: item({ status: 'APPROVED' }),
    decision: 'BID',
    deciderId: DECIDER,
    decidedAt: DECIDED_AT,
    existingBidIds: [deriveBidId('PP:PMATCH-RULES-v1:RFB-003:COMP-003')],
    existingBidPairs: [],
  })
  assert.equal(idConflict.outcome, 'conflict')
  assert.match((idConflict as { reason: string }).reason, /refusing to overwrite/)

  const pairConflict = proposeBidFromApprovedMatch({
    item: item({ status: 'APPROVED' }),
    decision: 'BID',
    deciderId: DECIDER,
    decidedAt: DECIDED_AT,
    existingBidIds: [],
    existingBidPairs: ['RFB-003|COMP-003'],
  })
  assert.equal(pairConflict.outcome, 'conflict')
  assert.match((pairConflict as { reason: string }).reason, /already exists — refusing to create a duplicate/)
})

test('7. the Notice relationship is preserved on the Bid proposal', () => {
  const result = proposeBidFromApprovedMatch({ item: item({ status: 'APPROVED' }), decision: 'BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  if (result.outcome !== 'proposed') return assert.fail('expected a proposal')
  assert.equal(result.payload.notice, '[[RFB-003 — DEMO — Pump Station Rehabilitation — Single Source]]')
})

test('8. the Company relationship is preserved on the Bid proposal', () => {
  const result = proposeBidFromApprovedMatch({ item: item({ status: 'APPROVED' }), decision: 'BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  if (result.outcome !== 'proposed') return assert.fail('expected a proposal')
  assert.equal(result.payload.company, '[[COMP-003 — DEMO — Sarva Jal Technologies LLP]]')
})

test('9. no invented business fields: defaults only, nothing commercial or eligibility-invented', () => {
  const result = proposeBidFromApprovedMatch({ item: item({ status: 'APPROVED' }), decision: 'BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  if (result.outcome !== 'proposed') return assert.fail('expected a proposal')
  const payload = result.payload as Record<string, string>
  assert.equal(payload.bid_decision, BID_DECISION_VALUE, 'Axis-2 decision maps to the existing Bid vocabulary')
  assert.equal(payload.bid_status, DEFAULT_BID_STATUS, 'workflow-neutral starting lifecycle only')
  assert.equal(payload.eligibility_status, DEFAULT_ELIGIBILITY_STATUS, 'no eligibility fact invented')
  assert.equal(payload.bid_decision_date, DECIDED_AT.slice(0, 10), 'the human decision date, date precision only')
  assert.equal(payload.decided_by, DECIDER, 'the human decision-maker')
  for (const field of MANUAL_BID_FIELDS) {
    assert.equal(field in payload, false, `${field} must remain absent`)
  }
  assert.deepEqual(result.manualFields, MANUAL_BID_FIELDS)
})

test('10. no Contract is ever created or implied by a Bid proposal', () => {
  const result = proposeBidFromApprovedMatch({ item: item({ status: 'APPROVED' }), decision: 'BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  if (result.outcome !== 'proposed') return assert.fail('expected a proposal')
  for (const key of Object.keys(result.payload)) {
    assert.ok(!key.includes('contract'), `payload must not carry a contract field: ${key}`)
  }
  assert.ok(!('contract_id' in result.payload))
  assert.ok(!('award_date' in result.payload))
})

test('11. no funding Match/Application shape is produced or affected', () => {
  const result = proposeBidFromApprovedMatch({ item: item({ status: 'APPROVED' }), decision: 'BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  if (result.outcome !== 'proposed') return assert.fail('expected a proposal')
  for (const key of Object.keys(result.payload)) {
    assert.ok(!key.includes('application'), `no application field: ${key}`)
    assert.ok(!key.includes('match_score') && !key.includes('confidence'), `no invented scoring: ${key}`)
  }
  const payloadText = JSON.stringify(result.payload)
  assert.ok(!payloadText.includes('MATCH-00'), 'no funding Match id referenced')
  assert.ok(!payloadText.includes('APP-0'), 'no Application id referenced')
  assert.ok(!payloadText.includes('CON-0'), 'no Contract id referenced')
})

test('12. no Vault write: the proposal is a pure data payload with no source/Vault identity', () => {
  const result = proposeBidFromApprovedMatch({ item: item({ status: 'APPROVED' }), decision: 'BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  if (result.outcome !== 'proposed') return assert.fail('expected a proposal')
  for (const key of Object.keys(result.payload)) {
    assert.ok(key !== 'sourceFile' && key !== 'sourceSha256' && key !== 'type', `no vault framing on payload: ${key}`)
  }
  const source = readFileSync(new URL('./bid-proposal.ts', import.meta.url), 'utf8')
  for (const token of ['writeFile', 'node:fs', 'appendFile(', 'createWriteStream']) {
    assert.ok(!source.includes(token), `bid-proposal.ts must not contain ${token}`)
  }
})

test('13. the Bid decisions close the network and clock out of the module', () => {
  const source = readFileSync(new URL('./bid-proposal.ts', import.meta.url), 'utf8')
  for (const token of ['fetch(', 'axios', 'XMLHttpRequest', 'node:http', 'node:net', 'WebSocket', 'Date.now', 'new Date', 'setTimeout(', 'import(']) {
    assert.ok(!source.includes(token), `bid-proposal.ts must not contain ${token}`)
  }
})

test('14. repeated input is fully deterministic across verdict and payload', () => {
  const build = () => proposeBidFromApprovedMatch({ item: item({ status: 'APPROVED' }), decision: 'BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  const runs = [build(), build(), build()]
  assert.deepEqual(runs[0], runs[1])
  assert.deepEqual(runs[0], runs[2])
  const noBid = () => proposeBidFromApprovedMatch({ item: item({ status: 'APPROVED' }), decision: 'DO_NOT_BID', deciderId: DECIDER, decidedAt: DECIDED_AT, ...NO_EXISTING })
  assert.deepEqual(noBid(), noBid())
})

test('the demo universe detects the real BID-001 conflict on the APPROVED fixture pair', () => {
  // RFB-001 × COMP-001 is APPROVED in the Q fixture and already has BID-001.
  const result = proposeBidDecision({
    proposalId: 'PP:PMATCH-RULES-v1:RFB-001:COMP-001',
    decision: 'BID',
    deciderId: DECIDER,
    decidedAt: DECIDED_AT,
  })
  assert.equal(result.outcome, 'conflict')
  const reason = (result as { reason: string }).reason
  assert.match(reason, /BID-001 already exists|already exists — refusing/)
  assert.deepEqual(REAL_BID_IDS, ['BID-001', 'BID-002', 'BID-003', 'BID-004', 'BID-005'])
  assert.equal(REAL_BID_PAIRS.length, 5)
})

test('approving the PENDING RFB-003 × COMP-003 fixture pair then deciding BID proposes a free bid', () => {
  procurementMatchReviewFixtureStore.reset()
  const proposalId = 'PP:PMATCH-RULES-v1:RFB-003:COMP-003'
  procurementMatchReviewFixtureStore.apply({
    proposalId,
    decision: 'APPROVED',
    reviewerId: REVIEWER,
    decidedAt: '2026-10-15T00:00:00.000Z',
  })
  const result = proposeBidDecision({ proposalId, decision: 'BID', deciderId: DECIDER, decidedAt: DECIDED_AT })
  assert.equal(result.outcome, 'proposed')
  if (result.outcome !== 'proposed') return
  assert.equal(result.payload.notice, '[[RFB-003 — DEMO — Pump Station Rehabilitation — Single Source]]')
  assert.equal(result.payload.company, '[[COMP-003 — DEMO — Sarva Jal Technologies LLP]]')
  assert.equal(result.payload.bid_decision, 'Bid')
  procurementMatchReviewFixtureStore.reset()
})