/**
 * Deterministic procurement matching proposal engine — Phase Q (PMATCH-RULES-v1).
 *
 * Pure function: one approved Notice/RFP record plus company records in, one
 * ProcurementMatchProposal per company out. Proposals are NOT ProcurementMatch
 * records, are never written anywhere, and require a future human review before
 * anything can be created from them.
 *
 * Signals (all deterministic, all evidence-carrying), built on the proven
 * MATCH-RULES-v1 approach from Phase L and renamed to RFP terminology:
 *  - industry-overlap: normalized RFP industries ∩ company industries;
 *  - country-compatibility: normalized countries equal (matched) or both
 *    present and different (mismatched);
 *  - keyword-overlap: normalized tokens shared between the RFP's name/description
 *    text and the company's description text;
 *  - capability-overlap: normalized tokens shared between the RFP's
 *    name/description text and the company's capability phrases
 *    (technology_focus / project_focus / certifications), used only when those
 *    fields actually exist.
 *
 * Missing data is never assumed: a signal whose side is missing becomes missing
 * evidence naming the unavailable information. Statuses:
 *  - PROPOSED: at least one matched signal (worth a human look);
 *  - NOT_A_MATCH: no matched signal but incompatible evidence;
 *  - INSUFFICIENT_EVIDENCE: nothing matched and nothing contradicted.
 * There are no numeric scores, no confidence values, no model names, and no
 * generated explanations — only field-level evidence.
 *
 * Determinism: same RFP + company + rule version always yields the same
 * proposal. No clock, no randomness, no network, no filesystem.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - zero imports — not even siblings — so no pipeline stage can reach through
 *    it and it cannot reach any writer.
 */

export const PMATCH_RULES_VERSION = 'PMATCH-RULES-v1' as const

/**
 * The RFP side of a matching pair. Mirrors the Phase K proposal payload:
 * identity, kind, and whatever descriptive fields the proposal actually
 * carries. Absent fields stay absent — the engine reads them, never fills
 * them.
 */
export interface ProcurementSourceRecord {
  recordId: string
  recordType: 'notice'
  name?: string | null
  country?: string | null
  industries?: readonly string[] | null
  description?: string | null
}

/**
 * The company side of a matching pair. Mirrors real company-record fields;
 * `capabilities` is the caller-flattened technology_focus, project_focus, and
 * certifications lists — aggregation of present fields, never invention.
 */
export interface ProcurementCompanyRecord {
  companyId: string
  name?: string | null
  country?: string | null
  industries?: readonly string[] | null
  description?: string | null
  capabilities?: readonly string[] | null
}

export type ProcurementMatchSignalId =
  | 'industry-overlap'
  | 'country-compatibility'
  | 'keyword-overlap'
  | 'capability-overlap'

export type ProcurementMatchEvidenceOutcome = 'matched' | 'mismatched' | 'missing'

export interface ProcurementMatchEvidence {
  signal: ProcurementMatchSignalId
  outcome: ProcurementMatchEvidenceOutcome
  sourceField: string
  companyField: string
  /** Normalized values involved: shared values when matched, the compared
   *  values when mismatched, empty when missing. */
  values: readonly string[]
  /** For missing evidence: which required information was unavailable. */
  note: string
}

export type ProcurementMatchProposalStatus = 'PROPOSED' | 'INSUFFICIENT_EVIDENCE' | 'NOT_A_MATCH'

export interface ProcurementMatchProposal {
  proposalId: string
  ruleVersion: typeof PMATCH_RULES_VERSION
  recordType: 'notice'
  noticeId: string
  companyId: string
  matchedSignals: readonly ProcurementMatchSignalId[]
  missingSignals: readonly ProcurementMatchSignalId[]
  evidence: readonly ProcurementMatchEvidence[]
  status: ProcurementMatchProposalStatus
}

/**
 * PMATCH-RULES-v1 token configuration, reused verbatim from MATCH-RULES-v1:
 * lowercase matching, tokens shorter than two characters dropped, and these
 * filler tokens ignored: generic business boilerplate plus the demo records'
 * own fictional-profile boilerplate. Fixed with the rule version — changing it
 * means a new rule version.
 */
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

function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
  const object = value as Record<string, unknown>
  for (const key of Object.keys(object)) {
    const child = object[key]
    if (child !== null && typeof child === 'object') deepFreeze(child)
  }
  return Object.freeze(object) as T
}

function evaluateIndustry(source: ProcurementSourceRecord, company: ProcurementCompanyRecord): ProcurementMatchEvidence {
  const base = { signal: 'industry-overlap' as const, sourceField: 'industry', companyField: 'industry' }
  const sourceIndustries = normalizeList(source.industries)
  const companyIndustries = normalizeList(company.industries)
  if (sourceIndustries.length === 0) {
    return { ...base, outcome: 'missing', values: [], note: 'RFP industry unavailable' }
  }
  if (companyIndustries.length === 0) {
    return { ...base, outcome: 'missing', values: [], note: 'company industry unavailable' }
  }
  const shared = intersectSorted(sourceIndustries, companyIndustries)
  if (shared.length > 0) {
    return { ...base, outcome: 'matched', values: shared, note: '' }
  }
  return {
    ...base,
    outcome: 'mismatched',
    values: unionSorted(sourceIndustries, companyIndustries),
    note: 'no shared industry between RFP and company',
  }
}

function evaluateCountry(source: ProcurementSourceRecord, company: ProcurementCompanyRecord): ProcurementMatchEvidence {
  const base = { signal: 'country-compatibility' as const, sourceField: 'country', companyField: 'country' }
  const sourceCountry = source.country === null || source.country === undefined ? '' : normalizeValue(source.country)
  const companyCountry =
    company.country === null || company.country === undefined ? '' : normalizeValue(company.country)
  if (sourceCountry === '') {
    return { ...base, outcome: 'missing', values: [], note: 'RFP country unavailable' }
  }
  if (companyCountry === '') {
    return { ...base, outcome: 'missing', values: [], note: 'company country unavailable' }
  }
  if (sourceCountry === companyCountry) {
    return { ...base, outcome: 'matched', values: [sourceCountry], note: '' }
  }
  return {
    ...base,
    outcome: 'mismatched',
    values: [sourceCountry, companyCountry].sort(),
    note: 'RFP and company countries differ',
  }
}

const RFP_TEXT = 'name/description'

function evaluateKeywords(source: ProcurementSourceRecord, company: ProcurementCompanyRecord): ProcurementMatchEvidence {
  const base = { signal: 'keyword-overlap' as const, sourceField: RFP_TEXT, companyField: 'description' }
  const sourceTokens = tokenize(`${source.name ?? ''}\n${source.description ?? ''}`)
  const companyTokens = tokenize(company.description)
  if (sourceTokens.length === 0) {
    return { ...base, outcome: 'missing', values: [], note: 'RFP has no comparable text' }
  }
  if (companyTokens.length === 0) {
    return { ...base, outcome: 'missing', values: [], note: 'company has no comparable text' }
  }
  const shared = intersectSorted(sourceTokens, companyTokens)
  if (shared.length > 0) {
    return { ...base, outcome: 'matched', values: shared, note: '' }
  }
  return { ...base, outcome: 'missing', values: [], note: 'no shared keyword between RFP text and company description' }
}

function evaluateCapabilities(source: ProcurementSourceRecord, company: ProcurementCompanyRecord): ProcurementMatchEvidence {
  const base = { signal: 'capability-overlap' as const, sourceField: RFP_TEXT, companyField: 'capabilities' }
  const sourceTokens = tokenize(`${source.name ?? ''}\n${source.description ?? ''}`)
  const capabilities = company.capabilities === null || company.capabilities === undefined ? [] : [...company.capabilities]
  if (sourceTokens.length === 0) {
    return { ...base, outcome: 'missing', values: [], note: 'RFP has no comparable text' }
  }
  if (capabilities.length === 0) {
    return { ...base, outcome: 'missing', values: [], note: 'company capability list unavailable' }
  }
  const companyTokens = tokenize(capabilities.join('\n'))
  const shared = intersectSorted(sourceTokens, companyTokens)
  if (shared.length > 0) {
    return { ...base, outcome: 'matched', values: shared, note: '' }
  }
  return { ...base, outcome: 'missing', values: [], note: 'no shared capability between RFP text and company capabilities' }
}

function validatePair(source: ProcurementSourceRecord, company: ProcurementCompanyRecord): void {
  if (source === null || typeof source !== 'object' || company === null || typeof company !== 'object') {
    throw new Error('procurement matching requires an RFP record object and a company record object')
  }
  if (typeof source.recordId !== 'string' || source.recordId.length === 0) {
    throw new Error('RFP recordId must be a non-empty string')
  }
  if (source.recordType !== 'notice') {
    throw new Error(`unsupported source record type: ${String(source.recordType)}`)
  }
  if (typeof company.companyId !== 'string' || company.companyId.length === 0) {
    throw new Error('companyId must be a non-empty string')
  }
}

/**
 * Proposes one match verdict for one RFP/company pair. Pure and total: every
 * pair yields exactly one frozen proposal — PROPOSED when at least one signal
 * matched, NOT_A_MATCH when evidence contradicts and nothing matched,
 * INSUFFICIENT_EVIDENCE otherwise.
 */
export function proposeProcurementMatch(
  source: ProcurementSourceRecord,
  company: ProcurementCompanyRecord,
): ProcurementMatchProposal {
  validatePair(source, company)
  const evidence = deepFreeze([
    evaluateIndustry(source, company),
    evaluateCountry(source, company),
    evaluateKeywords(source, company),
    evaluateCapabilities(source, company),
  ])
  const matchedSignals = deepFreeze(
    evidence.filter((entry) => entry.outcome === 'matched').map((entry) => entry.signal),
  )
  const missingSignals = deepFreeze(
    evidence.filter((entry) => entry.outcome === 'missing').map((entry) => entry.signal),
  )
  const mismatched = evidence.some((entry) => entry.outcome === 'mismatched')
  const status: ProcurementMatchProposalStatus =
    matchedSignals.length > 0 ? 'PROPOSED' : mismatched ? 'NOT_A_MATCH' : 'INSUFFICIENT_EVIDENCE'
  return deepFreeze({
    proposalId: `PP:${PMATCH_RULES_VERSION}:${source.recordId}:${company.companyId}`,
    ruleVersion: PMATCH_RULES_VERSION,
    recordType: 'notice' as const,
    noticeId: source.recordId,
    companyId: company.companyId,
    matchedSignals,
    missingSignals,
    evidence,
    status,
  })
}

/**
 * Proposes a verdict for every company, in input order. Empty input yields no
 * proposals — never an error, never a guess.
 */
export function proposeProcurementMatches(
  source: ProcurementSourceRecord,
  companies: readonly ProcurementCompanyRecord[],
): readonly ProcurementMatchProposal[] {
  return deepFreeze(companies.map((company) => proposeProcurementMatch(source, company)))
}