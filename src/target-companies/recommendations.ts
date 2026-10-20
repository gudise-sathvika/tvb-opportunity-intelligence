/**
 * Phase 2.1 additive recommendation runner for uploaded target companies.
 * It evaluates each target company against each supplied opportunity independently.
 */

import type { TargetCompanyMatchInput, TargetOpportunityInput, TargetRelevanceResult } from './matching'
import { evaluateTargetCompanyRelevance } from './matching'

export function recommendOpportunitiesForTargetCompanies(
  companies: readonly TargetCompanyMatchInput[],
  opportunities: readonly TargetOpportunityInput[],
): TargetRelevanceResult[] {
  const results: TargetRelevanceResult[] = []
  for (const company of companies) {
    for (const opportunity of opportunities) {
      results.push(evaluateTargetCompanyRelevance(company, opportunity))
    }
  }
  return results
}