/**
 * Candidate deduplication (Phase C brief §9) — DEDUP-RULES-v1.
 *
 * Identity is evaluated in three documented tiers:
 *  1. sourceId + sourceRecordId  → exact; a source reported the same record
 *     twice (or a rerun resurfaced it);
 *  2. canonical URL              → exact; two listings point at the same
 *     resource, even across sources;
 *  3. folded-composite identity  → possible; orthographically folded titles
 *     match AND the pair shares at least one corroborating signal (same
 *     organization, country, or deadline), or the full composite key is equal.
 *
 * Verdicts: DISTINCT, EXACT_DUPLICATE, POSSIBLE_DUPLICATE. Exact duplicates
 * move to DUPLICATE; possible duplicates move to REVIEW. No candidate is ever
 * silently merged — every candidate is preserved with its duplicate metadata.
 */

import type { DiscoveryCandidate, DuplicateMetadata } from './candidate'
import { deepFreeze } from './candidate'

export const DEDUP_RULE_VERSION = 'DEDUP-RULES-v1'

/** Orthographic fold table: forms that are the same word in another dialect. */
const ORTHOGRAPHIC_FOLD: Record<string, string> = {
  programme: 'program',
  programmes: 'program',
  colour: 'color',
  colours: 'color',
  organisation: 'organization',
  organisations: 'organizations',
  centre: 'center',
  centres: 'centers',
}

/**
 * Title identity key: lowercase, whitespace-collapsed, orthographically
 * folded. Used for the tier-3 "possible duplicate" comparison so that
 * "Grant Programme" and "Grant Program" compare equal.
 */
export function foldTitleKey(title: string): string {
  const collapsed = title.trim().toLowerCase().replace(/\s+/g, ' ')
  if (collapsed.length === 0) return ''
  return collapsed
    .split(' ')
    .map((word) => ORTHOGRAPHIC_FOLD[word] ?? word)
    .join(' ')
}

function pairKey(candidate: DiscoveryCandidate): string | null {
  const recordId = candidate.sourceRecordId
  if (recordId === null || recordId.trim().length === 0) return null
  return `${candidate.sourceId}|${recordId}`
}

function canonicalKey(candidate: DiscoveryCandidate): string | null {
  return candidate.normalization?.canonicalUrl ?? null
}

/**
 * Full composite identity: the folded title, the sealed domain, and every
 * corroborating field, joined deterministically. Equality here is the strong
 * signal that yields POSSIBLE even when no single field differs meaningfully.
 */
export function compositeIdentityKey(candidate: DiscoveryCandidate): string {
  return [
    foldTitleKey(candidate.sourceTitle),
    candidate.domain,
    candidate.sourceOrganization ?? '',
    candidate.sourceCountry ?? '',
    candidate.sourceDeadline ?? '',
    candidate.sourcePublicationDate ?? '',
  ].join('|')
}

function corroboratingSignals(a: DiscoveryCandidate, b: DiscoveryCandidate): readonly string[] {
  const signals: string[] = []
  if (a.sourceOrganization !== null && b.sourceOrganization !== null && a.sourceOrganization === b.sourceOrganization) {
    signals.push('sourceOrganization')
  }
  if (a.sourceCountry !== null && b.sourceCountry !== null && a.sourceCountry === b.sourceCountry) {
    signals.push('sourceCountry')
  }
  if (a.sourceDeadline !== null && b.sourceDeadline !== null && a.sourceDeadline === b.sourceDeadline) {
    signals.push('sourceDeadline')
  }
  return signals
}

function attach(
  candidate: DiscoveryCandidate,
  metadata: DuplicateMetadata,
): DiscoveryCandidate {
  const status =
    metadata.verdict === 'EXACT_DUPLICATE'
      ? 'DUPLICATE'
      : metadata.verdict === 'POSSIBLE_DUPLICATE'
        ? 'REVIEW'
        : candidate.candidateStatus

  return deepFreeze({
    ...candidate,
    candidateStatus: status,
    duplicate: metadata,
    provenance: {
      ...candidate.provenance,
      stageHistory: deepFreeze([...candidate.provenance.stageHistory, 'dedup']),
    },
  })
}

function distinctMetadata(candidate: DiscoveryCandidate): DuplicateMetadata {
  const titleKey = foldTitleKey(candidate.sourceTitle)
  return {
    verdict: 'DISTINCT',
    evidence: {
      ruleVersion: DEDUP_RULE_VERSION,
      matchedOn: 'no-match',
      tier: 1,
      otherCandidateId: null,
      titleKey: titleKey.length > 0 ? titleKey : null,
      corroboratingSignals: [],
    },
  }
}

/**
 * Deduplicates a collection of normalized (and optionally classified)
 * candidates. Order is preserved. For each candidate the highest-priority
 * identity tier decides the verdict; the first occurrence of an identity is
 * the canonical one (DISTINCT), later occurrences are DUPLICATE / REVIEW.
 */
export function deduplicateCandidates(candidates: readonly DiscoveryCandidate[]): DiscoveryCandidate[] {
  const result: DiscoveryCandidate[] = []
  const tier1 = new Map<string, DiscoveryCandidate>()
  const tier2 = new Map<string, DiscoveryCandidate>()

  const push = (candidate: DiscoveryCandidate): void => {
    const titleKey = foldTitleKey(candidate.sourceTitle)

    const key1 = pairKey(candidate)
    if (key1 !== null) {
      const prior = tier1.get(key1)
      if (prior !== undefined) {
        result.push(
          attach(candidate, {
            verdict: 'EXACT_DUPLICATE',
            evidence: {
              ruleVersion: DEDUP_RULE_VERSION,
              matchedOn: 'sourceId+sourceRecordId',
              tier: 1,
              otherCandidateId: prior.candidateId,
              titleKey: titleKey.length > 0 ? titleKey : null,
              corroboratingSignals: [],
            },
          }),
        )
        return
      }
    }

    const key2 = canonicalKey(candidate)
    if (key2 !== null) {
      const prior = tier2.get(key2)
      if (prior !== undefined) {
        result.push(
          attach(candidate, {
            verdict: 'EXACT_DUPLICATE',
            evidence: {
              ruleVersion: DEDUP_RULE_VERSION,
              matchedOn: 'canonical-url',
              tier: 2,
              otherCandidateId: prior.candidateId,
              titleKey: titleKey.length > 0 ? titleKey : null,
              corroboratingSignals: [],
            },
          }),
        )
        return
      }
    }

    const composite = compositeIdentityKey(candidate)
    for (const prior of result) {
      if (prior.candidateId === candidate.candidateId) continue
      if (prior.domain !== candidate.domain) continue
      const signals = corroboratingSignals(prior, candidate)
      if (composite === compositeIdentityKey(prior)) {
        result.push(
          attach(candidate, {
            verdict: 'POSSIBLE_DUPLICATE',
            evidence: {
              ruleVersion: DEDUP_RULE_VERSION,
              matchedOn: 'composite-identity',
              tier: 3,
              otherCandidateId: prior.candidateId,
              titleKey: titleKey.length > 0 ? titleKey : null,
              corroboratingSignals: signals,
            },
          }),
        )
        return
      }
      if (titleKey.length > 0 && foldTitleKey(prior.sourceTitle) === titleKey && signals.length > 0) {
        result.push(
          attach(candidate, {
            verdict: 'POSSIBLE_DUPLICATE',
            evidence: {
              ruleVersion: DEDUP_RULE_VERSION,
              matchedOn: 'folded-title+corroborating-signal',
              tier: 3,
              otherCandidateId: prior.candidateId,
              titleKey,
              corroboratingSignals: signals,
            },
          }),
        )
        return
      }
    }

    result.push(attach(candidate, distinctMetadata(candidate)))

    if (key1 !== null) tier1.set(key1, candidate)
    if (key2 !== null) tier2.set(key2, candidate)
  }

  for (const candidate of candidates) push(candidate)
  return deepFreeze(result)
}