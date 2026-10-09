/**
 * Candidate normalization (Phase C brief §7) — NORM-RULES-v1.
 *
 * Rules are deliberately narrow and conservative:
 *  - title: trim + collapse interior whitespace, punctuation preserved;
 *  - URL: canonical absolute form via the URL parser — lowercase host, default
 *    ports stripped, fragment and utm_* tracking parameters removed;
 *  - dates: converted to YYYY-MM-DD when a documented shape matches
 *    (ISO, DD/MM/YYYY, YYYYMMDD), otherwise preserved verbatim with a warning;
 *  - free text (summary, organization): whitespace only;
 *  - country: a deterministic, exact alias map (e.g. USA → United States);
 *  - raw type: preserved exactly — classification, not normalization, maps it.
 *
 * A normalization result is UNCHANGED / NORMALIZED / WARNING / FAILED. A
 * candidate whose title normalizes to empty cannot be represented and is
 * BLOCKED. Every normalized field keeps its original value in the metadata so
 * "what changed" is always auditable.
 */

import type { DiscoveryCandidate, NormalizationMetadata } from './candidate'
import { deepFreeze } from './candidate'

export const NORMALIZATION_RULE_VERSION = 'NORM-RULES-v1'

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/* ------------------------------------------------------------------ */
/* URL canonicalization                                                */
/* ------------------------------------------------------------------ */

export interface CanonicalUrlOutcome {
  readonly normalized: string
  readonly canonical: string | null
  readonly warning: string | null
}

/**
 * Canonicalizes an absolute URL. Returns the normalized form used on the
 * candidate and a canonical key used by deduplication tier 2. Never throws:
 * an unparseable URL is preserved on the candidate with a warning.
 */
export function canonicalizeUrl(input: string): CanonicalUrlOutcome {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { normalized: trimmed, canonical: null, warning: 'url is empty' }
  }
  try {
    const parsed = new URL(trimmed)
    const defaultPort =
      (parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')
    parsed.hostname = parsed.hostname.toLowerCase()
    if (defaultPort) parsed.port = ''
    parsed.hash = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) parsed.searchParams.delete(key)
    }
    const normalized = parsed.toString()
    return { normalized, canonical: normalized, warning: null }
  } catch {
    return { normalized: trimmed, canonical: null, warning: 'url is not a valid absolute URL' }
  }
}

/* ------------------------------------------------------------------ */
/* Date normalization                                                  */
/* ------------------------------------------------------------------ */

export interface DateOutcome {
  readonly normalized: string
  readonly warning: string | null
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DMY_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})$/

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  return year >= 1000 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= 31
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Converts a source date string to YYYY-MM-DD when it matches a documented
 * shape. Anything else is preserved verbatim with a warning — we never
 * re-interpret a date we cannot parse for certain.
 */
export function normalizeDateToIso(value: string): DateOutcome {
  const trimmed = value.trim()

  const iso = ISO_DATE.exec(trimmed)
  if (iso !== null) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    if (isValidCalendarDate(year, month, day)) return { normalized: trimmed, warning: null }
    return { normalized: trimmed, warning: 'date is not a valid calendar date' }
  }

  const dmy = DMY_DATE.exec(trimmed)
  if (dmy !== null) {
    const [day, month, year] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])]
    if (isValidCalendarDate(year, month, day)) {
      return { normalized: `${year}-${pad2(month)}-${pad2(day)}`, warning: null }
    }
  }

  const compact = COMPACT_DATE.exec(trimmed)
  if (compact !== null) {
    const [year, month, day] = [Number(compact[1]), Number(compact[2]), Number(compact[3])]
    if (isValidCalendarDate(year, month, day)) {
      return { normalized: `${year}-${pad2(month)}-${pad2(day)}`, warning: null }
    }
  }

  return { normalized: trimmed, warning: 'date could not be parsed to YYYY-MM-DD' }
}

/* ------------------------------------------------------------------ */
/* Country normalization                                               */
/* ------------------------------------------------------------------ */

/**
 * Deterministic exact alias map. Matching is case-insensitive on the trimmed
 * value. Unknown values are preserved unchanged (a country is not a
 * controlled vocabulary in this phase).
 */
const COUNTRY_CANONICAL: Record<string, string> = {
  'usa': 'United States',
  'us': 'United States',
  'u.s.': 'United States',
  'u.s.a.': 'United States',
  'united states': 'United States',
  'uk': 'United Kingdom',
  'u.k.': 'United Kingdom',
  'gb': 'United Kingdom',
  'great britain': 'United Kingdom',
  'united kingdom': 'United Kingdom',
  'england': 'United Kingdom',
  'scotland': 'United Kingdom',
  'wales': 'United Kingdom',
  'northern ireland': 'United Kingdom',
  'uae': 'United Arab Emirates',
  'u.a.e.': 'United Arab Emirates',
  // ISO 3166-1 alpha-3 codes as reported by TED (Tenders Electronic Daily).
  // Only source-observed codes are mapped; anything else still passes through
  // unchanged, and the controlled-vocabulary check happens at write time.
  'pol': 'Poland',
  'rou': 'Romania',
  'lva': 'Latvia',
  'fra': 'France',
  'prt': 'Portugal',
}

export function normalizeCountry(value: string): string {
  const trimmed = collapseWhitespace(value)
  const mapped = COUNTRY_CANONICAL[trimmed.toLowerCase()]
  return mapped ?? trimmed
}

function changed(original: string | null, normalized: string | null): boolean {
  return original !== normalized
}

function normalizeOptionalDate(value: string | null): DateOutcome | null {
  return value === null ? null : normalizeDateToIso(value)
}

/**
 * Normalizes one NEW candidate and attaches its normalization metadata.
 * Idempotent: a candidate that already has normalization metadata is returned
 * unchanged. Blocked candidates are untouched.
 */
export function normalizeCandidate(candidate: DiscoveryCandidate): DiscoveryCandidate {
  if (candidate.normalization !== null) return candidate
  if (candidate.candidateStatus === 'BLOCKED') return candidate

  const titleOriginal = candidate.sourceTitle
  const title = collapseWhitespace(titleOriginal)

  const urlOutcome = canonicalizeUrl(candidate.sourceUrl)
  const summary = candidate.sourceSummary === null ? null : collapseWhitespace(candidate.sourceSummary)
  const publication = normalizeOptionalDate(candidate.sourcePublicationDate)
  const deadline = normalizeOptionalDate(candidate.sourceDeadline)
  const organization = candidate.sourceOrganization === null ? null : collapseWhitespace(candidate.sourceOrganization)
  const country = candidate.sourceCountry === null ? null : normalizeCountry(candidate.sourceCountry)
  const rawType = candidate.sourceRawType
  const sourceStatus = candidate.sourceStatus

  const fields: Array<[keyof NormalizationMetadata, string | null, string | null]> = [
    ['title', titleOriginal, title],
    ['sourceUrl', candidate.sourceUrl, urlOutcome.normalized],
    ['summary', candidate.sourceSummary, summary],
    ['publicationDate', candidate.sourcePublicationDate, publication?.normalized ?? null],
    ['deadline', candidate.sourceDeadline, deadline?.normalized ?? null],
    ['organization', candidate.sourceOrganization, organization],
    ['country', candidate.sourceCountry, country],
    ['rawType', candidate.sourceRawType, rawType],
    ['sourceStatus', candidate.sourceStatus, sourceStatus],
  ]

  const changedFields: string[] = []
  for (const [field, original, normalized] of fields) {
    if (changed(original, normalized)) changedFields.push(field)
  }

  const warnings: string[] = []
  for (const outcome of [urlOutcome, publication, deadline]) {
    if (outcome !== null && outcome.warning !== null) warnings.push(outcome.warning)
  }

  let status: NormalizationMetadata['status']
  if (title.length === 0) {
    status = 'FAILED'
  } else if (warnings.length > 0) {
    status = 'WARNING'
  } else if (changedFields.length > 0) {
    status = 'NORMALIZED'
  } else {
    status = 'UNCHANGED'
  }

  const metadata: NormalizationMetadata = {
    ruleVersion: NORMALIZATION_RULE_VERSION,
    status,
    changedFields: deepFreeze(changedFields),
    warnings: deepFreeze(warnings),
    title: { original: titleOriginal, normalized: title },
    sourceUrl: { original: candidate.sourceUrl, normalized: urlOutcome.normalized },
    canonicalUrl: urlOutcome.canonical,
    summary: { original: candidate.sourceSummary, normalized: summary },
    publicationDate: { original: candidate.sourcePublicationDate, normalized: publication?.normalized ?? null },
    deadline: { original: candidate.sourceDeadline, normalized: deadline?.normalized ?? null },
    organization: { original: candidate.sourceOrganization, normalized: organization },
    country: { original: candidate.sourceCountry, normalized: country },
    rawType: { original: candidate.sourceRawType, normalized: rawType },
    sourceStatus: { original: candidate.sourceStatus, normalized: sourceStatus },
  }

  return deepFreeze({
    ...candidate,
    sourceTitle: title,
    sourceUrl: urlOutcome.normalized,
    sourceSummary: summary,
    sourcePublicationDate: publication?.normalized ?? null,
    sourceDeadline: deadline?.normalized ?? null,
    sourceOrganization: organization,
    sourceCountry: country,
    candidateStatus: status === 'FAILED' ? 'BLOCKED' : 'NORMALIZED',
    normalization: metadata,
    provenance: {
      ...candidate.provenance,
      stageHistory: deepFreeze([...candidate.provenance.stageHistory, 'normalize']),
    },
  })
}