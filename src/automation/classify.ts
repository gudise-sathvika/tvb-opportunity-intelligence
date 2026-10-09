/**
 * Candidate classification (Phase C brief §8) — CLASSIFY-RULES-v1.
 *
 * Classification is deterministic and evidence-based, never AI. For each
 * candidate the stage applies a documented rule chain:
 *  1. raw-type alias   — the source's raw type maps to a vocabulary type;
 *  2. title keyword    — a vocabulary keyword in the normalized title;
 *  3. domain default   — for procurement every listing is a public notice;
 *  4. needs-review     — funding listings that match neither rule.
 *
 * Funding and procurement are sealed domains: a procurement candidate can
 * only become 'Notice' and a funding candidate can only become one of
 * Grant / Fund / Subsidy / Incentive / Program. Uncertain funding candidates
 * are NEVER guessed — they become NEEDS_REVIEW and move to REVIEW.
 */

import type { DiscoveryCandidate, ClassificationEvidence, ClassificationMetadata, Certainty } from './candidate'
import { deepFreeze } from './candidate'

export const CLASSIFICATION_RULE_VERSION = 'CLASSIFY-RULES-v1'

export const OPPORTUNITY_TYPE_VOCABULARY = ['Grant', 'Fund', 'Subsidy', 'Incentive', 'Program'] as const
export type OpportunityType = (typeof OPPORTUNITY_TYPE_VOCABULARY)[number]

export const PROCUREMENT_TYPE_VOCABULARY = ['Notice'] as const
export type ProcurementType = (typeof PROCUREMENT_TYPE_VOCABULARY)[number]

export type ClassifiedType = OpportunityType | ProcurementType

const FUNDING_RAW_TYPE_ALIASES: Record<string, OpportunityType> = {
  grant: 'Grant',
  grants: 'Grant',
  grant_opportunity: 'Grant',
  fund: 'Fund',
  funds: 'Fund',
  subsidy: 'Subsidy',
  subsidies: 'Subsidy',
  incentive: 'Incentive',
  incentives: 'Incentive',
  program: 'Program',
  programs: 'Program',
  programme: 'Program',
  programmes: 'Program',
  grant_topic: 'Grant',
  external_action_grant: 'Grant',
  cascade_funding_call: 'Fund',
}

const PROCUREMENT_RAW_TYPE_ALIASES: Record<string, ProcurementType> = {
  notice: 'Notice',
  notices: 'Notice',
  rfb: 'Notice',
  rfp: 'Notice',
  rfi: 'Notice',
  itt: 'Notice',
  tender: 'Notice',
  tenders: 'Notice',
  bid: 'Notice',
  bids: 'Notice',
}

interface TitleHint {
  token: string
  regex: RegExp
}

/** Priority order is deterministic: first matching keyword wins. */
const FUNDING_TITLE_HINTS: readonly TitleHint[] = [
  { token: 'grant', regex: /\bgrant\b/i },
  { token: 'fund', regex: /\bfund\b/i },
  { token: 'subsidy', regex: /\bsubsid(y|ies)\b/i },
  { token: 'incentive', regex: /\bincentive/i },
  { token: 'program', regex: /\bprogram(me)?s?\b/i },
]

const PROCUREMENT_TITLE_HINTS: readonly TitleHint[] = [
  { token: 'rfb', regex: /\brfb\b/i },
  { token: 'rfp', regex: /\brfp\b/i },
  { token: 'rfi', regex: /\brfi\b/i },
  { token: 'itt', regex: /\bitt\b/i },
  { token: 'tender', regex: /\btender/i },
  { token: 'bid', regex: /\bbid/i },
  { token: 'notice', regex: /\bnotice/i },
  { token: 'procure', regex: /\bprocure/i },
  { token: 'contract', regex: /\bcontract/i },
  { token: 'supply', regex: /\bsupply/i },
]

function matchedHintTokens(title: string, hints: readonly TitleHint[]): readonly string[] {
  return hints.filter((hint) => hint.regex.test(title)).map((hint) => hint.token)
}

function firstHintMatch(title: string, hints: readonly TitleHint[]): TitleHint | null {
  return hints.find((hint) => hint.regex.test(title)) ?? null
}

function evidenceFor(
  candidate: DiscoveryCandidate,
  matchedRule: string,
  titleHints: readonly string[],
): ClassificationEvidence {
  return {
    domain: candidate.domain,
    sourceEvidence: {
      sourceId: candidate.sourceId,
      adapterType: candidate.provenance.adapterType,
      sourceRawType: candidate.sourceRawType,
    },
    titleHints,
    matchedRule,
    ruleVersion: CLASSIFICATION_RULE_VERSION,
  }
}

function classifyFunding(candidate: DiscoveryCandidate): ClassificationMetadata {
  const rawType = candidate.sourceRawType === null ? null : candidate.sourceRawType.trim().toLowerCase()

  if (rawType !== null && rawType.length > 0) {
    const alias = FUNDING_RAW_TYPE_ALIASES[rawType]
    if (alias !== undefined) {
      return {
        state: 'CLASSIFIED',
        type: alias,
        certainty: 'HIGH',
        evidence: evidenceFor(candidate, 'raw-type-alias', []),
      }
    }
  }

  const hints = matchedHintTokens(candidate.sourceTitle, FUNDING_TITLE_HINTS)
  const hint = firstHintMatch(candidate.sourceTitle, FUNDING_TITLE_HINTS)
  if (hint !== null) {
    const type = FUNDING_RAW_TYPE_ALIASES[hint.token]
    return {
      state: 'CLASSIFIED',
      type,
      certainty: 'MEDIUM',
      evidence: evidenceFor(candidate, 'title-keyword', hints),
    }
  }

  return {
    state: 'NEEDS_REVIEW',
    type: null,
    certainty: null,
    evidence: evidenceFor(candidate, 'needs-review-no-evidence', []),
  }
}

function classifyProcurement(candidate: DiscoveryCandidate): ClassificationMetadata {
  const rawType = candidate.sourceRawType === null ? null : candidate.sourceRawType.trim().toLowerCase()

  if (rawType !== null && rawType.length > 0) {
    const alias = PROCUREMENT_RAW_TYPE_ALIASES[rawType]
    if (alias !== undefined) {
      return {
        state: 'CLASSIFIED',
        type: alias,
        certainty: 'HIGH',
        evidence: evidenceFor(candidate, 'raw-type-alias', []),
      }
    }
  }

  const hints = matchedHintTokens(candidate.sourceTitle, PROCUREMENT_TITLE_HINTS)
  const hint = firstHintMatch(candidate.sourceTitle, PROCUREMENT_TITLE_HINTS)
  if (hint !== null) {
    return {
      state: 'CLASSIFIED',
      type: 'Notice',
      certainty: 'MEDIUM',
      evidence: evidenceFor(candidate, 'title-keyword', hints),
    }
  }

  return {
    state: 'CLASSIFIED',
    type: 'Notice',
    certainty: 'LOW',
    evidence: evidenceFor(candidate, 'domain-default-procurement', []),
  }
}

/**
 * Classifies one normalized candidate and attaches its classification
 * metadata. Idempotent; blocked candidates are skipped (a failed
 * normalization cannot be classified).
 */
export function classifyCandidate(candidate: DiscoveryCandidate): DiscoveryCandidate {
  if (candidate.classification !== null) return candidate
  if (candidate.candidateStatus === 'BLOCKED') return candidate

  const classification =
    candidate.domain === 'procurement' ? classifyProcurement(candidate) : classifyFunding(candidate)

  return deepFreeze({
    ...candidate,
    candidateStatus: classification.state === 'NEEDS_REVIEW' ? 'REVIEW' : candidate.candidateStatus,
    classification,
    provenance: {
      ...candidate.provenance,
      stageHistory: deepFreeze([...candidate.provenance.stageHistory, 'classify']),
    },
  })
}

/** Shared certainty vocabulary export for tests and documentation. */
export const CLASSIFICATION_CERTAINTIES: readonly Certainty[] = ['HIGH', 'MEDIUM', 'LOW']