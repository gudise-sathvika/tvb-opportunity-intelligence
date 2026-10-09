/**
 * Source Registry (Architecture §7 / Phase B brief §2).
 *
 * A typed, declarative catalogue of source definitions. Determinism rules:
 *  - definitions are plain data only — no executable scraping/parsing logic;
 *  - the registry sorts and freezes entries, and validates every field;
 *  - duplicate source ids are rejected.
 *
 * The seed `DEFAULT_SOURCE_REGISTRY` contains GlobalTenders (registration only —
 * never queried), TED (the verified real EU procurement source, Phase U),
 * USAspending (the verified real US federal funding source, Phase V),
 * Grants.gov (the real US federal grant-opportunity source, Phase 19B — access
 * state UNKNOWN until verified), and the two local fixture sources used by the
 * fixture adapter. Access states follow Architecture §7 exactly.
 */

import type { AccessState, DiscoveryCapability, DiscoveryDomain, SourceApplicability } from './types'
import { ACCESS_STATES, DISCOVERY_CAPABILITIES, SOURCE_APPLICABILITY } from './types'

export interface SourceDefinition {
  sourceId: string
  name: string
  domain: string
  applicability: SourceApplicability
  discoveryCapability: DiscoveryCapability
  accessState: AccessState
  adapterType: string
  provenanceRequirements: readonly string[]
  notesRestrictions: readonly string[]
}

export interface SourceRegistry {
  readonly size: number
  readonly definitions: readonly SourceDefinition[]
  get(sourceId: string): SourceDefinition | undefined
  has(sourceId: string): boolean
  list(): SourceDefinition[]
}

export function sourceAppliesTo(applicability: SourceApplicability, domain: DiscoveryDomain): boolean {
  return applicability === 'both' || applicability === domain
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function assertValidSourceDefinition(definition: SourceDefinition): void {
  const fields: Array<[keyof SourceDefinition, unknown]> = [
    ['sourceId', definition.sourceId],
    ['name', definition.name],
    ['domain', definition.domain],
    ['adapterType', definition.adapterType],
  ]
  const missing = fields.filter(([, value]) => !isNonEmptyString(value)).map(([key]) => key)
  if (missing.length > 0) {
    throw new Error(`invalid source definition: missing ${missing.join(', ')}`)
  }
  if (!(SOURCE_APPLICABILITY as readonly string[]).includes(definition.applicability)) {
    throw new Error(`invalid source definition: applicability ${String(definition.applicability)}`)
  }
  if (!(DISCOVERY_CAPABILITIES as readonly string[]).includes(definition.discoveryCapability)) {
    throw new Error(`invalid source definition: discoveryCapability ${String(definition.discoveryCapability)}`)
  }
  if (!(ACCESS_STATES as readonly string[]).includes(definition.accessState)) {
    throw new Error(`invalid source definition: accessState ${String(definition.accessState)}`)
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
  const object = value as Record<string, unknown>
  for (const key of Object.keys(object)) {
    const child = object[key]
    if (child !== null && typeof child === 'object') deepFreeze(child)
  }
  return Object.freeze(object) as T
}

export function createSourceRegistry(definitions: readonly SourceDefinition[]): SourceRegistry {
  const sorted = [...definitions].sort((a, b) => a.sourceId.localeCompare(b.sourceId))
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i - 1].sourceId === sorted[i].sourceId) {
      throw new Error(`duplicate sourceId in registry: ${sorted[i].sourceId}`)
    }
  }
  for (const definition of sorted) assertValidSourceDefinition(definition)

  const frozen = sorted.map((definition) => deepFreeze(definition))
  const byId = new Map<string, SourceDefinition>(frozen.map((definition) => [definition.sourceId, definition]))

  return Object.freeze({
    size: frozen.length,
    definitions: Object.freeze([...frozen]),
    get: (sourceId: string) => byId.get(sourceId),
    has: (sourceId: string) => byId.has(sourceId),
    list: () => [...frozen],
  })
}

/* ------------------------------------------------------------------ */
/* Seed register                                                        */
/* ------------------------------------------------------------------ */

export const GLOBALTENDERS_SOURCE_ID = 'SU-GT-001'
export const FIXTURE_PROCUREMENT_SOURCE_ID = 'SU-FX-001'
export const FIXTURE_FUNDING_SOURCE_ID = 'SU-FX-002'
export const TED_SOURCE_ID = 'SU-TED-001'
export const USA_SPENDING_SOURCE_ID = 'SU-US-001'
export const GRANTS_GOV_SOURCE_ID = 'SU-GRANTS-001'
export const EU_SEDIA_SOURCE_ID = 'SU-EU-001'

export const FIXTURE_ADAPTER_TYPE = 'fixture'
export const GLOBALTENDERS_ADAPTER_TYPE = 'globaltenders'
export const TED_ADAPTER_TYPE = 'ted'
export const USA_SPENDING_ADAPTER_TYPE = 'usaspending'
export const GRANTS_GOV_ADAPTER_TYPE = 'grantsgov'
export const EU_SEDIA_ADAPTER_TYPE = 'eu-sedia'

/**
 * Deterministic, frozen, typed seed. GlobalTenders is registered as metadata
 * ONLY: its access state is UNKNOWN (never assumed AVAILABLE) and no live
 * adapter is bound to it, so discovery against it is always BLOCKED — it proves
 * "registered but NOT queried".
 */
export const DEFAULT_SOURCE_REGISTRY: SourceRegistry = createSourceRegistry([
  {
    sourceId: GLOBALTENDERS_SOURCE_ID,
    name: 'GlobalTenders',
    domain: 'globaltenders.com',
    applicability: 'procurement',
    discoveryCapability: 'listing_search',
    accessState: 'UNKNOWN',
    adapterType: GLOBALTENDERS_ADAPTER_TYPE,
    provenanceRequirements: ['listing_url', 'detail_url', 'raw_payload', 'observed_at'],
    notesRestrictions: [
      'Registration only. The live adapter is intentionally NOT implemented in Phase B, and the source must not be queried until access is observed and authorized (Phase A §19).',
    ],
  },
  {
    sourceId: FIXTURE_PROCUREMENT_SOURCE_ID,
    name: 'Fixture Procurement Portal (local, deterministic)',
    domain: 'fixture.invalid',
    applicability: 'procurement',
    discoveryCapability: 'listing_search',
    accessState: 'AVAILABLE',
    adapterType: FIXTURE_ADAPTER_TYPE,
    provenanceRequirements: ['listing_url', 'raw_payload', 'observed_at', 'query_terms'],
    notesRestrictions: ['Local fixture only. No network access, no internet, no external API.'],
  },
  {
    sourceId: FIXTURE_FUNDING_SOURCE_ID,
    name: 'Fixture Grants Portal (local, deterministic)',
    domain: 'fixture.invalid',
    applicability: 'funding',
    discoveryCapability: 'listing_search',
    accessState: 'AVAILABLE',
    adapterType: FIXTURE_ADAPTER_TYPE,
    provenanceRequirements: ['listing_url', 'raw_payload', 'observed_at', 'query_terms'],
    notesRestrictions: ['Local fixture only. No network access, no internet, no external API.'],
  },
  {
    sourceId: TED_SOURCE_ID,
    name: 'TED — Tenders Electronic Daily (EU Official Journal)',
    domain: 'ted.europa.eu',
    applicability: 'procurement',
    discoveryCapability: 'listing_search',
    accessState: 'AVAILABLE',
    adapterType: TED_ADAPTER_TYPE,
    provenanceRequirements: ['listing_url', 'detail_url', 'raw_payload', 'observed_at', 'query_terms'],
    notesRestrictions: [
      'Official EU public procurement publication (the supplement to the Official Journal of the EU). Retrieval uses the official open JSON search API — no login, no credentials, no access controls bypassed. ACCESS_STATE reflects a verified read-only search on 2026-10-08, not merely the existence of an adapter.',
      'One search request per discovery run; no bulk export, no document downloads, no rate-limit circumvention. Request failures are reported as failures, never converted into empty successes.',
      'Covers EU/EEA procurement notices; it is not a global or Indian domestic tender portal.',
    ],
  },
  {
    sourceId: USA_SPENDING_SOURCE_ID,
    name: 'USAspending — US Federal Grants & Awards (official, public)',
    domain: 'api.usaspending.gov',
    applicability: 'funding',
    discoveryCapability: 'listing_search',
    accessState: 'AVAILABLE',
    adapterType: USA_SPENDING_ADAPTER_TYPE,
    provenanceRequirements: ['listing_url', 'raw_payload', 'observed_at', 'query_terms'],
    notesRestrictions: [
      'Official public US federal spending search API (api.usaspending.gov, U.S. Department of the Treasury), POST JSON, no login and no API key. ACCESS_STATE reflects a verified read-only grant search (award_type_code 02) on 2026-10-09, not merely the existence of an adapter.',
      'Grant award records (obligated public assistance awards), not open-call solicitation notices: each candidate links to the source\u2019s canonical award profile page.',
      'One search request per discovery run; no bulk export, no document downloads, no rate-limit circumvention. Request failures are reported as failures, never converted into empty successes.',
    ],
  },
  {
    sourceId: GRANTS_GOV_SOURCE_ID,
    name: 'Grants.gov — US Federal Grant Opportunities (official, public)',
    domain: 'api.grants.gov',
    applicability: 'funding',
    discoveryCapability: 'listing_search',
    accessState: 'UNKNOWN',
    adapterType: GRANTS_GOV_ADAPTER_TYPE,
    provenanceRequirements: ['listing_url', 'detail_url', 'raw_payload', 'observed_at', 'query_terms'],
    notesRestrictions: [
      'Official public US federal grant search (Grants.gov, api.grants.gov), documentedly POST JSON with no login and no API key. Returns grant OPPORTUNITIES — posted/forecasted/closed/archived solicitations a company can apply to — NOT historical award records.',
      'ACCESS_STATE is UNKNOWN: the endpoint is documented as public, but no verified read-only search has been performed yet, so access is never assumed AVAILABLE. Promote to AVAILABLE only after an observed read-only query (a later phase wires the live store).',
      'Records preserve the source status and open/close dates, but no adapter computes an "is currently open" verdict and no eligibility for a TVB company is implied.',
    ],
  },
  {
    sourceId: EU_SEDIA_SOURCE_ID,
    name: 'EU Funding & Tenders Portal — Horizon grant topics & cascade funding (official, public)',
    domain: 'api.tech.ec.europa.eu',
    applicability: 'funding',
    discoveryCapability: 'listing_search',
    accessState: 'UNKNOWN',
    adapterType: EU_SEDIA_ADAPTER_TYPE,
    provenanceRequirements: ['listing_url', 'detail_url', 'raw_payload', 'observed_at', 'query_terms'],
    notesRestrictions: [
      'Official EU Funding & Tenders Portal search API (api.tech.ec.europa.eu, search-api SEDIA collection), public with the shared read-only apiKey=SEDIA. This phase returns GRANT TOPICS, EXTERNAL-ACTION GRANTS, and CASCADE FUNDING CALLS only; EU TENDERS (type 0) are deliberately NOT requested because the tender classification contract is not fully verified (Phase 21B).',
      'ACCESS_STATE is UNKNOWN: the endpoint is documented as public, but no in-app verified read-only search has been performed yet, so access is never assumed AVAILABLE. The live surface builds a RUN-SCOPED view (like Grants.gov) that treats ONLY SU-EU-001 as AVAILABLE for that run.',
      'Records classify by DATASOURCE + type (never type alone); FAQ documents (DATASOURCE SEDIA_FAQ) are excluded and remaining records are deduplicated by their stable reference. The source status code is carried as evidence; a record is marked currently-open only when the status is "open for submission", the deadline is present and in the future, and the official link and provenance are present.',
    ],
  },
])