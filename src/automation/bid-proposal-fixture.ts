/**
 * Bid-proposal demo universe — Phase R.
 *
 * The REAL Bid identities and notice×company pairs are transcribed from the
 * committed snapshot (`opportunity-data.json`, `records.bids`), so the Q review
 * demo can detect *real* conflicts (e.g. the APPROVED RFB-001×COMP-001 match
 * resolves to BID-001, which already exists) with zero Vault access. The
 * helper feeds a review item through the pure Phase R proposer using exactly
 * that universe — nothing here reads, writes, or creates a record.
 */

import type { BidDecision, BidProposalResult } from './bid-proposal'
import { proposeBidFromApprovedMatch } from './bid-proposal'
import { procurementMatchReviewFixtureStore } from './procurement-match-fixture'

/** Real Bid ids existing in the vault snapshot, transcribed. */
export const REAL_BID_IDS: readonly string[] = Object.freeze([
  'BID-001',
  'BID-002',
  'BID-003',
  'BID-004',
  'BID-005',
])

/** Real notice×company pairs (`noticeId|companyId`), transcribed from the
 *  snapshot's five Bid records. */
export const REAL_BID_PAIRS: readonly string[] = Object.freeze([
  'RFB-001|COMP-001', // BID-001 — AgriSolar on Rooftop Solar
  'RFB-002|COMP-002', // BID-002 — Northfield on Water-Quality Data
  'RFB-003|COMP-001', // BID-003 — AgriSolar on Pump Station (decision: No bid)
  'RFB-002|COMP-003', // BID-004 — Sarva Jal on Water-Quality Data
  'RFB-002|COMP-001', // BID-005 — AgriSolar on Water-Quality Data
])

export interface BidProposalDemoRequest {
  proposalId: string
  decision: BidDecision
  deciderId: string
  decidedAt: string
}

/** Feeds one Q review item and a human Bid decision through the Phase R
 *  proposer against the real transcribed Bid universe. Deterministic; no write. */
export function proposeBidDecision(input: BidProposalDemoRequest): BidProposalResult {
  const item = procurementMatchReviewFixtureStore.item(input.proposalId)
  if (item === undefined) {
    return {
      outcome: 'rejected',
      reason: `unknown procurement match proposal: ${input.proposalId}`,
    }
  }
  return proposeBidFromApprovedMatch({
    item,
    decision: input.decision,
    deciderId: input.deciderId,
    decidedAt: input.decidedAt,
    existingBidIds: REAL_BID_IDS,
    existingBidPairs: REAL_BID_PAIRS,
  })
}