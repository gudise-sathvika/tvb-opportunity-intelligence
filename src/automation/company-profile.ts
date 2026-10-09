/**
 * Verified company profile schema — Phase 25.
 *
 * A VERIFIED COMPANY PROFILE is the only kind of company data the real matching
 * engine may consume. It is deliberately stricter than the name-only directory
 * (`src/data/company-directory-names.ts`, which carries no IDs or attributes)
 * and than the fictional demonstration companies in the Vault:
 *
 *  - it carries the eligibility-relevant attributes MATCH-RULES-v1 reads
 *    (country, industry, description, technology/project focus, certifications);
 *  - it carries PROVENANCE — the authoritative source it was verified against
 *    and the verification date — so any matched evidence can be traced to a
 *    checked fact;
 *  - it declares a verification status, and only `verified` profiles are
 *    matchable.
 *
 * Every attribute beyond id/name/provenance is optional. An absent country or
 * industry is MISSING EVIDENCE, never a default value: this module invents
 * nothing — no countries, industries, sizes, certifications, or capabilities.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import type { MatchCompanyRecord } from './match-proposal'

/** Provenance for one verified fact. `source` is an authoritative source
 *  (a URL or a record id); `verifiedAt` is the ISO date it was checked. */
export interface RecordProvenance {
  source: string
  verifiedAt: string
  status: 'verified' | 'unverified'
}

/**
 * A genuine company profile. The company_id/company_name pair mirrors the Vault
 * Company schema; the attribute fields mirror its controlled lists. Absent
 * fields stay absent.
 */
export interface VerifiedCompanyProfile {
  companyId: string
  name: string
  country?: string | null
  industry?: readonly string[] | null
  businessDescription?: string | null
  technologyFocus?: readonly string[] | null
  projectFocus?: readonly string[] | null
  certifications?: readonly string[] | null
  provenance: RecordProvenance
}

/** ISO calendar date prefix (YYYY-MM-DD). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isVerifiedProvenance(value: unknown): value is RecordProvenance {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as Record<string, unknown>
  return (
    p.status === 'verified' &&
    isNonEmptyString(p.source) &&
    typeof p.verifiedAt === 'string' &&
    ISO_DATE.test(p.verifiedAt)
  )
}

/**
 * The gate every company must pass before matching: a valid identity, a name,
 * and complete verified provenance. A profile without provenance, or one marked
 * `unverified`, is rejected rather than matched.
 */
export function isVerifiedCompanyProfile(value: unknown): value is VerifiedCompanyProfile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as Record<string, unknown>
  if (!isNonEmptyString(p.companyId)) return false
  if (!isNonEmptyString(p.name)) return false
  return isVerifiedProvenance(p.provenance)
}

/**
 * Maps a verified profile to the matching engine's company record. Only present
 * fields are carried through; `capabilities` is the caller-flattened
 * technology_focus + project_focus + certifications lists (aggregation of
 * present fields, never invention).
 */
export function toMatchCompanyRecord(profile: VerifiedCompanyProfile): MatchCompanyRecord {
  const capabilities = [
    ...(profile.technologyFocus ?? []),
    ...(profile.projectFocus ?? []),
    ...(profile.certifications ?? []),
  ]
  return {
    companyId: profile.companyId,
    name: profile.name,
    country: profile.country ?? null,
    industries: profile.industry ?? null,
    description: profile.businessDescription ?? null,
    capabilities: capabilities.length > 0 ? capabilities : null,
  }
}
