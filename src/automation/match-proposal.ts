/**
 * Deterministic company-matching proposal engine — Phase L (MATCH-RULES-v1).
 *
 * Pure function: one approved Opportunity/Notice record plus company records
 * in, one MatchProposal per company out. Proposals are NOT Match records, are
 * never written anywhere, and require future human review before anything can
 * be created from them.
 *
 * Signals (all deterministic, all evidence-carrying):
 *  - industry-overlap: normalized proposal industries ∩ company industries;
 *  - country-compatibility: normalized countries equal (matched) or both
 *    present and different (mismatched);
 *  - keyword-overlap: normalized tokens shared between the record's
 *    name/description text and the company's description/capabilities text.
 *
 * Absent data is never assumed: a signal whose side is missing becomes
 * missing evidence naming the unavailable information. Statuses:
 *  - PROPOSED: at least one matched signal (worth a human look);
 *  - NOT_A_MATCH: no matched signal but incompatible evidence;
 *  - INSUFFICIENT_EVIDENCE: nothing matched and nothing contradicted.
 * There are no numeric scores, no confidence values, no model names, and no
 * generated explanations — only field-level evidence.
 *
 * Determinism: same record + company + rule version always yields the same
 * proposal. No clock, no randomness, no network, no filesystem.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - zero imports — not even siblings — so no pipeline stage can reach through
 *    it and it cannot reach any writer.
 */

export const MATCH_RULES_VERSION = 'MATCH-RULES-v1' as const

export type MatchSourceRecordType = 'opportunity' | 'notice'

/**
 * The record side of a matching pair. Mirrors the Phase K proposal payload:
 * identity, kind, and whatever descriptive fields the proposal actually
 * carries. Absent fields stay absent — the engine reads them, never fills
 * them.
 */
export interface MatchSourceRecord {
  recordId: string
  recordType: MatchSourceRecordType
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
export interface MatchCompanyRecord {
  companyId: string
  name?: string | null
  country?: string | null
  industries?: readonly string[] | null
  description?: string | null
  capabilities?: readonly string[] | null
}

export type MatchSignalId = 'industry-overlap' | 'country-compatibility' | 'keyword-overlap'

export type MatchEvidenceOutcome = 'matched' | 'mismatched' | 'missing'

export interface MatchEvidence {
  signal: MatchSignalId
  outcome: MatchEvidenceOutcome
  sourceField: string
  companyField: string
  /** Normalized values involved: shared values when matched, the compared
   *  values when mismatched, empty when missing. */
  values: readonly string[]
  /** For missing evidence: which required information was unavailable. */
  note: string
}

export type MatchProposalStatus = 'PROPOSED' | 'INSUFFICIENT_EVIDENCE' | 'NOT_A_MATCH'

export interface MatchProposal {
  proposalId: string
  ruleVersion: typeof MATCH_RULES_VERSION
  sourceRecordId: string
  sourceRecordType: MatchSourceRecordType
  companyId: string
  matchedSignals: readonly MatchSignalId[]
  missingSignals: readonly MatchSignalId[]
  evidence: readonly MatchEvidence[]
  status: MatchProposalStatus
}

/**
 * MATCH-RULES-v1 token configuration. Lowercase matching, tokens shorter than
 * two characters dropped, and these filler tokens ignored: generic business
 * boilerplate plus the demo records' own fictional-profile boilerplate. Fixed
 * with the rule version — changing it means a new rule version.
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

function evaluateIndustry(source: MatchSourceRecord, company: MatchCompanyRecord): MatchEvidence {
  const base = { signal: 'industry-overlap' as const, sourceField: 'industry', companyField: 'industry' }
  const sourceIndustries = normalizeList(source.industries)
  const companyIndustries = normalizeList(company.industries)
  if (sourceIndustries.length === 0) {
    return { ...base, outcome: 'missing', values: [], note: 'proposal industry unavailable' }
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
    note: 'no shared industry between proposal and company',
  }
}

function evaluateCountry(source: MatchSourceRecord, company: MatchCompanyRecord): MatchEvidence {
  const base = { signal: 'country-compatibility' as const, sourceField: 'country', companyField: 'country' }
  const sourceCountry = source.country === null || source.country === undefined ? '' : normalizeValue(source.country)
  const companyCountry =
    company.country === null || company.country === undefined ? '' : normalizeValue(company.country)
  if (sourceCountry === '') {
    return { ...base, outcome: 'missing', values: [], note: 'proposal country unavailable' }
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
    note: 'proposal and company countries differ',
  }
}

function evaluateKeywords(source: MatchSourceRecord, company: MatchCompanyRecord): MatchEvidence {
  const base = { signal: 'keyword-overlap' as const, sourceField: 'name/description', companyField: 'description/capabilities' }
  const sourceTokens = tokenize(`${source.name ?? ''}\n${source.description ?? ''}`)
  const companyTexts = [company.description ?? '', ...(company.capabilities ?? [])].join('\n')
  const companyTokens = tokenize(companyTexts)
  if (sourceTokens.length === 0) {
    return { ...base, outcome: 'missing', values: [], note: 'proposal has no comparable text' }
  }
  if (companyTokens.length === 0) {
    return { ...base, outcome: 'missing', values: [], note: 'company has no comparable text' }
  }
  const shared = intersectSorted(sourceTokens, companyTokens)
  if (shared.length > 0) {
    return { ...base, outcome: 'matched', values: shared, note: '' }
  }
  return { ...base, outcome: 'missing', values: [], note: 'no shared keyword between proposal and company text' }
}

function validatePair(source: MatchSourceRecord, company: MatchCompanyRecord): void {
  if (source === null || typeof source !== 'object' || company === null || typeof company !== 'object') {
    throw new Error('matching requires a source record object and a company record object')
  }
  if (typeof source.recordId !== 'string' || source.recordId.length === 0) {
    throw new Error('source recordId must be a non-empty string')
  }
  if (source.recordType !== 'opportunity' && source.recordType !== 'notice') {
    throw new Error(`unsupported source record type: ${String(source.recordType)}`)
  }
  if (typeof company.companyId !== 'string' || company.companyId.length === 0) {
    throw new Error('companyId must be a non-empty string')
  }
}

/**
 * Proposes one match verdict for one record/company pair. Pure and total:
 * every pair yields exactly one frozen proposal — PROPOSED when at least one
 * signal matched, NOT_A_MATCH when evidence contradicts and nothing matched,
 * INSUFFICIENT_EVIDENCE otherwise.
 */
export function proposeMatch(source: MatchSourceRecord, company: MatchCompanyRecord): MatchProposal {
  validatePair(source, company)
  const evidence = deepFreeze([evaluateIndustry(source, company), evaluateCountry(source, company), evaluateKeywords(source, company)])
  const matchedSignals = deepFreeze(
    evidence.filter((entry) => entry.outcome === 'matched').map((entry) => entry.signal),
  )
  const missingSignals = deepFreeze(
    evidence.filter((entry) => entry.outcome === 'missing').map((entry) => entry.signal),
  )
  const mismatched = evidence.some((entry) => entry.outcome === 'mismatched')
  const status: MatchProposalStatus =
    matchedSignals.length > 0 ? 'PROPOSED' : mismatched ? 'NOT_A_MATCH' : 'INSUFFICIENT_EVIDENCE'
  return deepFreeze({
    proposalId: `MP:${MATCH_RULES_VERSION}:${source.recordId}:${company.companyId}`,
    ruleVersion: MATCH_RULES_VERSION,
    sourceRecordId: source.recordId,
    sourceRecordType: source.recordType,
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
export function proposeMatches(
  source: MatchSourceRecord,
  companies: readonly MatchCompanyRecord[],
): readonly MatchProposal[] {
  return deepFreeze(companies.map((company) => proposeMatch(source, company)))
}
