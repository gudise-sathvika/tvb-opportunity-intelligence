/**
 * Phase 2.18 additive query generation for company-aware discovery.
 *
 * Generates a small, bounded set of source-appropriate search terms from the
 * manager-supplied profile. It does not enrich profiles or invent capabilities.
 */

import type { TargetCompanyMatchInput } from './matching'

export interface CompanyDiscoveryQuery {
  readonly source: 'grantsgov' | 'ted'
  readonly term: string
  readonly basis: string
}

const MAX_QUERIES_PER_SOURCE = 3

function termsFromProfile(company: TargetCompanyMatchInput): string[] {
  const terms = new Set<string>()
  if (company.sector) {
    for (const part of company.sector.split(/[,;]+/)) {
      const trimmed = part.trim()
      if (trimmed.length >= 3) terms.add(trimmed)
    }
  }
  if (company.capabilities) {
    for (const capability of company.capabilities) {
      const trimmed = capability.trim()
      if (trimmed.length >= 3) terms.add(trimmed)
    }
  }
  return [...terms].slice(0, MAX_QUERIES_PER_SOURCE)
}

export function buildCompanyDiscoveryQueries(company: TargetCompanyMatchInput): CompanyDiscoveryQuery[] {
  const queries: CompanyDiscoveryQuery[] = []
  const profileTerms = termsFromProfile(company)

  if (profileTerms.length === 0) {
    queries.push({
      source: 'grantsgov',
      term: '',
      basis: 'No supplied sector or capability terms; broad source search only with explicit uncertainty.',
    })
    queries.push({
      source: 'ted',
      term: '',
      basis: 'No supplied sector or capability terms; broad source search only with explicit uncertainty.',
    })
    return queries
  }

  for (const term of profileTerms) {
    queries.push({ source: 'grantsgov', term, basis: `Supplied sector/capability: ${term}` })
    queries.push({ source: 'ted', term, basis: `Supplied sector/capability: ${term}` })
  }

  return queries.slice(0, MAX_QUERIES_PER_SOURCE * 2)
}