/**
 * Phase 09 additive opportunity enrichment — pure, side-effect-free.
 *
 * Phase 08 enriched companies but proposals could not move: opportunity
 * records carried only title/deadline/status/URL. This module extracts
 * source-supported requirement evidence the adapters already preserve in
 * `RawResult.rawPayload` but never surfaced:
 *
 *  - Grants.gov: CFDA assistance-listing codes (`cfdaList`), document kind.
 *    The `search2` response publishes NO applicant types — recorded as an
 *    explicit gap, never inferred.
 *  - EU SEDIA: programme/call titles, keywords, action types, budget
 *    overview, deadline model (from record `metadata`).
 *  - TED: CPV classification codes + contract nature (already requested via
 *    OUTPUT_FIELDS, previously dropped after parsing).
 *  - UK FTS: procurement method + details, category, estimated value, tender
 *    documents (title + URL), amendments, award/contract records.
 *
 * Every attribute carries its evidence URL, source name and retrieval
 * timestamp; anything a source does not publish stays unknown with a reason.
 * This module never classifies, never gates, and never feeds the match
 * engines — it is review evidence for humans. Adapters are untouched; the
 * single call site is `candidateFromRawResult` (transform).
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import type { RawResult } from './types'
import { EU_SEDIA_SOURCE_ID, FTS_SOURCE_ID, GRANTS_GOV_SOURCE_ID, TED_SOURCE_ID } from './registry'

export const OPPORTUNITY_ENRICHMENT_VERSION = 'opp-enrich-1' as const

/** One evidenced requirement fact: value plus where/when it was observed. */
export interface OpportunityEvidenceItem {
  readonly attribute: string
  readonly value: string
  readonly sourceName: string
  readonly sourceUrl: string
  readonly retrievedAt: string
}

/** Official document linked from a notice (title + URL, both source-supplied). */
export interface OpportunityDocument {
  readonly label: string
  readonly url: string
}

/**
 * Phase 26: a verbatim excerpt from already-retrieved official HTML, with its
 * section reference. Excerpts are pointers for human verification, never
 * eligibility decisions.
 */
export interface OpportunityDocumentFinding {
  readonly excerpt: string
  readonly section: string | null
}

/**
 * Additive requirement evidence for one opportunity. Every list is null when
 * the source publishes nothing for it; `notes` explains each gap.
 */
export interface OpportunityEnrichment {
  readonly version: typeof OPPORTUNITY_ENRICHMENT_VERSION
  readonly programmes: readonly string[] | null
  readonly sectors: readonly string[] | null
  readonly categories: readonly string[] | null
  readonly applicantTypes: readonly string[] | null
  readonly budget: string | null
  readonly value: string | null
  readonly documents: readonly OpportunityDocument[]
  readonly documentFindings: readonly OpportunityDocumentFinding[]
  readonly lifecycleNotes: readonly string[]
  readonly evidence: readonly OpportunityEvidenceItem[]
  readonly checkedAt: string
  readonly notes: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function stringList(value: unknown): string[] {
  const pick = (item: unknown): string | null => (isNonEmptyString(item) ? (item as string).trim() : null)
  if (Array.isArray(value)) {
    const out: string[] = []
    for (const item of value) {
      if (Array.isArray(item)) {
        for (const sub of item) {
          const found = pick(sub)
          if (found !== null && !out.includes(found)) out.push(found)
        }
      } else {
        const found = pick(item)
        if (found !== null && !out.includes(found)) out.push(found)
      }
    }
    return out
  }
  const single = pick(value)
  return single === null ? [] : [single]
}

interface Builder {
  programmes: string[]
  sectors: string[]
  categories: string[]
  applicantTypes: string[]
  budget: string | null
  value: string | null
  documents: OpportunityDocument[]
  documentFindings: OpportunityDocumentFinding[]
  lifecycleNotes: string[]
  evidence: OpportunityEvidenceItem[]
  notes: string[]
}

function emptyBuilder(): Builder {
  return { programmes: [], sectors: [], categories: [], applicantTypes: [], budget: null, value: null, documents: [], documentFindings: [], lifecycleNotes: [], evidence: [], notes: [] }
}

function finish(_sourceId: string, _sourceUrl: string, checkedAt: string, builder: Builder): OpportunityEnrichment {
  return {
    version: OPPORTUNITY_ENRICHMENT_VERSION,
    programmes: builder.programmes.length > 0 ? [...builder.programmes] : null,
    sectors: builder.sectors.length > 0 ? [...builder.sectors] : null,
    categories: builder.categories.length > 0 ? [...builder.categories] : null,
    applicantTypes: builder.applicantTypes.length > 0 ? [...builder.applicantTypes] : null,
    budget: builder.budget,
    value: builder.value,
    documents: [...builder.documents],
    documentFindings: [...builder.documentFindings],
    lifecycleNotes: [...builder.lifecycleNotes],
    evidence: [...builder.evidence],
    checkedAt,
    notes: [...builder.notes],
  }
}

function ev(builder: Builder, attribute: string, value: string, sourceName: string, sourceUrl: string, retrievedAt: string): void {
  builder.evidence.push({ attribute, value, sourceName, sourceUrl, retrievedAt })
}

function enrichGrantsGov(payload: unknown, sourceUrl: string, retrievedAt: string, builder: Builder): void {
  const sourceName = 'Grants.gov search2 (official)'
  if (!isRecord(payload)) {
    builder.notes.push('Grants.gov record payload is not an object; no requirement evidence extracted')
    return
  }
  const cfda = stringList(payload['cfdaList'])
  if (cfda.length > 0) {
    builder.programmes.push(...cfda.filter((code) => !builder.programmes.includes(code)))
    for (const code of cfda) ev(builder, 'programme', code, sourceName, sourceUrl, retrievedAt)
  } else {
    builder.notes.push('Grants.gov search2 publishes no assistance-listing codes for this record')
  }
  const docType = isNonEmptyString(payload['docType']) ? (payload['docType'] as string).trim() : null
  if (docType !== null) {
    builder.lifecycleNotes.push(`source document kind: ${docType}`)
    ev(builder, 'documentKind', docType, sourceName, sourceUrl, retrievedAt)
  }
  builder.notes.push('Grants.gov search2 publishes no applicant-type or eligibility fields; eligibility stays unknown')
}

function enrichEuSedia(payload: unknown, sourceUrl: string, retrievedAt: string, builder: Builder): void {
  const sourceName = 'EU Funding & Tenders Portal search API (official)'
  if (!isRecord(payload)) {
    builder.notes.push('EU record metadata is not an object; no requirement evidence extracted')
    return
  }
  for (const key of ['frameworkProgramme', 'callTitle', 'programmeDivision'] as const) {
    for (const item of stringList(payload[key])) {
      if (!builder.programmes.includes(item)) {
        builder.programmes.push(item)
        ev(builder, 'programme', item, sourceName, sourceUrl, retrievedAt)
      }
    }
  }
  if (builder.programmes.length === 0) builder.notes.push('EU record publishes no programme/call identifiers')
  for (const key of ['keywords', 'typesOfAction', 'focusArea', 'crossCuttingPriorities'] as const) {
    for (const item of stringList(payload[key])) {
      if (!builder.sectors.includes(item)) {
        builder.sectors.push(item)
        ev(builder, 'sector', item, sourceName, sourceUrl, retrievedAt)
      }
    }
  }
  if (builder.sectors.length === 0) builder.notes.push('EU record publishes no keyword/sector descriptors')
  const budget = isNonEmptyString(payload['budgetOverview']) ? (payload['budgetOverview'] as string).trim() : null
  if (budget !== null) {
    builder.budget = budget
    ev(builder, 'budget', budget, sourceName, sourceUrl, retrievedAt)
  } else {
    builder.notes.push('EU record publishes no budget overview')
  }
  const deadlineModel = isNonEmptyString(payload['deadlineModel']) ? (payload['deadlineModel'] as string).trim() : null
  if (deadlineModel !== null) {
    builder.lifecycleNotes.push(`deadline model: ${deadlineModel}`)
    ev(builder, 'deadlineModel', deadlineModel, sourceName, sourceUrl, retrievedAt)
  }
  extractEuActionTypes(payload, sourceName, sourceUrl, retrievedAt, builder)
  extractEuCriterionLinks(payload, sourceName, sourceUrl, retrievedAt, builder)
  builder.notes.push('EU applicant-type rules live in call documents, not in the search index; eligibility stays unknown')
}

/**
 * Phase 14: action/MGA types from the record's `actions` JSON (e.g.
 * `HORIZON-CSA`, `HORIZON-AG-LS` lump-sum grant). Parsed defensively; the raw
 * string is never trusted blindly and unknown shapes are skipped silently.
 * These describe the funding instrument — review evidence, never an
 * eligibility verdict.
 */
function extractEuActionTypes(
  payload: Record<string, unknown>,
  sourceName: string,
  sourceUrl: string,
  retrievedAt: string,
  builder: Builder,
): void {
  const texts = stringList(payload['actions'])
  let found = 0
  for (const text of texts) {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    if (!isRecord(parsed) || !Array.isArray(parsed['types'])) continue
    for (const entry of parsed['types'] as unknown[]) {
      if (!isRecord(entry)) continue
      for (const label of stringList(entry['typeOfAction'])) {
        if (!builder.programmes.includes(label)) {
          builder.programmes.push(label)
          ev(builder, 'programme', label, sourceName, sourceUrl, retrievedAt)
          found += 1
        }
      }
      const mgaList = Array.isArray(entry['typeOfMGA']) ? (entry['typeOfMGA'] as unknown[]) : []
      for (const mga of mgaList) {
        if (!isRecord(mga)) continue
        const abbr = isNonEmptyString(mga['abbreviation']) ? (mga['abbreviation'] as string).trim() : null
        if (abbr !== null && !builder.programmes.includes(abbr)) {
          builder.programmes.push(abbr)
          ev(builder, 'programme', abbr, sourceName, sourceUrl, retrievedAt)
          found += 1
        }
      }
    }
  }
  if (found === 0) builder.notes.push('EU record publishes no parseable action/grant-type descriptors')
}

/**
 * Phase 14: official criterion and submission links from the record's `links`
 * JSON (criterion codes/descriptions plus portal submission URLs). Only
 * ec.europa.eu destinations are kept; anything else is ignored, never
 * rewritten. Full admissibility conditions (`topicConditions` HTML) are noted
 * as present-but-unparsed — reviewers follow the official topic page.
 */
function extractEuCriterionLinks(
  payload: Record<string, unknown>,
  sourceName: string,
  sourceUrl: string,
  retrievedAt: string,
  builder: Builder,
): void {
  const texts = stringList(payload['links'])
  let found = 0
  for (const text of texts) {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    const entries = Array.isArray(parsed) ? parsed : [parsed]
    for (const entry of entries) {
      if (!isRecord(entry)) continue
      for (const label of [...stringList(entry['criterionCode']), ...stringList(entry['criterionDescription'])]) {
        if (!builder.programmes.includes(label)) {
          builder.programmes.push(label)
          ev(builder, 'programme', label, sourceName, sourceUrl, retrievedAt)
          found += 1
        }
      }
      const url = isNonEmptyString(entry['url']) ? (entry['url'] as string).trim() : null
      if (url !== null && /^https:\/\/ec\.europa\.eu\//i.test(url) && !builder.documents.some((doc) => doc.url === url)) {
        const label = isNonEmptyString(entry['criterionCode']) ? `Official submission page (${(entry['criterionCode'] as string).trim()})` : 'Official submission page'
        builder.documents.push({ label, url })
        ev(builder, 'document', `${label} — ${url}`, sourceName, sourceUrl, retrievedAt)
        found += 1
      }
    }
  }
  extractEuEligibilitySections(payload, sourceName, sourceUrl, retrievedAt, builder)
  if (found === 0) builder.notes.push('EU record publishes no criterion or submission links')
}

/**
 * Phase 24: eligibility section headings from the record's `topicConditions`
 * HTML (e.g. "2. Eligible Countries", "4. Financial and operational capacity
 * and exclusion") plus official ec.europa.eu document hrefs found alongside
 * them. Headings are structural pointers for human verification — the criteria
 * themselves live on the official topic page and are never summarized,
 * paraphrased, or decided here. Unknown shapes yield notes, never guesses.
 */
function extractEuEligibilitySections(
  payload: Record<string, unknown>,
  sourceName: string,
  sourceUrl: string,
  retrievedAt: string,
  builder: Builder,
): void {
  const html = stringList(payload['topicConditions']).join('\n')
  if (html.trim() === '') {
    builder.notes.push('source record publishes no admissibility-conditions block')
    return
  }
  // Phase 26: the already-retrieved HTML is examined in place — no additional
  // request. Findings are verbatim excerpts for human verification.
  const examined = extractDocumentEvidence(html, 'text/html', sourceUrl, retrievedAt)
  for (const finding of examined.findings) {
    builder.documentFindings.push({ excerpt: finding.excerpt, section: finding.section })
  }
  if (examined.status !== 'explicitly_stated') {
    builder.notes.push(`admissibility-conditions block examined: ${examined.status}`)
  }
  const headings: string[] = []
  for (const match of html.matchAll(/<h4[^>]*>(.*?)<\/h4>/gs)) {
    const text = match[1].replace(/<[^>]+>/g, '').replace(/﻿/g, '').trim().replace(/\s+/g, ' ')
    if (text.length > 0 && !headings.includes(text)) headings.push(text)
  }
  for (const heading of headings.slice(0, 12)) {
    builder.lifecycleNotes.push(`eligibility covers: ${heading.slice(0, 160)}`)
    ev(builder, 'eligibilitySection', heading.slice(0, 160), sourceName, sourceUrl, retrievedAt)
  }
  if (headings.length > 12) builder.notes.push(`${headings.length - 12} further eligibility sections not listed`)
  const documents = new Set<string>()
  for (const match of html.matchAll(/href="(https:\/\/ec\.europa\.eu\/[^"]+)"/gi)) {
    documents.add(match[1])
    if (documents.size >= 5) break
  }
  for (const url of documents) {
    builder.documents.push({ label: 'Official call document (see topic page for context)', url })
    ev(builder, 'document', `Official call document — ${url}`, sourceName, sourceUrl, retrievedAt)
  }
  if (headings.length === 0) {
    builder.notes.push('admissibility-conditions block has no parseable section headings; see the official topic page')
  } else {
    builder.notes.push('full admissibility criteria live on the official topic page; headings above are pointers only')
  }
}

export type DocumentEvidenceStatus =
  | 'explicitly_stated'
  | 'not_found_in_examined_section'
  | 'document_unavailable'
  | 'unsupported_format'
  | 'not_examined';

/** One verbatim official excerpt with its section reference. */
export interface DocumentFinding {
  readonly attribute: string
  readonly excerpt: string
  readonly section: string | null
}

/** Traceable outcome of examining one official document. */
export interface DocumentEvidence {
  readonly sourceUrl: string
  readonly documentType: string
  readonly status: DocumentEvidenceStatus
  readonly findings: readonly DocumentFinding[]
  readonly retrievedAt: string
  readonly method: string
  readonly note: string | null
}

const ELIGIBILITY_HEADING = /eligib|admissib|applicant|countr|who can|participat/i;
const SCRIPT_STYLE = /<(script|style)[^>]*>.*?<\/\1>/gs;

/**
 * Phase 25: extracts verbatim eligibility evidence from official HTML only.
 * PDFs and unknown formats are reported (unsupported in this environment —
 * no PDF parser is installed) with links preserved, never guessed. Excerpts
 * are capped verbatim slices under matched headings; absence from an examined
 * section is `not_found_in_examined_section`, never proof the requirement
 * does not exist elsewhere. Nothing here decides eligibility.
 */
export function extractDocumentEvidence(
  content: string | null | undefined,
  contentType: string | null | undefined,
  sourceUrl: string,
  retrievedAt: string,
  maxExcerpt = 300,
): DocumentEvidence {
  const type = (contentType ?? '').trim().toLowerCase();
  if (content === null || content === undefined) {
    return {
      sourceUrl, documentType: type === '' ? 'unknown' : type, status: 'document_unavailable',
      findings: [], retrievedAt, method: 'none (no content retrieved)',
      note: 'document could not be retrieved; requirements stay unknown',
    };
  }
  const looksPdf = type.includes('pdf') || /\.pdf(\?|#|$)/i.test(sourceUrl);
  if (looksPdf) {
    return {
      sourceUrl, documentType: 'pdf', status: 'unsupported_format', findings: [], retrievedAt,
      method: 'none (no PDF parser in this environment)',
      note: 'PDF content was not examined; follow the official link for the authoritative text',
    };
  }
  const text = content.replace(SCRIPT_STYLE, ' ');
  const sections: Array<{ heading: string; body: string }> = [];
  const headingMatches = [...text.matchAll(/<h[1-4][^>]*>(.*?)<\/h[1-4]>/gs)];
  if (headingMatches.length === 0) {
    const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (stripped.length === 0) {
      return {
        sourceUrl, documentType: 'html', status: 'document_unavailable', findings: [], retrievedAt,
        method: 'html-heading-scan v1', note: 'document body carried no readable text',
      };
    }
    return {
      sourceUrl, documentType: 'html', status: 'not_found_in_examined_section', findings: [], retrievedAt,
      method: 'html-heading-scan v1', note: 'no eligibility section headings found in the examined HTML',
    };
  }
  for (const match of headingMatches) {
    const heading = (match[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (heading === '' || !ELIGIBILITY_HEADING.test(heading)) continue;
    const after = text.slice((match.index ?? 0) + match[0].length);
    const next = after.search(/<h[1-4][^>]*>/i);
    const body = after
      .slice(0, next === -1 ? 2000 : next)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxExcerpt);
    if (body.length > 0) sections.push({ heading: heading.slice(0, 160), body });
    if (sections.length >= 3) break;
  }
  if (sections.length === 0) {
    return {
      sourceUrl, documentType: 'html', status: 'not_found_in_examined_section', findings: [], retrievedAt,
      method: 'html-heading-scan v1', note: 'examined headings contain no eligibility sections',
    };
  }
  return {
    sourceUrl,
    documentType: 'html',
    status: 'explicitly_stated',
    findings: sections.map((section) => ({
      attribute: 'eligibility',
      excerpt: section.body,
      section: section.heading,
    })),
    retrievedAt,
    method: 'html-heading-scan v1 (verbatim excerpts under eligibility headings, capped)',
    note: 'excerpts cover the examined sections only; absence elsewhere proves nothing',
  };
}

function enrichTed(payload: unknown, sourceUrl: string, retrievedAt: string, builder: Builder): void {
  const sourceName = 'TED search API (official)'
  if (!isRecord(payload)) {
    builder.notes.push('TED notice payload is not an object; no requirement evidence extracted')
    return
  }
  const cpv = stringList(payload['classification-cpv'])
  const nature = stringList(payload['contract-nature'])
  for (const code of [...cpv, ...nature]) {
    if (!builder.categories.includes(code)) {
      builder.categories.push(code)
      ev(builder, 'category', code, sourceName, sourceUrl, retrievedAt)
    }
  }
  if (builder.categories.length === 0) builder.notes.push('TED record publishes no CPV codes or contract nature')
  builder.notes.push('TED qualification requirements live in notice documents, not in the search index')
}

function enrichFts(payload: unknown, sourceUrl: string, retrievedAt: string, builder: Builder): void {
  const sourceName = 'UK Find a Tender OCDS feed (official)'
  if (!isRecord(payload)) {
    builder.notes.push('FTS release payload is not an object; no requirement evidence extracted')
    return
  }
  const tender = isRecord(payload['tender']) ? (payload['tender'] as Record<string, unknown>) : null
  if (tender === null) {
    builder.notes.push('FTS release carries no tender object')
    return
  }
  for (const key of ['procurementMethod', 'procurementMethodDetails', 'mainProcurementCategory'] as const) {
    for (const item of stringList(tender[key])) {
      if (!builder.categories.includes(item)) {
        builder.categories.push(item)
        ev(builder, 'category', item, sourceName, sourceUrl, retrievedAt)
      }
    }
  }
  if (builder.categories.length === 0) builder.notes.push('FTS tender publishes no procurement method or category')
  // Phase 34 (procurement integrity): enquiry/award period ends are lifecycle
  // evidence, NEVER the submission deadline. Recording them here keeps the
  // deadline field honest (null when tenderPeriod.endDate is absent) while
  // showing reviewers the dates the source did publish.
  for (const [key, label] of [['enquiryPeriod', 'enquiries close'], ['awardPeriod', 'award activity ends']] as const) {
    const period = isRecord(tender[key]) ? (tender[key] as Record<string, unknown>) : null
    const end = period !== null && isNonEmptyString(period['endDate']) ? (period['endDate'] as string).trim() : null
    if (end !== null) {
      builder.lifecycleNotes.push(`${label}: ${end.slice(0, 10)} (not the submission deadline)`)
      ev(builder, 'lifecycleDate', `${label}: ${end}`, sourceName, sourceUrl, retrievedAt)
    }
  }
  const value = isRecord(tender['value']) ? (tender['value'] as Record<string, unknown>) : null
  if (value !== null) {
    const amount = value['amount'] ?? value['amountGross']
    const currency = firstCurrency(value['currency'])
    const text = `${typeof amount === 'number' || isNonEmptyString(amount) ? String(amount) : 'unspecified amount'}${currency !== null ? ` ${currency}` : ''}`.trim()
    builder.value = text
    ev(builder, 'value', text, sourceName, sourceUrl, retrievedAt)
  } else {
    builder.notes.push('FTS tender publishes no estimated value')
  }
  const documents = Array.isArray(tender['documents']) ? (tender['documents'] as unknown[]) : []
  for (const entry of documents.slice(0, 10)) {
    if (!isRecord(entry)) continue
    const url = isNonEmptyString(entry['url']) ? (entry['url'] as string).trim() : null
    const title = isNonEmptyString(entry['title']) ? (entry['title'] as string).trim() : (isNonEmptyString(entry['documentType']) ? (entry['documentType'] as string).trim() : 'tender document')
    if (url !== null) {
      builder.documents.push({ label: title, url })
      ev(builder, 'document', `${title} — ${url}`, sourceName, sourceUrl, retrievedAt)
    }
  }
  if (documents.length > 10) builder.notes.push(`${documents.length - 10} further tender documents not listed`)
  const amendments = Array.isArray(tender['amendments']) ? (tender['amendments'] as unknown[]) : []
  for (const entry of amendments) {
    if (!isRecord(entry)) continue
    const rationale = isNonEmptyString(entry['rationale']) ? (entry['rationale'] as string).trim() : 'amendment published without a stated rationale'
    builder.lifecycleNotes.push(`amendment: ${rationale.slice(0, 200)}`)
    ev(builder, 'amendment', rationale.slice(0, 200), sourceName, sourceUrl, retrievedAt)
  }
  const awards = Array.isArray(payload['awards']) ? (payload['awards'] as unknown[]) : []
  for (const entry of awards) {
    if (!isRecord(entry)) continue
    const status = isNonEmptyString(entry['status']) ? (entry['status'] as string).trim() : 'status unknown'
    builder.lifecycleNotes.push(`award record present (status: ${status}) — historical context, never an open call`)
    ev(builder, 'award', `status: ${status}`, sourceName, sourceUrl, retrievedAt)
  }
  const contracts = Array.isArray(payload['contracts']) ? (payload['contracts'] as unknown[]) : []
  if (contracts.length > 0) {
    builder.lifecycleNotes.push(`${contracts.length} contract record(s) present — historical context, never an open call`)
  }
}

function firstCurrency(value: unknown): string | null {
  return isNonEmptyString(value) ? (value as string).trim() : null
}

/**
 * Extracts additive requirement evidence from a raw result's preserved
 * payload. Unknown sources or unparseable payloads yield an empty enrichment
 * (all null, with notes) — never an error, never a guess.
 */
export function enrichOpportunityEvidence(raw: RawResult, retrievedAt: string): OpportunityEnrichment {
  const builder = emptyBuilder()
  const sourceUrl = raw.sourceUrl
  const sourceId = raw.rawProvenance.sourceId
  let payload: unknown = null
  try {
    payload = JSON.parse(raw.rawPayload)
  } catch {
    builder.notes.push('raw payload is not valid JSON; no requirement evidence extracted')
    return finish(sourceId, sourceUrl, retrievedAt, builder)
  }
  switch (sourceId) {
    case GRANTS_GOV_SOURCE_ID:
      enrichGrantsGov(payload, sourceUrl, retrievedAt, builder)
      break
    case EU_SEDIA_SOURCE_ID:
      enrichEuSedia(payload, sourceUrl, retrievedAt, builder)
      break
    case TED_SOURCE_ID:
      enrichTed(payload, sourceUrl, retrievedAt, builder)
      break
    case FTS_SOURCE_ID:
      enrichFts(payload, sourceUrl, retrievedAt, builder)
      break
    default:
      builder.notes.push(`no evidence extractor for source ${sourceId}`)
      break
  }
  return finish(sourceId, sourceUrl, retrievedAt, builder)
}
