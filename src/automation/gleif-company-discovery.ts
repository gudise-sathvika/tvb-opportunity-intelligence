/**
 * Company discovery from GLEIF — the Global Legal Entity Identifier registry.
 *
 * GLEIF publishes the official Legal Entity Identifier (LEI) reference data
 * (ISO 17442) through a read-only, unauthenticated public API. An LEI is a
 * genuine, globally unique legal-identity identifier issued by an accredited
 * Local Operating Unit, so a record sourced here carries real identity
 * evidence — not a name-only guess.
 *
 * This module is PURE: it maps an already-retrieved GLEIF JSON:API response
 * into `VerifiedCompanyProfile` records. It performs no network, clock or
 * filesystem work; the caller supplies the retrieval timestamp (`verifiedAt`).
 *
 * Honesty rules, enforced by design:
 *  - only records whose entity status is `ACTIVE` and whose registration status
 *    is `ISSUED` become verified profiles; anything else is rejected, reported,
 *    never coerced to `verified`;
 *  - the official identity is the LEI, carried verbatim as `LEI-<lei>`;
 *  - `country` is taken ONLY from the registered legal address and is `null`
 *    (missing) when absent — never inferred from a name or a domain;
 *  - `industry`, `businessDescription`, `technologyFocus`, `projectFocus` and
 *    `certifications` are NOT present in this endpoint, so they are left absent
 *    (missing evidence), never invented from the name;
 *  - the provenance source is the official, dereferenceable GLEIF record URL.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import type { VerifiedCompanyProfile } from './company-profile'

export const GLEIF_EVIDENCE_VERSION = 'gleif-company-1'

/** Official GLEIF read-only API host (records the host, never a query). */
export const GLEIF_API_HOST = 'api.gleif.org'

/** A 20-character LEI: 4 LOU id + 2 reserved + 12 entity + 2 check digits. */
const LEI_PATTERN = /^[A-Z0-9]{20}$/

/**
 * ISO 3166-1 alpha-2 → canonical country name, aligned with the discovery
 * pipeline's country vocabulary (`normalizeCountry`: US → United States). This
 * is a factual translation table, not an inference: an unmapped code is carried
 * through unchanged (never guessed), and a missing code stays `null`.
 */
export const GLEIF_ISO_ALPHA2_COUNTRY: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', AE: 'United Arab Emirates',
  FR: 'France', DE: 'Germany', IN: 'India', CA: 'Canada', IE: 'Ireland',
  BE: 'Belgium', FI: 'Finland', NL: 'Netherlands', ES: 'Spain', IT: 'Italy',
  PT: 'Portugal', PL: 'Poland', RO: 'Romania', LV: 'Latvia', SE: 'Sweden',
  NO: 'Norway', DK: 'Denmark', CH: 'Switzerland', AT: 'Austria', LU: 'Luxembourg',
  GR: 'Greece', CZ: 'Czechia', HU: 'Hungary', AU: 'Australia', NZ: 'New Zealand',
  SG: 'Singapore', JP: 'Japan', KR: 'Korea, Republic of', CN: 'China',
  HK: 'Hong Kong', TW: 'Taiwan', BR: 'Brazil', MX: 'Mexico', AR: 'Argentina',
  CL: 'Chile', ZA: 'South Africa', KE: 'Kenya', NG: 'Nigeria', EG: 'Egypt',
  IL: 'Israel', SA: 'Saudi Arabia', TR: 'Türkiye', RU: 'Russian Federation',
  UA: 'Ukraine', ID: 'Indonesia', MY: 'Malaysia', TH: 'Thailand',
  PH: 'Philippines', VN: 'Viet Nam', PK: 'Pakistan', BD: 'Bangladesh',
  LK: 'Sri Lanka', CO: 'Colombia', PE: 'Peru', TZ: 'Tanzania', GH: 'Ghana',
}

export interface GleifRejection {
  readonly lei: string | null
  readonly reason: string
}

export interface GleifDiscoveryResult {
  readonly profiles: readonly VerifiedCompanyProfile[]
  readonly rejected: readonly GleifRejection[]
  /**
   * Phase 15C: raw record count in the response (`data` length; 0 when the
   * registry matched nothing or the shape is unusable). Lets callers tell a
   * valid zero-hit search apart from records lost to verification filters.
   */
  readonly totalRecords: number
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** Extracts the legal name from a GLEIF entity, or null when absent. */
function gleifLegalName(entity: Record<string, unknown>): string | null {
  const legalName = entity['legalName']
  if (legalName === null || typeof legalName !== 'object') return null
  const name = (legalName as Record<string, unknown>)['name']
  return isNonEmptyString(name) ? name.trim() : null
}

/**
 * Extracts the registered legal-address country, translated from the ISO
 * 3166-1 alpha-2 code to the pipeline's canonical name where known. An unmapped
 * code is carried through unchanged; a missing/invalid code is `null` (missing),
 * never inferred from the name.
 */
function gleifCountry(entity: Record<string, unknown>): string | null {
  const address = entity['legalAddress']
  if (address === null || typeof address !== 'object') return null
  const country = (address as Record<string, unknown>)['country']
  if (!isNonEmptyString(country)) return null
  const code = country.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return null
  return GLEIF_ISO_ALPHA2_COUNTRY[code] ?? code
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * The verified read-only URL for one LEI record. Dereferenceable and official;
 * used as the provenance `source` so every discovered fact is traceable.
 */
export function gleifRecordUrl(lei: string): string {
  return `https://${GLEIF_API_HOST}/api/v1/lei-records/${lei}`
}

/**
 * Maps ONE GLEIF JSON:API record to a verified company profile, or returns a
 * rejection reason. Never invents an attribute the source did not publish.
 */
export function gleifRecordToProfile(
  value: unknown,
  verifiedAt: string,
): { profile: VerifiedCompanyProfile } | { rejection: GleifRejection } {
  const record = asRecord(value)
  if (record === null) return { rejection: { lei: null, reason: 'record is not an object' } }
  const attributes = asRecord(record['attributes'])
  if (attributes === null) return { rejection: { lei: null, reason: 'record has no attributes' } }

  const rawLei = isNonEmptyString(attributes['lei']) ? attributes['lei'].trim() : record['id']
  const lei = isNonEmptyString(rawLei) ? rawLei.trim().toUpperCase() : null
  if (lei === null || !LEI_PATTERN.test(lei)) {
    return { rejection: { lei, reason: 'missing or malformed LEI' } }
  }
  const entity = asRecord(attributes['entity'])
  if (entity === null) return { rejection: { lei, reason: 'record has no entity block' } }

  const status = isNonEmptyString(entity['status']) ? entity['status'].trim().toUpperCase() : ''
  if (status !== 'ACTIVE') {
    return { rejection: { lei, reason: `entity status is ${status === '' ? 'missing' : status}, not ACTIVE` } }
  }
  const registration = asRecord(attributes['registration'])
  const registrationStatus = registration !== null && isNonEmptyString(registration['status'])
    ? registration['status'].trim().toUpperCase()
    : ''
  if (registrationStatus !== 'ISSUED') {
    return {
      rejection: { lei, reason: `registration status is ${registrationStatus === '' ? 'missing' : registrationStatus}, not ISSUED` },
    }
  }

  const name = gleifLegalName(entity)
  if (name === null) return { rejection: { lei, reason: 'record has no legal name' } }

  const profile: VerifiedCompanyProfile = {
    companyId: `LEI-${lei}`,
    name,
    country: gleifCountry(entity),
    // GLEIF's LEI reference data does not publish an industry classification;
    // these stay absent rather than being guessed from the legal name.
    provenance: {
      source: gleifRecordUrl(lei),
      verifiedAt,
      status: 'verified',
    },
  }
  return { profile }
}

/**
 * Maps a whole GLEIF search response (`{ data: [...] }`) to verified profiles,
 * separating accepted profiles from rejected records so nothing is silently
 * dropped. Non-array `data` yields an empty result, never a thrown error.
 */
export function mapGleifSearchResponse(value: unknown, verifiedAt: string): GleifDiscoveryResult {
  const root = asRecord(value)
  const data = root === null ? null : root['data']
  if (!Array.isArray(data)) return { profiles: [], rejected: [], totalRecords: 0 }

  const profiles: VerifiedCompanyProfile[] = []
  const rejected: GleifRejection[] = []
  for (const record of data) {
    const outcome = gleifRecordToProfile(record, verifiedAt)
    if ('profile' in outcome) profiles.push(outcome.profile)
    else rejected.push(outcome.rejection)
  }
  return { profiles, rejected, totalRecords: data.length }
}
