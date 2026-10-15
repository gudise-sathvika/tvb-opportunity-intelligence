/**
 * Phase 10 additive proposal explainability — pure, side-effect-free.
 *
 * Explains EXISTING proposals without changing them: statuses, scores,
 * thresholds, and decision semantics are untouched (the input proposal is
 * never mutated — it is already deeply frozen). Every explanation separates:
 *
 *  - supporting evidence (engine outcome `matched`);
 *  - contradictory evidence (engine outcome `mismatched`);
 *  - missing evidence (engine outcome `missing`);
 *  - unverified comparability (a signal that cannot be evaluated yet because
 *    one side publishes no evidence for it — e.g. industry overlap when the
 *    company has no evidenced industry or, always today, the opportunity has
 *    none);
 *  - the rule responsible for the outcome, quoted from the engine's documented
 *    semantics (MATCH-RULES-v1 and PMATCH-RULES-v1 share them verbatim).
 *
 * Provenance is passed through from the caller when available and null
 * otherwise — never invented. A fixed eligibility disclaimer accompanies every
 * explanation: relevance signals are not eligibility proof.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only (types only, in fact
 *    none at runtime).
 */

export type ExplanationOutcome = 'supporting' | 'contradictory' | 'missing' | 'unverified'

export interface ExplanationEntry {
  readonly signal: string
  readonly outcome: ExplanationOutcome
  readonly detail: string
  readonly values: readonly string[]
}

export interface ExplanationProvenance {
  readonly source: string
  readonly verifiedAt: string
}

export interface ProposalExplanation {
  readonly proposalId: string
  readonly ruleVersion: string
  readonly status: string
  readonly supporting: readonly ExplanationEntry[]
  readonly contradictory: readonly ExplanationEntry[]
  readonly missing: readonly ExplanationEntry[]
  readonly unverified: readonly ExplanationEntry[]
  readonly ruleNote: string
  readonly eligibilityDisclaimer: string
  readonly companyProvenance: ExplanationProvenance | null
  readonly opportunityProvenance: ExplanationProvenance | null
}

/** Structural input both MATCH-RULES-v1 and PMATCH-RULES-v1 proposals satisfy. */
export interface ExplainableProposal {
  readonly proposalId: string
  readonly ruleVersion: string
  readonly status: string
  readonly matchedSignals: readonly string[]
  readonly missingSignals: readonly string[]
  readonly evidence: readonly {
    readonly signal: string
    readonly outcome: 'matched' | 'mismatched' | 'missing'
    readonly values: readonly string[]
    readonly note: string
  }[]
}

export interface ExplanationContext {
  readonly companyProvenance?: ExplanationProvenance | null
  readonly opportunityProvenance?: ExplanationProvenance | null
  /** True when the company carries evidenced industry (GLEIF never does; SEC enrichment may). */
  readonly companyIndustryEvidenced?: boolean
  /** True when the opportunity carries industry evidence (no current source does). */
  readonly opportunityIndustryEvidenced?: boolean
}

export const ELIGIBILITY_DISCLAIMER =
  'Country compatibility, programme codes, sector keywords, and industry classifications describe relevance only — ' +
  'none establishes eligibility to apply, qualification to bid, or likelihood of award.'

function ruleNoteFor(status: string): string {
  switch (status) {
    case 'PROPOSED':
      return 'Rule: at least one matched signal makes a proposal worth a human look; missing evidence must still be reviewed before any action.'
    case 'NOT_A_MATCH':
      return 'Rule: no matched signal and at least one explicit incompatibility.'
    default:
      return 'Rule: nothing matched and nothing contradicted — the pair cannot be judged on current evidence.'
  }
}

/**
 * Explains one proposal. Pure and total: unknown statuses and empty evidence
 * yield an (honest, empty) explanation, never an error. The proposal object is
 * read, never written.
 */
export function explainProposal(
  proposal: ExplainableProposal,
  context: ExplanationContext = {},
): ProposalExplanation {
  const supporting: ExplanationEntry[] = []
  const contradictory: ExplanationEntry[] = []
  const missing: ExplanationEntry[] = []
  for (const item of proposal.evidence) {
    const entry: ExplanationEntry = {
      signal: item.signal,
      outcome: item.outcome === 'matched' ? 'supporting' : item.outcome === 'mismatched' ? 'contradictory' : 'missing',
      detail: item.values.length > 0 ? item.values.join(', ') : item.note,
      values: [...item.values],
    }
    if (entry.outcome === 'supporting') supporting.push(entry)
    else if (entry.outcome === 'contradictory') contradictory.push(entry)
    else missing.push(entry)
  }

  const unverified: ExplanationEntry[] = []
  const industryEvaluated = proposal.evidence.some((item) => item.signal === 'industry-overlap')
  if (industryEvaluated && (context.companyIndustryEvidenced !== true || context.opportunityIndustryEvidenced !== true)) {
    const sides: string[] = []
    if (context.companyIndustryEvidenced !== true) sides.push('the company publishes no evidenced industry')
    if (context.opportunityIndustryEvidenced !== true) sides.push('the opportunity publishes no industry')
    unverified.push({
      signal: 'industry-overlap',
      outcome: 'unverified',
      detail: `industry comparability cannot be evaluated yet: ${sides.join(' and ')}`,
      values: [],
    })
  }

  return {
    proposalId: proposal.proposalId,
    ruleVersion: proposal.ruleVersion,
    status: proposal.status,
    supporting,
    contradictory,
    missing,
    unverified,
    ruleNote: ruleNoteFor(proposal.status),
    eligibilityDisclaimer: ELIGIBILITY_DISCLAIMER,
    companyProvenance: context.companyProvenance ?? null,
    opportunityProvenance: context.opportunityProvenance ?? null,
  }
}
