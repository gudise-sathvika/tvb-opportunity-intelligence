/**
 * Guarded match assembly — Phase 25.
 *
 * The single place that turns verified inputs into Phase L match proposals for
 * the REAL Match Review queue. It is pure and total: no clock, no network, no
 * filesystem. It proposes nothing unless both sides of a pair are real and
 * traceable, and every input it refuses is reported, never silently dropped or
 * fabricated into a proposal.
 *
 * Guards (a pair is only proposed when ALL hold):
 *  - the company passes `isVerifiedCompanyProfile` (valid identity + complete
 *    verified provenance);
 *  - the opportunity has a valid identity, verified provenance, and a verified
 *    lifecycle state of exactly `open` — forthcoming/expired/closed/historical/
 *    unknown opportunities are never matched;
 *  - `proposeMatch` then runs unchanged. Missing evidence stays missing: a
 *    signal whose side is absent produces a `missing` note and never counts as a
 *    match, so a proposal is `PROPOSED` only when real evidence overlaps.
 *
 * Empty input yields no proposals — the honest state while no verified company
 * profiles exist. This module never substitutes a fixture.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import {
  proposeMatches,
  type MatchProposal,
  type MatchSourceRecord,
} from './match-proposal'
import {
  isVerifiedCompanyProfile,
  toMatchCompanyRecord,
  type RecordProvenance,
  type VerifiedCompanyProfile,
} from './company-profile'

/** The lifecycle states a verified opportunity can carry (Phase 22 vocabulary). */
export type OpportunityEligibility =
  | 'open'
  | 'forthcoming'
  | 'expired'
  | 'closed'
  | 'historical'
  | 'unknown'

export interface VerifiedOpportunityRecord {
  record: MatchSourceRecord
  provenance: RecordProvenance
  /** The opportunity's verified lifecycle state. Only `open` is ever matched. */
  eligibility: OpportunityEligibility
}

export interface MatchAssemblyInput {
  companies: readonly VerifiedCompanyProfile[]
  opportunities: readonly VerifiedOpportunityRecord[]
}

export interface SkippedInput {
  id: string
  reason: string
}

export interface MatchAssemblyResult {
  proposals: readonly MatchProposal[]
  skippedCompanies: readonly SkippedInput[]
  skippedOpportunities: readonly SkippedInput[]
}

function isOpenOpportunity(value: VerifiedOpportunityRecord): boolean {
  return value.eligibility === 'open'
}

function hasVerifiedOpportunityProvenance(value: VerifiedOpportunityRecord): boolean {
  const p = value.provenance
  return (
    p !== undefined &&
    p !== null &&
    p.status === 'verified' &&
    typeof p.source === 'string' &&
    p.source.trim().length > 0 &&
    typeof p.verifiedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}/.test(p.verifiedAt)
  )
}

/**
 * Assembles proposals for every (verified open opportunity × verified company)
 * pair, preserving input order. Refuses, with a reason, any input that is not
 * real and traceable; refuses nothing silently.
 */
export function assembleMatchProposals(input: MatchAssemblyInput): MatchAssemblyResult {
  const companies = input.companies ?? []
  const opportunities = input.opportunities ?? []

  const skippedCompanies: SkippedInput[] = []
  const matchableCompanies: VerifiedCompanyProfile[] = []
  for (const profile of companies) {
    const ok: boolean = isVerifiedCompanyProfile(profile)
    if (ok) {
      matchableCompanies.push(profile)
      continue
    }
    const id = (profile as VerifiedCompanyProfile | null | undefined)?.companyId
    skippedCompanies.push({
      id: typeof id === 'string' && id.length > 0 ? id : '(unknown company)',
      reason: 'not a verified company profile (missing identity or verified provenance)',
    })
  }

  const skippedOpportunities: SkippedInput[] = []
  const matchableOpportunities = opportunities.filter((entry) => {
    const id =
      entry !== null && entry !== undefined && typeof entry.record?.recordId === 'string'
        ? entry.record.recordId
        : '(unknown opportunity)'
    if (entry === null || entry === undefined || typeof entry.record !== 'object') {
      skippedOpportunities.push({ id, reason: 'missing opportunity record' })
      return false
    }
    if (!hasVerifiedOpportunityProvenance(entry)) {
      skippedOpportunities.push({ id, reason: 'opportunity has no verified provenance' })
      return false
    }
    if (!isOpenOpportunity(entry)) {
      skippedOpportunities.push({
        id,
        reason: `opportunity is ${String(entry.eligibility)}, not open`,
      })
      return false
    }
    return true
  })

  const proposals: MatchProposal[] = []
  for (const opportunity of matchableOpportunities) {
    for (const profile of matchableCompanies) {
      proposals.push(...proposeMatches(opportunity.record, [toMatchCompanyRecord(profile)]))
    }
  }

  return Object.freeze({
    proposals: Object.freeze(proposals),
    skippedCompanies: Object.freeze(skippedCompanies),
    skippedOpportunities: Object.freeze(skippedOpportunities),
  })
}
