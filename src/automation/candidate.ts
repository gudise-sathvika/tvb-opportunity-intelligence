/**
 * Phase C discovery candidate contract (Architecture §9–§10, §14 / Phase C
 * brief §3, §4).
 *
 * A candidate is the durable, provenance-traced representation of one
 * discovered opportunity between the moment an adapter returns a raw listing
 * and the moment a later phase (matching / human review) acts on it. The
 * contract carries:
 *  - the flat source-shaped fields exactly as observed (source title, url,
 *    dates, organization, country, raw type) so nothing is hidden behind the
 *    raw payload;
 *  - a deterministic candidate id (sourceRecordId preferred, documented
 *    hash fallback — never random);
 *  - candidate-level provenance that records every stage this candidate has
 *    passed through;
 *  - stage metadata blocks that keep their original values so a reviewer can
 *    always see what changed and why.
 *
 * Phase C creates candidates from adapter results and runs them through
 * normalization, classification, and deduplication. It never creates vault
 * records, matches, bids, or contracts, and it never fabricates a value the
 * source did not provide.
 */

import type { AccessState, DiscoveryDomain } from './types'

/** Locked Phase A candidate-state vocabulary (Architecture §14). */
export const CANDIDATE_STATES = [
  'NEW',
  'NORMALIZED',
  'REVIEW',
  'APPROVED',
  'REJECTED',
  'DUPLICATE',
  'BLOCKED',
] as const
export type CandidateState = (typeof CANDIDATE_STATES)[number]

/** The only candidate granularity this phase produces: one aggregated opportunity. */
export const CANDIDATE_TYPES = ['opportunity'] as const
export type CandidateType = (typeof CANDIDATE_TYPES)[number]

/** Stage names a candidate passes through. Provenance records them in order. */
export const CANDIDATE_STAGES = ['transform', 'normalize', 'classify', 'dedup'] as const
export type CandidateStage = (typeof CANDIDATE_STAGES)[number]

/**
 * Candidate-level provenance. Answers the nine Phase A questions for the
 * candidate itself and, unlike the adapter envelope, keeps an ordered
 * stageHistory so a reviewer can trace which stages ran (and in which order).
 */
export interface CandidateProvenance {
  runId: string
  companyId: string
  discoveryProfileId: string
  sourceId: string
  sourceName: string | null
  sourceUrl: string
  sourceRecordId: string | null
  adapterType: string | null
  domain: DiscoveryDomain
  accessState: AccessState | null
  queryTerm: string | null
  requestedAt: string
  observedAt: string
  stageHistory: readonly CandidateStage[]
}

/** Normalization status vocabulary (brief §7). */
export const NORMALIZATION_STATES = ['UNCHANGED', 'NORMALIZED', 'WARNING', 'FAILED'] as const
export type NormalizationState = (typeof NORMALIZATION_STATES)[number]

/**
 * Normalization metadata. Every normalized field keeps its original value, so
 * "what changed" is always auditable. `changedFields` names the candidate
 * fields whose normalized value differs from the source value. `canonicalUrl`
 * is the derived canonical form used by deduplication tier 2.
 */
export interface NormalizationMetadata {
  ruleVersion: string
  status: NormalizationState
  changedFields: readonly string[]
  warnings: readonly string[]
  title: { original: string; normalized: string }
  sourceUrl: { original: string; normalized: string }
  canonicalUrl: string | null
  summary: { original: string | null; normalized: string | null }
  publicationDate: { original: string | null; normalized: string | null }
  deadline: { original: string | null; normalized: string | null }
  organization: { original: string | null; normalized: string | null }
  country: { original: string | null; normalized: string | null }
  rawType: { original: string | null; normalized: string | null }
  /**
   * Source-published lifecycle status (e.g. Grants.gov `oppStatus`), carried
   * through unchanged. This is NOT an "is open" or eligibility verdict — the
   * pipeline never interprets it; it is evidence a reviewer can read.
   */
  sourceStatus: { original: string | null; normalized: string | null }
}

/** Classification status vocabulary (brief §8). */
export const CLASSIFICATION_STATES = ['CLASSIFIED', 'NEEDS_REVIEW'] as const
export type ClassificationState = (typeof CLASSIFICATION_STATES)[number]

/** Deterministic certainty levels — never AI confidence scores. */
export const CERTAINTY_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const
export type Certainty = (typeof CERTAINTY_LEVELS)[number]

/**
 * Classification evidence. Retains the source metadata and the deterministic
 * rule that produced the verdict. There is deliberately no free-text
 * AI explanation: the evidence is fully reproducible from source + rule.
 */
export interface ClassificationEvidence {
  domain: DiscoveryDomain
  sourceEvidence: {
    sourceId: string
    adapterType: string | null
    sourceRawType: string | null
  }
  titleHints: readonly string[]
  matchedRule: string
  ruleVersion: string
}

/**
 * Classification metadata. When evidence is insufficient the state is
 * NEEDS_REVIEW, the type is null, and the candidate moves to REVIEW — the
 * pipeline never guesses an opportunity type.
 */
export interface ClassificationMetadata {
  state: ClassificationState
  type: string | null
  certainty: Certainty | null
  evidence: ClassificationEvidence
}

/** Deduplication verdict vocabulary (brief §9). */
export const DEDUP_VERDICTS = ['DISTINCT', 'EXACT_DUPLICATE', 'POSSIBLE_DUPLICATE'] as const
export type DedupVerdict = (typeof DEDUP_VERDICTS)[number]

/**
 * Duplicate evidence. `tier` names which identity tier matched (1 =
 * sourceId+sourceRecordId, 2 = canonical URL, 3 = folded-composite identity).
 * `otherCandidateId` points at the candidate this one was compared against.
 * No candidate is silently merged — duplication always preserves both records.
 */
export interface DuplicateEvidence {
  ruleVersion: string
  matchedOn: string
  tier: 1 | 2 | 3
  otherCandidateId: string | null
  titleKey: string | null
  corroboratingSignals: readonly string[]
}

export interface DuplicateMetadata {
  verdict: DedupVerdict
  evidence: DuplicateEvidence
}

/**
 * The discovery candidate. Source-shaped fields hold the *normalized* values
 * after normalization runs; the originals are preserved in `normalization`.
 * `candidateStatus` moves NEW → NORMALIZED → (REVIEW | DUPLICATE) as stages
 * run. APPROVED / REJECTED are reserved for later human-in-the-loop phases —
 * this pipeline never sets them.
 */
export interface DiscoveryCandidate {
  candidateId: string
  discoveryRunId: string
  companyId: string
  discoveryProfileId: string
  sourceId: string
  sourceRecordId: string | null
  sourceUrl: string
  sourceTitle: string
  sourceSummary: string | null
  sourcePublicationDate: string | null
  sourceDeadline: string | null
  sourceOrganization: string | null
  sourceCountry: string | null
  sourceRawType: string | null
  /** Source-published lifecycle status (e.g. Grants.gov `oppStatus`) or null. Never an "open"/eligibility verdict. */
  sourceStatus: string | null
  domain: DiscoveryDomain
  candidateType: CandidateType
  candidateStatus: CandidateState
  provenance: CandidateProvenance
  normalization: NormalizationMetadata | null
  classification: ClassificationMetadata | null
  duplicate: DuplicateMetadata | null
}

/** Recursively freezes plain data (deep-freeze). Used by every Phase C stage. */
export function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
  const object = value as Record<string, unknown>
  for (const key of Object.keys(object)) {
    const child = object[key]
    if (child !== null && typeof child === 'object') deepFreeze(child)
  }
  return Object.freeze(object) as T
}

/* ------------------------------------------------------------------ */
/* Stable hashing and candidate ids                                    */
/* ------------------------------------------------------------------ */

/**
 * FNV-1a 64-bit hash over the UTF-16 code units of a string. Implemented with
 * BigInt on purpose: it is a pure, deterministic, dependency-free function
 * that imports no built-in crypto, is stable across Node versions and
 * platforms, and returns a fixed 16-hex-char string. Used only to derive
 * deterministic ids/keys when a source gives us no natural identifier.
 */
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n
const FNV_PRIME_64 = 0x100000001b3n
const FNV_MASK_64 = 0xffffffffffffffffn

export function stableHash(input: string): string {
  let hash = FNV_OFFSET_BASIS_64
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * FNV_PRIME_64) & FNV_MASK_64
  }
  return hash.toString(16).padStart(16, '0')
}

export interface CandidateIdInput {
  sourceId: string
  sourceRecordId: string | null
  sourceUrl: string
  rawPayload: string
}

/**
 * Deterministic candidate id derivation (brief §4). Tier 1 prefers the source
 * record id because it is the natural, human-readable identity a source
 * assigns. When a listing has no record id, tier 2 uses a stable hash of the
 * listing URL; when there is no URL either, tier 3 hashes the raw payload.
 * Equal inputs always produce equal ids — there is no randomness anywhere.
 */
export function candidateIdFor(input: CandidateIdInput): string {
  const recordId = input.sourceRecordId !== null && input.sourceRecordId.length > 0 ? input.sourceRecordId : null
  if (recordId !== null) return `DC:${input.sourceId}:${recordId}`
  const url = input.sourceUrl.trim()
  if (url.length > 0) return `DC:${input.sourceId}:h${stableHash(url)}`
  return `DC:${input.sourceId}:h${stableHash(input.rawPayload)}`
}