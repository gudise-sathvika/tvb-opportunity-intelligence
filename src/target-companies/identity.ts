/**
 * Phase 1B additive identity-verification foundation for uploaded target
 * companies.
 *
 * Uploaded target companies remain separate from the existing 188-company
 * directory. Original CSV values are preserved in `source`; verified claims,
 * source URLs, retrieval times, and statuses are stored separately.
 *
 * This module is pure and side-effect-free. It does not call registries,
 * networks, discovery, matching, approvals, or the Vault. Identity verification
 * is never treated as proof of capabilities, eligibility, or relevance.
 */

import type { IdentityEvidence, IdentityOutcome } from '../automation/company-identity'

export type TargetCompanyMatchingReadiness =
  | 'ready'
  | 'limited'
  | 'deferred'
  | 'insufficient_evidence'

export interface TargetCompanySourceInput {
  readonly rowNumber: number
  readonly headers: readonly string[]
  readonly values: readonly string[]
  readonly fileName?: string
  readonly uploadedAt?: string
}

export interface TargetCompanyIdentityClaim {
  readonly field: string
  readonly value: string
  readonly sourceName: string
  readonly sourceUrl: string | null
  readonly retrievedAt: string
  readonly status: 'supplied' | 'verified' | 'conflicting' | 'unavailable' | 'unknown'
  readonly note: string | null
}

export interface TargetCompanyIdentityProfile {
  readonly source: TargetCompanySourceInput
  readonly identityStatus: IdentityOutcome
  /** Verified legal/canonical name only; null when not verified. */
  readonly canonicalName: string | null
  /** Verified canonical URL only; null when not verified. */
  readonly canonicalUrl: string | null
  readonly claims: readonly TargetCompanyIdentityClaim[]
  readonly conflicts: readonly string[]
  readonly readiness: TargetCompanyMatchingReadiness
  readonly readinessReasons: readonly string[]
}

export function createUnverifiedTargetCompanyIdentity(
  source: TargetCompanySourceInput,
): TargetCompanyIdentityProfile {
  return {
    source,
    identityStatus: 'not_checked',
    canonicalName: null,
    canonicalUrl: null,
    claims: [],
    conflicts: [],
    readiness: 'insufficient_evidence',
    readinessReasons: ['Identity has not been checked against an official source.'],
  }
}

export function isIdentityClaimVerified(claim: TargetCompanyIdentityClaim): boolean {
  return claim.status === 'verified' && claim.value.trim() !== ''
}

export function applyIdentityEvidence(
  profile: TargetCompanyIdentityProfile,
  outcome: IdentityOutcome,
  evidence: IdentityEvidence,
  conflicts: readonly string[] = [],
): TargetCompanyIdentityProfile {
  const claim: TargetCompanyIdentityClaim = {
    field: evidence.fieldsSupported[0] ?? 'identity',
    value: evidence.registeredName ?? evidence.jurisdiction ?? '',
    sourceName: evidence.sourceName,
    sourceUrl: evidence.sourceUrl,
    retrievedAt: evidence.retrievedAt,
    status: outcome === 'verified_legal_entity' ? 'verified' : outcome === 'ambiguous_entity' ? 'conflicting' : 'unavailable',
    note: evidence.note,
  }

  const verified = outcome === 'verified_legal_entity'
  const canonicalName = verified ? evidence.registeredName : profile.canonicalName
  const canonicalUrl = verified ? evidence.sourceUrl : profile.canonicalUrl
  const nextConflicts = [...profile.conflicts, ...conflicts]

  const readiness = computeReadiness(outcome, nextConflicts.length > 0)
  const reasons = readinessReasons(outcome, nextConflicts)

  return {
    source: profile.source,
    identityStatus: outcome,
    canonicalName,
    canonicalUrl,
    claims: [...profile.claims, claim],
    conflicts: nextConflicts,
    readiness,
    readinessReasons: reasons,
  }
}

function computeReadiness(outcome: IdentityOutcome, hasConflicts: boolean): TargetCompanyMatchingReadiness {
  if (outcome === 'verified_legal_entity') return hasConflicts ? 'limited' : 'limited'
  if (outcome === 'ambiguous_entity') return 'deferred'
  if (outcome === 'needs_user_input') return 'deferred'
  if (outcome === 'source_unavailable') return 'deferred'
  if (outcome === 'not_found_in_searched_sources') return 'insufficient_evidence'
  if (outcome === 'business_presence_only') return 'limited'
  return 'insufficient_evidence'
}

function readinessReasons(outcome: IdentityOutcome, conflicts: readonly string[]): string[] {
  const reasons: string[] = []
  if (outcome === 'verified_legal_entity') {
    reasons.push('Legal identity is verified, but capabilities, eligibility, and opportunity relevance remain unverified.')
  } else if (outcome === 'ambiguous_entity') {
    reasons.push('Identity is ambiguous; user confirmation is required before matching.')
  } else if (outcome === 'needs_user_input') {
    reasons.push('Additional user input is required before identity can be resolved.')
  } else if (outcome === 'source_unavailable') {
    reasons.push('Identity source was unavailable; no conclusion was drawn.')
  } else if (outcome === 'not_found_in_searched_sources') {
    reasons.push('No matching legal entity was found in searched sources.')
  } else if (outcome === 'business_presence_only') {
    reasons.push('Only business presence was found; legal identity is not verified.')
  } else {
    reasons.push('Identity has not been checked against an official source.')
  }
  if (conflicts.length > 0) {
    reasons.push(...conflicts)
  }
  reasons.push('Capabilities, ICP, eligibility, and opportunity relevance remain unknown unless separately evidenced.')
  return reasons
}

export function isIdentityVerified(profile: TargetCompanyIdentityProfile): boolean {
  return profile.identityStatus === 'verified_legal_entity' && profile.canonicalName !== null
}