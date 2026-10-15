/**
 * Maps a live discovery candidate to the matching engine's verified-opportunity
 * input — the bridge from Workstream 3 (trustworthy discovery) to Workstream 5
 * (real matching).
 *
 * The eligibility lifecycle state is NEVER guessed here: it is the shared
 * classifier's verdict (`classifyOpportunityState`), so an opportunity reaches
 * the match engine as `open` only when the source itself says it is open, a
 * parseable deadline is in the future, and the official link is present. A
 * candidate without a real official URL and source identifier is marked
 * `unverified` and will be refused by the match assembly — missing evidence
 * stays missing.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import type { DiscoveryCandidate } from './candidate'
import { classifyOpportunityState } from './opportunity-status'
import type { VerifiedOpportunityRecord } from './match-assembly'

export const OPPORTUNITY_MATCH_INPUT_VERSION = 'opp-match-input-1'

/**
 * Builds the match-engine opportunity input for one candidate. Pure and total:
 * a malformed/partial candidate still yields a record with `unknown` eligibility
 * and `unverified` provenance rather than throwing or fabricating.
 */
export function candidateToVerifiedOpportunity(
  candidate: DiscoveryCandidate,
  now: string,
): VerifiedOpportunityRecord {
  const officialUrl = typeof candidate.sourceUrl === 'string' ? candidate.sourceUrl.trim() : ''
  const hasOfficialIdentity = officialUrl.length > 0 && candidate.sourceRecordId !== null
  const observedAt =
    candidate.provenance !== null && typeof candidate.provenance?.observedAt === 'string'
      ? candidate.provenance.observedAt
      : now

  return {
    record: {
      recordId: candidate.sourceRecordId ?? candidate.candidateId,
      recordType: 'opportunity',
      name: candidate.sourceTitle,
      country: candidate.sourceCountry ?? null,
      // The candidate contract carries no industry list; it stays absent.
      industries: null,
      description: candidate.sourceSummary ?? null,
    },
    provenance: {
      source: officialUrl.length > 0 ? officialUrl : `candidate:${candidate.candidateId}`,
      verifiedAt: observedAt.slice(0, 10),
      status: hasOfficialIdentity ? 'verified' : 'unverified',
    },
    eligibility: classifyOpportunityState(candidate, now).state,
  }
}
