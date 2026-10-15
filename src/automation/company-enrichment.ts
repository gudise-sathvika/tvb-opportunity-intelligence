/**
 * Phase 08 additive company enrichment — pure, side-effect-free.
 *
 * GLEIF verifies legal existence (LEI, name, country) and nothing else. This
 * module adds independently-evidenced business attributes from authoritative
 * public sources WITHOUT touching GLEIF discovery or either match engine:
 *
 *  - v1 source: the U.S. SEC EDGAR public company files
 *    (`company_tickers.json` + per-CIK `submissions/CIK*.json`), which publish
 *    the filer's SIC industry classification + description, business address,
 *    and website. No key, documented public access, rate-respecting use.
 *  - every enriched attribute carries its evidence URL, source name and
 *    retrieval timestamp; the verified legal identity (LEI profile +
 *    provenance) is never rewritten;
 *  - `applyEnrichment` fills ONLY absent profile fields and never overwrites
 *    a present verified attribute;
 *  - anything unavailable stays unknown with a reason — a GLEIF record never
 *    implies an industry, and a name alone never implies capabilities.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import type { VerifiedCompanyProfile } from './company-profile'
import { deepFreeze } from './candidate'

export const ENRICHMENT_RULE_VERSION = 'enrich-1' as const
export const SEC_EDGAR_SOURCE_NAME = 'U.S. SEC EDGAR (official public filings)' as const

/** One evidenced attribute: value plus where/when it was observed. */
export interface EnrichmentEvidence {
  readonly attribute: string
  readonly value: string
  readonly sourceName: string
  readonly sourceUrl: string
  readonly retrievedAt: string
}

export type EnrichmentStatus = 'enriched' | 'partial' | 'none' | 'failed'

/** Enrichment outcome for one company. Unknown fields stay null with a note. */
export interface CompanyEnrichment {
  readonly status: EnrichmentStatus
  readonly industry: readonly string[] | null
  readonly website: string | null
  readonly locations: readonly string[] | null
  readonly organizationType: string | null
  readonly capabilities: readonly string[] | null
  readonly evidence: readonly EnrichmentEvidence[]
  readonly checkedAt: string
  readonly notes: readonly string[]
}

export interface SecTickerCandidate {
  readonly cik: string
  readonly ticker: string
  readonly title: string
}

/** Corporate suffixes stripped before name comparison (never shown, never stored). */
const NAME_SUFFIXES = new Set([
  'co', 'company', 'corp', 'corporation', 'inc', 'incorporated', 'llc', 'ltd', 'limited',
  'plc', 'corp.', 'inc.', 'co.', 'l.l.c.', 'sa', 'ag', 'gmbh', 'bv', 'nv', 'pty', 'ab',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Normalizes a legal name to significant tokens: uppercase, punctuation cut,
 * suffixes dropped. `GENERAL ELECTRIC COMPANY` and `GENERAL ELECTRIC CO` both
 * fold to {GENERAL, ELECTRIC}.
 */
export function significantNameTokens(name: string): readonly string[] {
  const tokens = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !NAME_SUFFIXES.has(token.toLowerCase()))
  return [...new Set(tokens)]
}

/**
 * Conservative EDGAR ticker-file match. Returns a candidate ONLY when both
 * sides' significant token sets are exactly equal with at least two tokens
 * (e.g. GLEIF "GENERAL ELECTRIC COMPANY" vs filer "GENERAL ELECTRIC CO").
 * In particular a longer name such as "GENERAL ELECTRIC CANADA" never matches
 * the US filer — attributing one legal entity's filings to another would be
 * fabrication. Anything weaker is `null` (unknown), never a guess. The first
 * file-order hit wins.
 */
export function findSecTickerCandidate(tickersJson: unknown, legalName: string): SecTickerCandidate | null {
  const want = significantNameTokens(legalName)
  if (want.length === 0 || !isRecord(tickersJson)) return null
  const wantSet = new Set(want)
  const entries = Object.values(tickersJson)
  let best: SecTickerCandidate | null = null
  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const title = isNonEmptyString(entry['title']) ? (entry['title'] as string) : null
    const ticker = isNonEmptyString(entry['ticker']) ? (entry['ticker'] as string) : null
    const cikRaw = entry['cik_str']
    if (title === null || ticker === null || typeof cikRaw !== 'number') continue
    const have = new Set(significantNameTokens(title))
    if (have.size === 0) continue
    if (wantSet.size < 2 || have.size !== wantSet.size) continue
    let equal = true
    for (const token of wantSet) {
      if (!have.has(token)) {
        equal = false
        break
      }
    }
    if (!equal) continue
    const cik = `CIK${String(Math.floor(cikRaw)).padStart(10, '0')}`
    const candidate = { cik, ticker, title }
    if (best === null) best = candidate
    else return best
  }
  return best
}

function firstString(value: unknown): string | null {
  return isNonEmptyString(value) ? (value as string).trim() : null
}

function evidenceFor(attribute: string, value: string, sourceUrl: string, retrievedAt: string): EnrichmentEvidence {
  return { attribute, value, sourceName: SEC_EDGAR_SOURCE_NAME, sourceUrl, retrievedAt }
}

/**
 * Maps one SEC submissions document to enrichment. Reads defensively: every
 * absent/blank field stays null with a note. Never derives capabilities,
 * products, or eligibility from an SIC code — a classification is not a
 * capability statement.
 */
export function mapSecSubmissions(submissions: unknown, cik: string, retrievedAt: string): CompanyEnrichment {
  const notes: string[] = []
  const evidence: EnrichmentEvidence[] = []
  const sourceUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K`
  if (!isRecord(submissions)) {
    return {
      status: 'failed', industry: null, website: null, locations: null,
      organizationType: null, capabilities: null, evidence: [], checkedAt: retrievedAt,
      notes: ['SEC submissions document is not an object'],
    }
  }

  let industry: readonly string[] | null = null
  const sic = firstString(submissions['sic'])
  const sicDescription = firstString(submissions['sicDescription'])
  if (sicDescription !== null) {
    industry = sic !== null ? [`${sicDescription} (SIC ${sic})`] : [sicDescription]
    evidence.push(evidenceFor('industry', industry[0], sourceUrl, retrievedAt))
  } else {
    notes.push('SEC record publishes no SIC industry classification')
  }

  let website: string | null = null
  const rawWebsite = firstString(submissions['website'])
  if (rawWebsite !== null) {
    website = rawWebsite
    evidence.push(evidenceFor('website', website, sourceUrl, retrievedAt))
  } else {
    notes.push('SEC record publishes no website')
  }

  let locations: readonly string[] | null = null
  const addresses = isRecord(submissions['addresses']) ? (submissions['addresses'] as Record<string, unknown>) : null
  const business = addresses !== null && isRecord(addresses['business']) ? (addresses['business'] as Record<string, unknown>) : null
  if (business !== null) {
    const parts = [firstString(business['city']), firstString(business['stateOrCountryDescription']) ?? firstString(business['stateOrCountry'])].filter(
      (part): part is string => part !== null,
    )
    if (parts.length > 0) {
      locations = [parts.join(', ')]
      evidence.push(evidenceFor('locations', locations[0], sourceUrl, retrievedAt))
    } else {
      notes.push('SEC record publishes no usable business address')
    }
  } else {
    notes.push('SEC record publishes no business address block')
  }

  notes.push('SEC filings publish no product, service, or capability statements; capabilities stay unknown')
  const status: EnrichmentStatus =
    industry !== null && (website !== null || locations !== null)
      ? 'enriched'
      : industry !== null || website !== null || locations !== null
        ? 'partial'
        : 'none'
  return { status, industry, website, locations, organizationType: null, capabilities: null, evidence, checkedAt: retrievedAt, notes }
}

/**
 * Applies enrichment to a verified profile, filling ONLY absent fields. The
 * LEI identity, name, country, and GLEIF provenance are never rewritten;
 * present attributes are never overwritten. Returns the new profile alongside
 * the enrichment record (kept separate so reviewers can tell verified legal
 * facts from independently evidenced business facts).
 */
export function applyEnrichment(
  profile: VerifiedCompanyProfile,
  enrichment: CompanyEnrichment,
): { profile: VerifiedCompanyProfile; enrichment: CompanyEnrichment } {
  const next: VerifiedCompanyProfile = deepFreeze({
    ...profile,
    industry: profile.industry ?? enrichment.industry,
    businessDescription: profile.businessDescription ?? null,
    technologyFocus: profile.technologyFocus ?? null,
    projectFocus: profile.projectFocus ?? null,
    certifications: profile.certifications ?? null,
  })
  return { profile: next, enrichment }
}
