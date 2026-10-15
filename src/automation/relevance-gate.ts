/**
 * Phase 29 company-relevance evidence gate — pure, side-effect-free.
 *
 * Sits BETWEEN engine evaluation output and user-facing recommendation
 * language. Engines are untouched: their verdicts, thresholds, and versions
 * stay exactly as produced. This layer only classifies how much the available
 * evidence justifies treating an evaluation as a relevant recommendation:
 *
 *  - `relevance_supported`: a comparable, evidenced signal beyond country
 *    matched (industry-overlap or keyword/capability-overlap on evidenced
 *    company text). Reachable in principle; unreachable in current live data
 *    because no company carries evidenced description/capabilities and no
 *    opportunity carries comparable industries. Documented, not forced.
 *  - `country_compatible_relevance_unverified`: the engine proposed on country
 *    compatibility alone. The opportunity may be worth a human look; relevance
 *    is explicitly NOT established.
 *  - `relevance_contradicted`: decisive engine mismatch (e.g. countries
 *    differ). A positive signal never overrides it here.
 *  - `insufficient_evidence`: the engine itself could not decide.
 *  - `not_actionable`: the opportunity fails the actionability gate,
 *    regardless of any evaluation.
 *
 * There is deliberately NO `eligibility_confirmed` outcome: this layer never
 * declares eligibility, and no input it accepts could support such a claim.
 * Applicant eligibility stays unknown unless authoritative evidence says
 * otherwise (nothing today does).
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only (types only).
 */

import { deepFreeze } from './candidate'

export const RELEVANCE_GATE_VERSION = 'relevance-gate-1' as const

export const RELEVANCE_OUTCOMES = [
  'relevance_supported',
  'country_compatible_relevance_unverified',
  'relevance_contradicted',
  'insufficient_evidence',
  'not_actionable',
] as const
export type RelevanceOutcome = (typeof RELEVANCE_OUTCOMES)[number]

/** Minimal engine-verdict view both rule versions satisfy. */
export interface RelevanceGateInput {
  readonly engineStatus: 'PROPOSED' | 'NOT_A_MATCH' | 'INSUFFICIENT_EVIDENCE'
  readonly matchedSignals: readonly string[]
  readonly mismatchedSignals: readonly string[]
  /** Shared-gate eligibility of the opportunity (`open` is the only actionable state). */
  readonly opportunityEligibility: string
}

export interface RelevanceClassification {
  readonly outcome: RelevanceOutcome
  readonly reason: string
  readonly version: typeof RELEVANCE_GATE_VERSION
}

/** Decisive relevance signals: evidenced comparability beyond country. */
const RELEVANCE_SUPPORTING_SIGNALS: readonly string[] = [
  'industry-overlap',
  'keyword-overlap',
  'capability-overlap',
]

/**
 * Classifies one engine evaluation. Pure and total: every input yields
 * exactly one outcome with a human-readable reason. Never upgrades, never
 * suppresses — the engine verdict travels alongside in the UI.
 */
export function classifyRelevance(input: RelevanceGateInput): RelevanceClassification {
  if (input.opportunityEligibility !== 'open') {
    return deepFreeze({
      outcome: 'not_actionable',
      reason: `opportunity lifecycle is ${input.opportunityEligibility}, not open; relevance is moot`,
      version: RELEVANCE_GATE_VERSION,
    })
  }
  if (input.engineStatus === 'NOT_A_MATCH' || input.mismatchedSignals.length > 0) {
    const clash = input.mismatchedSignals.length > 0 ? input.mismatchedSignals.join(', ') : 'engine contradiction'
    return deepFreeze({
      outcome: 'relevance_contradicted',
      reason: `decisive mismatch on ${clash}; no positive signal overrides it`,
      version: RELEVANCE_GATE_VERSION,
    })
  }
  if (input.engineStatus === 'INSUFFICIENT_EVIDENCE') {
    return deepFreeze({
      outcome: 'insufficient_evidence',
      reason: 'the engine could not decide on current evidence',
      version: RELEVANCE_GATE_VERSION,
    })
  }
  const supported = input.matchedSignals.filter((signal) => (RELEVANCE_SUPPORTING_SIGNALS as readonly string[]).includes(signal))
  if (supported.length > 0) {
    return deepFreeze({
      outcome: 'relevance_supported',
      reason: `evidenced comparability beyond country: ${supported.join(', ')}`,
      version: RELEVANCE_GATE_VERSION,
    })
  }
  return deepFreeze({
    outcome: 'country_compatible_relevance_unverified',
    reason: 'country compatibility alone; industry, capabilities, and applicant eligibility remain unknown',
    version: RELEVANCE_GATE_VERSION,
  })
}
