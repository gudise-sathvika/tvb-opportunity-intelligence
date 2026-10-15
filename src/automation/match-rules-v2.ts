/**
 * Phase 13 MATCH-RULES-v2 — experimental shadow evaluator (funding + procurement).
 *
 * SHADOW MODE ONLY: v1 (`MATCH-RULES-v1` / `PMATCH-RULES-v1`) remains the
 * production/default evaluator. This module never replaces, wraps, or alters
 * v1 — it re-implements evaluation independently (shared types only, no shared
 * mutable logic) so the two versions can run side by side on identical inputs.
 *
 * What v2 changes (and only this):
 *  - V2-INDUSTRY: industry overlap is evaluated ONLY within one comparable
 *    vocabulary. A company SIC classification and an opportunity CPV code (or
 *    any two differently-marked schemes) are recorded as missing with an
 *    `industry-vocabulary-unverified` context flag — never matched, never
 *    mismatched across schemes. A SIC-vs-SIC or plain-vs-plain comparison
 *    behaves exactly like v1.
 *  - V2-CONTEXT: source-backed evidence that informs a human but decides
 *    nothing (programme codes, sector keywords, CPV presence, document
 *    availability) is recorded in `contextSignals`. Context never produces a
 *    match and never blocks one.
 *  - V2-DECIDE: PROPOSED requires at least one decisive matched signal AND
 *    zero decisive mismatched signals (v1 proposes even when a contradiction
 *    is present alongside a match). NOT_A_MATCH requires a decisive mismatch
 *    with no decisive match; otherwise INSUFFICIENT_EVIDENCE. Missing or
 *    unverified evidence is never a contradiction and never a match.
 *
 * Everything else — country/keyword/capability evaluation, validation,
 * determinism (frozen outputs, no I/O, no clock), proposal id stability —
 * mirrors v1 exactly. Statuses use the shared vocabulary; no new decision
 * type is introduced.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import type {
  MatchCompanyRecord,
  MatchEvidence,
  MatchProposalStatus,
  MatchSourceRecord,
} from './match-proposal'
import type {
  ProcurementCompanyRecord,
  ProcurementMatchEvidence,
  ProcurementMatchProposal,
  ProcurementMatchSignalId,
  ProcurementSourceRecord,
} from './procurement-proposal'
import { deepFreeze } from './candidate'

export const MATCH_RULES_V2_VERSION = 'MATCH-RULES-v2' as const
export const PMATCH_RULES_V2_VERSION = 'PMATCH-RULES-v2' as const

/** Additive, optional evidence context. Absent = same information v1 sees. */
export interface V2EvidenceContext {
  readonly opportunitySectors?: readonly string[] | null
  readonly opportunityCategories?: readonly string[] | null
  readonly opportunityProgrammes?: readonly string[] | null
  readonly opportunityDocumentsAvailable?: boolean
}

export interface V2MatchProposal {
  readonly proposalId: string
  readonly ruleVersion: typeof MATCH_RULES_V2_VERSION
  readonly sourceRecordId: string
  readonly sourceRecordType: 'opportunity' | 'notice'
  readonly companyId: string
  readonly matchedSignals: readonly string[]
  readonly missingSignals: readonly string[]
  readonly evidence: readonly MatchEvidence[]
  readonly status: MatchProposalStatus
  /** Informational only: evidence categories present that informed no verdict. */
  readonly contextSignals: readonly string[]
}

export interface V2ProcurementMatchProposal {
  readonly proposalId: string
  readonly ruleVersion: typeof PMATCH_RULES_V2_VERSION
  readonly recordType: 'notice'
  readonly noticeId: string
  readonly companyId: string
  readonly matchedSignals: readonly ProcurementMatchSignalId[]
  readonly missingSignals: readonly ProcurementMatchSignalId[]
  readonly evidence: readonly ProcurementMatchEvidence[]
  readonly status: ProcurementMatchProposal['status']
  /** Informational only: evidence categories present that informed no verdict. */
  readonly contextSignals: readonly string[]
}

const MIN_TOKEN_LENGTH = 2
const STOPWORDS: readonly string[] = Object.freeze([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'do', 'for', 'from',
  'have', 'in', 'is', 'it', 'its', 'no', 'not', 'of', 'on', 'or', 'so', 'that',
  'the', 'this', 'to', 'up', 'was', 'we', 'were', 'with', 'us', 'if', 'out',
  'about', 'into', 'over', 'such', 'other', 'more', 'than', 'also', 'which',
  'every', 'through', 'across', 'their', 'them', 'they', 'our', 'your',
  'services', 'service', 'systems', 'system', 'solutions', 'solution',
  'company', 'companies', 'private', 'limited', 'technologies', 'technology',
  'management', 'provides', 'provide', 'offers', 'including', 'record',
  'fictional', 'demonstration', 'profile', 'invented', 'illustrative',
  'fabricated', 'actual', 'client', 'example', 'figure', 'tvb', 'real',
])

function normalizeValue(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeList(values: readonly string[] | null | undefined): string[] {
  if (values === null || values === undefined) return []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalizeValue(value)
    if (normalized.length > 0) seen.add(normalized)
  }
  return [...seen].sort()
}

function tokenize(text: string | null | undefined): string[] {
  if (text === null || text === undefined) return []
  const tokens = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= MIN_TOKEN_LENGTH && !STOPWORDS.includes(raw)) tokens.add(raw)
  }
  return [...tokens].sort()
}

function intersectSorted(first: readonly string[], second: readonly string[]): string[] {
  const other = new Set(second)
  return first.filter((value) => other.has(value))
}

function unionSorted(first: readonly string[], second: readonly string[]): string[] {
  return [...new Set([...first, ...second])].sort()
}

/**
 * V2-INDUSTRY vocabulary guard. Returns the scheme marker when exactly one
 * recognizable classification scheme is present (`sic`, `cpv`), or null when
 * the values carry no scheme marker (plain comparable text) or a shared one.
 * Different schemes on the two sides must never be compared.
 */
function industryScheme(values: readonly string[]): 'sic' | 'cpv' | null {
  const text = values.join(' ').toLowerCase()
  const sic = /\bsic\b/.test(text)
  const cpv = /\bcpv\b/.test(text) || values.some((value) => /^\d{5,8}$/.test(value.trim()))
  if (sic && !cpv) return 'sic'
  if (cpv && !sic) return 'cpv'
  return null
}

interface IndustryEvaluation {
  readonly outcome: 'matched' | 'mismatched' | 'missing'
  readonly values: readonly string[]
  readonly note: string
  readonly vocabularyUnverified: boolean
}

function evaluateIndustryV2(sourceIndustries: readonly string[] | null | undefined, companyIndustries: readonly string[] | null | undefined, sourceNoun: string): IndustryEvaluation {
  const source = normalizeList(sourceIndustries)
  const company = normalizeList(companyIndustries)
  if (source.length === 0 || company.length === 0) {
    return { outcome: 'missing', values: [], note: 'industry unavailable on one side', vocabularyUnverified: false }
  }
  const sourceScheme = industryScheme(source)
  const companyScheme = industryScheme(company)
  if (sourceScheme !== null && companyScheme !== null && sourceScheme !== companyScheme) {
    return {
      outcome: 'missing',
      values: [],
      note: `industry classifications use different schemes (${sourceScheme} vs ${companyScheme}) and cannot be compared without a tested mapping`,
      vocabularyUnverified: true,
    }
  }
  const shared = intersectSorted(source, company)
  if (shared.length > 0) return { outcome: 'matched', values: shared, note: '', vocabularyUnverified: false }
  return {
    outcome: 'mismatched',
    values: unionSorted(source, company),
    note: `${sourceNoun} and company industries share nothing within a comparable vocabulary`,
    vocabularyUnverified: false,
  }
}

function evaluateCountryV2(sourceCountry: string | null | undefined, companyCountry: string | null | undefined, sourceNoun: string): { outcome: 'matched' | 'mismatched' | 'missing'; values: readonly string[]; note: string } {
  const source = sourceCountry === null || sourceCountry === undefined ? '' : normalizeValue(sourceCountry)
  const company = companyCountry === null || companyCountry === undefined ? '' : normalizeValue(companyCountry)
  if (source === '' || company === '') {
    return { outcome: 'missing', values: [], note: 'country unavailable on one side' }
  }
  if (source === company) return { outcome: 'matched', values: [source], note: '' }
  return { outcome: 'mismatched', values: [source, company].sort(), note: `${sourceNoun} and company countries differ` }
}

function evaluateKeywordsV2(sourceText: string, companyText: string, sourceNoun: string): { outcome: 'matched' | 'missing'; values: readonly string[]; note: string } {
  const sourceTokens = tokenize(sourceText)
  const companyTokens = tokenize(companyText)
  if (sourceTokens.length === 0 || companyTokens.length === 0) {
    return { outcome: 'missing', values: [], note: 'comparable text unavailable on one side' }
  }
  const shared = intersectSorted(sourceTokens, companyTokens)
  if (shared.length > 0) return { outcome: 'matched', values: shared, note: '' }
  // v1-compatible: keyword absence is missing evidence, never a contradiction.
  return { outcome: 'missing', values: [], note: `no shared keyword between ${sourceNoun} text and company text` }
}

/**
 * V2-CONTEXT: records which source-backed evidence categories exist for a
 * human to inspect. Presence here informs nothing and blocks nothing.
 */
export function contextSignalsFor(evidence: V2EvidenceContext | null | undefined): readonly string[] {
  if (evidence === null || evidence === undefined) return []
  const signals: string[] = []
  if ((evidence.opportunityProgrammes ?? []).length > 0) signals.push('programme-evidence-present')
  if ((evidence.opportunitySectors ?? []).length > 0) signals.push('sector-evidence-present')
  if ((evidence.opportunityCategories ?? []).length > 0) signals.push('category-evidence-present')
  if (evidence.opportunityDocumentsAvailable === true) signals.push('document-evidence-present')
  return signals
}

function validateFundingPair(source: MatchSourceRecord, company: MatchCompanyRecord): void {
  if (source === null || typeof source !== 'object' || company === null || typeof company !== 'object') {
    throw new Error('matching requires a source record object and a company record object')
  }
  if (typeof source.recordId !== 'string' || source.recordId.length === 0) {
    throw new Error('source recordId must be a non-empty string')
  }
  if (typeof company.companyId !== 'string' || company.companyId.length === 0) {
    throw new Error('companyId must be a non-empty string')
  }
}

/**
 * V2-DECIDE (shared by funding and procurement): PROPOSED requires at least
 * one decisive matched signal AND zero decisive mismatched signals — stricter
 * than v1, which proposes even when a contradiction sits beside a match.
 * NOT_A_MATCH requires a decisive mismatch with no decisive match; otherwise
 * INSUFFICIENT_EVIDENCE. Missing/unverified evidence never decides either way.
 */
function decideV2(matched: number, mismatched: number): MatchProposalStatus {
  if (matched > 0 && mismatched === 0) return 'PROPOSED'
  if (mismatched > 0 && matched === 0) return 'NOT_A_MATCH'
  if (matched > 0) return 'NOT_A_MATCH'
  return 'INSUFFICIENT_EVIDENCE'
}

/**
 * Funding shadow evaluator. Same inputs as v1 `proposeMatch` plus optional
 * additive evidence context. Deterministic and frozen like v1.
 */
export function proposeMatchV2(
  source: MatchSourceRecord,
  company: MatchCompanyRecord,
  evidence: V2EvidenceContext | null | undefined = null,
): V2MatchProposal {
  validateFundingPair(source, company)
  const industry = evaluateIndustryV2(source.industries, company.industries, 'proposal')
  const country = evaluateCountryV2(source.country ?? null, company.country ?? null, 'proposal')
  const keywords = evaluateKeywordsV2(
    `${source.name ?? ''}\n${source.description ?? ''}`,
    [company.description ?? '', ...(company.capabilities ?? [])].join('\n'),
    'proposal',
  )
  const decisive = [
    { signal: 'industry-overlap', ...industry, sourceField: 'industry', companyField: 'industry' },
    { signal: 'country-compatibility', ...country, sourceField: 'country', companyField: 'country' },
    { signal: 'keyword-overlap', ...keywords, sourceField: 'name/description', companyField: 'description/capabilities' },
  ] as const
  const matched = decisive.filter((entry) => entry.outcome === 'matched')
  const mismatched = decisive.filter((entry) => entry.outcome === 'mismatched')
  const missingSignals = decisive.filter((entry) => entry.outcome === 'missing').map((entry) => entry.signal)
  const contextSignals = [
    ...contextSignalsFor(evidence),
    ...(industry.vocabularyUnverified ? ['industry-vocabulary-unverified'] : []),
  ]
  return deepFreeze({
    proposalId: `MP2:${MATCH_RULES_V2_VERSION}:${source.recordId}:${company.companyId}`,
    ruleVersion: MATCH_RULES_V2_VERSION,
    sourceRecordId: source.recordId,
    sourceRecordType: source.recordType,
    companyId: company.companyId,
    matchedSignals: matched.map((entry) => entry.signal),
    missingSignals,
    evidence: decisive.map((entry) => ({
      signal: entry.signal,
      outcome: entry.outcome,
      values: [...entry.values],
      note: entry.note,
      sourceField: entry.sourceField,
      companyField: entry.companyField,
    })),
    status: decideV2(matched.length, mismatched.length),
    contextSignals,
  })
}

function validateProcurementPair(source: ProcurementSourceRecord, company: ProcurementCompanyRecord): void {
  if (source === null || typeof source !== 'object' || company === null || typeof company !== 'object') {
    throw new Error('procurement matching requires an RFP record object and a company record object')
  }
  if (typeof source.recordId !== 'string' || source.recordId.length === 0) {
    throw new Error('RFP recordId must be a non-empty string')
  }
  if (typeof company.companyId !== 'string' || company.companyId.length === 0) {
    throw new Error('companyId must be a non-empty string')
  }
}

/**
 * Procurement shadow evaluator. Same inputs as v1 `proposeProcurementMatch`
 * plus optional additive evidence context. Capability overlap mirrors v1
 * (company capability list vs RFP text); cross-vocabulary guard applies to
 * industry as in funding.
 */
export function proposeProcurementMatchV2(
  source: ProcurementSourceRecord,
  company: ProcurementCompanyRecord,
  evidence: V2EvidenceContext | null | undefined = null,
): V2ProcurementMatchProposal {
  validateProcurementPair(source, company)
  const industry = evaluateIndustryV2(source.industries, company.industries, 'RFP')
  const country = evaluateCountryV2(source.country ?? null, company.country ?? null, 'RFP')
  const keywords = evaluateKeywordsV2(
    `${source.name ?? ''}\n${source.description ?? ''}`,
    company.description ?? '',
    'RFP',
  )
  const capabilities = evaluateKeywordsV2(
    `${source.name ?? ''}\n${source.description ?? ''}`,
    [...(company.capabilities ?? [])].join('\n'),
    'RFP',
  )
  const decisive = [
    { signal: 'industry-overlap' as const, ...industry, sourceField: 'industry', companyField: 'industry' },
    { signal: 'country-compatibility' as const, ...country, sourceField: 'country', companyField: 'country' },
    { signal: 'keyword-overlap' as const, ...keywords, sourceField: 'name/description', companyField: 'description' },
    { signal: 'capability-overlap' as const, ...capabilities, sourceField: 'name/description', companyField: 'capabilities' },
  ]
  const matched = decisive.filter((entry) => entry.outcome === 'matched')
  const mismatched = decisive.filter((entry) => entry.outcome === 'mismatched')
  const missingSignals = decisive.filter((entry) => entry.outcome === 'missing').map((entry) => entry.signal)
  const contextSignals = [
    ...contextSignalsFor(evidence),
    ...(industry.vocabularyUnverified ? ['industry-vocabulary-unverified'] : []),
  ]
  return deepFreeze({
    proposalId: `PP2:${PMATCH_RULES_V2_VERSION}:${source.recordId}:${company.companyId}`,
    ruleVersion: PMATCH_RULES_V2_VERSION,
    recordType: 'notice' as const,
    noticeId: source.recordId,
    companyId: company.companyId,
    matchedSignals: matched.map((entry) => entry.signal),
    missingSignals,
    evidence: decisive.map((entry) => ({
      signal: entry.signal,
      outcome: entry.outcome,
      values: [...entry.values],
      note: entry.note,
      sourceField: entry.sourceField,
      companyField: entry.companyField,
    })),
    status: decideV2(matched.length, mismatched.length),
    contextSignals,
  })
}
