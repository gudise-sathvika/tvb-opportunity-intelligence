/**
 * Phase 16 additive company-identity evidence model — pure, side-effect-free.
 *
 * GLEIF answers "which LEI records match this text", never "which company the
 * user means". This module keeps every identity stage distinct so ambiguous or
 * unverified records stay out of matching without ever calling a business fake:
 *
 *  - directory entry (original search key; never renamed or merged here);
 *  - entity candidate (a real source record; not the intended company yet);
 *  - verified legal entity (authoritative evidence: active GLEIF record, or a
 *    record from another official registry via the `RegistryVerifier`
 *    contract — NO LEI format requirement exists anywhere in the matching
 *    contract, so non-LEI entities are representable without fabrication);
 *  - user-confirmed identity (explicit authorized confirmation + audit note);
 *  - matchable profile (verified identity AND confirmation).
 *
 * Outcome vocabulary (never collapsed to real/fake): `verified_legal_entity`,
 * `business_presence_only`, `ambiguous_entity`, `not_found_in_searched_sources`,
 * `source_unavailable`, `needs_user_input`, `not_applicable_to_company_verification`,
 * `not_checked`.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import { deepFreeze } from './candidate'

export const IDENTITY_EVIDENCE_VERSION = 'identity-1' as const

export const IDENTITY_OUTCOMES = [
  'verified_legal_entity',
  'business_presence_only',
  'ambiguous_entity',
  'not_found_in_searched_sources',
  'source_unavailable',
  'needs_user_input',
  'not_applicable_to_company_verification',
  'not_checked',
] as const
export type IdentityOutcome = (typeof IDENTITY_OUTCOMES)[number]

/** One identity evidence item: what was observed, where, when. */
export interface IdentityEvidence {
  readonly evidenceType: string
  readonly sourceName: string
  readonly sourceUrl: string | null
  readonly registeredName: string | null
  readonly jurisdiction: string | null
  readonly registrationNumber: string | null
  readonly lei: string | null
  readonly entityStatus: string | null
  readonly retrievedAt: string
  readonly outcome: IdentityOutcome
  readonly fieldsSupported: readonly string[]
  readonly note: string | null
}

/** A real source record that might (or might not) be the intended company. */
export interface EntityCandidate {
  readonly candidateId: string
  readonly directoryName: string
  readonly registeredName: string
  readonly companyId: string | null
  readonly outcome: IdentityOutcome
  readonly evidence: readonly IdentityEvidence[]
}

/** Explicit authorized confirmation of the intended legal entity. */
export interface IdentityConfirmation {
  readonly candidateId: string
  readonly companyId: string
  readonly confirmedBy: string
  readonly confirmedAt: string
  readonly note: string | null
}

/**
 * Typed contract for an additional official-registry verifier (UK Companies
 * House, a US state registry, MCA India, …). No second live integration exists
 * yet: registry access (keys, licensing, rate limits) was verified as
 * unavailable without credentials in Phase 16 (OpenCorporates: HTTP 401). An
 * implementation must return candidates built ONLY from actual source records.
 */
export interface RegistryVerifier {
  readonly registryName: string
  verifyLegalName(directoryName: string, retrievedAt: string): Promise<readonly EntityCandidate[]>
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Records an authorized user's confirmation of the intended entity. Pure:
 * returns the confirmation object; applying/storing it is the caller's job.
 * Confirmation never invents identity — the candidate must already be a
 * `verified_legal_entity`.
 */
export function confirmEntityCandidate(
  candidate: EntityCandidate,
  confirmedBy: string,
  confirmedAt: string,
  note: string | null = null,
): IdentityConfirmation | null {
  if (candidate.outcome !== 'verified_legal_entity') return null
  if (!isNonEmptyString(confirmedBy) || candidate.companyId === null) return null
  return deepFreeze({
    candidateId: candidate.candidateId,
    companyId: candidate.companyId,
    confirmedBy: confirmedBy.trim(),
    confirmedAt,
    note,
  })
}

/**
 * Resolves which verified company ids may enter matching: exactly the
 * confirmed ones. `undefined` (no confirmation step taken) preserves the
 * pre-16 behavior of evaluating every verified hit; an explicit (possibly
 * empty) list restricts to those ids. Unconfirmed hits are never claimed as
 * the intended company by this function — it only partitions ids.
 */
export function resolveConfirmedIdentities(
  verifiedCompanyIds: readonly string[],
  confirmedCompanyIds: readonly string[] | undefined,
): { readonly confirmed: readonly string[]; readonly unconfirmed: readonly string[] } {
  if (confirmedCompanyIds === undefined) return { confirmed: [...verifiedCompanyIds], unconfirmed: [] }
  const wanted = new Set(confirmedCompanyIds)
  return {
    confirmed: verifiedCompanyIds.filter((id) => wanted.has(id)),
    unconfirmed: verifiedCompanyIds.filter((id) => !wanted.has(id)),
  }
}

/**
 * Phase 30: capability-evidence provenance tiers. A capability statement is
 * only as trustworthy as its origin — this vocabulary keeps the origin
 * attached so unverified claims can never be mistaken for confirmed facts.
 * Types only: recording company-provided or human-confirmed capabilities
 * awaits a persistence decision (stores are session-only), so no input path
 * constructs these yet outside tests.
 */
export const CAPABILITY_EVIDENCE_TIERS = [
  'company_provided',
  'source_supported',
  'human_confirmed',
  'unknown',
] as const
export type CapabilityEvidenceTier = (typeof CAPABILITY_EVIDENCE_TIERS)[number]

/** One capability statement with its provenance tier and evidence trail. */
export interface CapabilityEvidence {
  readonly capability: string
  readonly tier: CapabilityEvidenceTier
  readonly sourceName: string | null
  readonly sourceUrl: string | null
  readonly retrievedAt: string | null
  readonly confirmedBy: string | null
  readonly confirmedAt: string | null
  readonly note: string | null
}

/**
 * Classifies a claimed capability into its honest tier from what is actually
 * evidenced. Company assertions without a source stay `company_provided`;
 * only an official source yields `source_supported`, and only an explicit
 * authorized confirmation yields `human_confirmed`. Absence of any claim is
 * `unknown` — never a negative.
 */
export function classifyCapabilityEvidence(input: {
  readonly capability: string | null
  readonly officialSourceUrl?: string | null
  readonly confirmedBy?: string | null
}): { readonly tier: CapabilityEvidenceTier; readonly note: string } {
  const capability = (input.capability ?? '').trim()
  if (capability === '') return { tier: 'unknown', note: 'no capability claimed' }
  if ((input.confirmedBy ?? '').trim() !== '' && input.officialSourceUrl != null) {
    return { tier: 'human_confirmed', note: 'explicitly reviewed against an official source' }
  }
  if (input.officialSourceUrl != null) {
    return { tier: 'source_supported', note: 'backed by an official source; legal identity still separate' }
  }
  return { tier: 'company_provided', note: 'company assertion only; not independently verified' }
}
