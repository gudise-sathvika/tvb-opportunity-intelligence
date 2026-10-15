/**
 * Phase 13 shadow comparison — pure, side-effect-free.
 *
 * Runs v1 and v2 on the SAME immutable input objects and compares the two
 * verdicts without touching any store, queue, decision, or downstream
 * consumer. v1 is invoked through its real public entry points
 * (`proposeMatch` / `proposeProcurementMatch`); v2 through its own. The
 * comparison records input ids, both rule versions, agreement, and the
 * evidence responsible for any difference.
 *
 * Guarantees:
 *  - v1 results are preserved exactly (same objects v1 produced);
 *  - no persistence, no approval, no side effects of any kind;
 *  - unconfirmed entities never enter: callers pass only confirmed profiles
 *    (the Phase 12A confirmation gate lives upstream of this module).
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import { proposeMatch } from './match-proposal'
import type { MatchCompanyRecord, MatchProposal, MatchSourceRecord } from './match-proposal'
import { proposeProcurementMatch } from './procurement-proposal'
import type {
  ProcurementCompanyRecord,
  ProcurementMatchProposal,
  ProcurementSourceRecord,
} from './procurement-proposal'
import { proposeMatchV2, proposeProcurementMatchV2 } from './match-rules-v2'
import type { V2EvidenceContext } from './match-rules-v2'
import { deepFreeze } from './candidate'

export interface ShadowComparison {
  readonly pairId: string
  readonly companyId: string
  readonly recordId: string
  readonly v1RuleVersion: string
  readonly v2RuleVersion: string
  readonly v1Status: string
  readonly v2Status: string
  readonly agreement: boolean
  /** Concrete evidence-level reason when the verdicts differ. */
  readonly difference: string | null
}

export interface ShadowComparisonBatch {
  readonly comparisons: readonly ShadowComparison[]
  readonly agreementCount: number
  readonly disagreementCount: number
}

function differenceFor(v1Status: string, v2Status: string, v2ContextSignals: readonly string[]): string | null {
  if (v1Status === v2Status) return null
  if (v1Status === 'PROPOSED' && v2Status === 'NOT_A_MATCH') {
    return 'v1 proposed on a match beside a contradiction; v2 requires zero decisive mismatches'
  }
  if (v1Status === 'PROPOSED' && v2Status === 'INSUFFICIENT_EVIDENCE') {
    return 'v1 proposed on a match v2 could not confirm without decisive support'
  }
  if (v2Status === 'PROPOSED' && v1Status !== 'PROPOSED') {
    return 'v2 proposed where v1 did not (unexpected: v2 is strictly more conservative by construction)'
  }
  return `verdicts differ (${v1Status} vs ${v2Status}); context: ${v2ContextSignals.join(', ') || 'no additional context'}`
}

/**
 * Evaluates one funding pair under both rule versions with the same inputs.
 * Returns the v1 proposal untouched alongside the v2 verdict and comparison.
 */
export function shadowEvaluateFunding(
  source: MatchSourceRecord,
  company: MatchCompanyRecord,
  evidence: V2EvidenceContext | null = null,
): { v1: MatchProposal; v2Status: string; v2RuleVersion: string; comparison: ShadowComparison } {
  const v1 = proposeMatch(source, company)
  const v2 = proposeMatchV2(source, company, evidence)
  const agreement = v1.status === v2.status
  return {
    v1,
    v2Status: v2.status,
    v2RuleVersion: v2.ruleVersion,
    comparison: {
      pairId: `${company.companyId}×${source.recordId}`,
      companyId: company.companyId,
      recordId: source.recordId,
      v1RuleVersion: v1.ruleVersion,
      v2RuleVersion: v2.ruleVersion,
      v1Status: v1.status,
      v2Status: v2.status,
      agreement,
      difference: differenceFor(v1.status, v2.status, v2.contextSignals),
    },
  }
}

/**
 * Evaluates one procurement pair under both rule versions with the same
 * inputs. Same guarantees as the funding path.
 */
export function shadowEvaluateProcurement(
  source: ProcurementSourceRecord,
  company: ProcurementCompanyRecord,
  evidence: V2EvidenceContext | null = null,
): { v1: ProcurementMatchProposal; v2Status: string; v2RuleVersion: string; comparison: ShadowComparison } {
  const v1 = proposeProcurementMatch(source, company)
  const v2 = proposeProcurementMatchV2(source, company, evidence)
  const agreement = v1.status === v2.status
  return {
    v1,
    v2Status: v2.status,
    v2RuleVersion: v2.ruleVersion,
    comparison: {
      pairId: `${company.companyId}×${source.recordId}`,
      companyId: company.companyId,
      recordId: source.recordId,
      v1RuleVersion: v1.ruleVersion,
      v2RuleVersion: v2.ruleVersion,
      v1Status: v1.status,
      v2Status: v2.status,
      agreement,
      difference: differenceFor(v1.status, v2.status, v2.contextSignals),
    },
  }
}

/** Aggregates comparisons with reconciling counts (agreement + disagreement = total). */
export function summarizeShadowComparisons(comparisons: readonly ShadowComparison[]): ShadowComparisonBatch {
  const agreementCount = comparisons.filter((entry) => entry.agreement).length
  return deepFreeze({
    comparisons: [...comparisons],
    agreementCount,
    disagreementCount: comparisons.length - agreementCount,
  })
}
