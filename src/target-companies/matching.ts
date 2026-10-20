/**
 * Phase 2 additive company-specific relevance evaluation for uploaded target
 * companies.
 *
 * This module does not run discovery, call networks, import companies, or modify
 * existing matching engines. It evaluates a target-company profile against an
 * already retrieved funding or procurement record using explainable rules.
 *
 * Outcomes are deliberately non-numeric and inspectable. Missing evidence stays
 * missing; relevance is never treated as eligibility.
 */

export type TargetOpportunityType = 'funding' | 'procurement'

export type TargetRelevanceOutcome =
  | 'relevant'
  | 'potentially_relevant'
  | 'not_relevant'
  | 'insufficient_evidence'

export interface TargetCompanyMatchInput {
  readonly companyId: string
  readonly name: string
  readonly country?: string | null
  readonly sector?: string | null
  readonly capabilities?: readonly string[] | null
  readonly description?: string | null
  readonly companyType?: string | null
}

export interface TargetOpportunityInput {
  readonly opportunityId: string
  readonly opportunityType: TargetOpportunityType
  readonly title: string
  readonly description?: string | null
  readonly country?: string | null
  readonly sectors?: readonly string[] | null
  readonly requirements?: readonly string[] | null
  readonly applicantTypes?: readonly string[] | null
  readonly deadline?: string | null
  readonly status?: string | null
  readonly sourceUrl: string
}

export interface TargetRelevanceResult {
  readonly companyId: string
  readonly companyName: string
  readonly opportunityId: string
  readonly opportunityTitle: string
  readonly opportunityType: TargetOpportunityType
  readonly sourceUrl: string
  readonly outcome: TargetRelevanceOutcome
  readonly matchedFields: readonly string[]
  readonly mismatchedFields: readonly string[]
  readonly missingFields: readonly string[]
  readonly uncertainty: readonly string[]
  readonly reasons: readonly string[]
  readonly deadline: string | null
  readonly status: string | null
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is',
  'it', 'of', 'on', 'or', 'the', 'to', 'with', 'us', 'company', 'companies',
])

function normalize(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim().toLowerCase()
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean)
  return parts.length > 1 ? (parts[parts.length - 1] ?? trimmed) : trimmed
}

function tokens(value: string | null | undefined): string[] {
  if (!value) return []
  return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !STOPWORDS.has(token)))]
}

function companyTokens(company: TargetCompanyMatchInput): string[] {
  return [...new Set([
    ...tokens(company.sector),
    ...tokens(company.description),
    ...(company.capabilities ?? []).flatMap((value) => tokens(value)),
  ])]
}

function opportunityTokens(opportunity: TargetOpportunityInput): string[] {
  return [...new Set([
    ...tokens(opportunity.title),
    ...tokens(opportunity.description),
    ...(opportunity.sectors ?? []).flatMap((value) => tokens(value)),
    ...(opportunity.requirements ?? []).flatMap((value) => tokens(value)),
  ])]
}

export function evaluateTargetCompanyRelevance(
  company: TargetCompanyMatchInput,
  opportunity: TargetOpportunityInput,
): TargetRelevanceResult {
  const matchedFields: string[] = []
  const mismatchedFields: string[] = []
  const missingFields: string[] = []
  const uncertainty: string[] = []
  const reasons: string[] = []

  const companyCountry = normalize(company.country)
  const opportunityCountry = normalize(opportunity.country)
  if (companyCountry && opportunityCountry) {
    if (companyCountry === opportunityCountry) {
      matchedFields.push('country')
      reasons.push(`Country matches: ${company.country}.`)
    } else {
      mismatchedFields.push('country')
      reasons.push(`Country differs: company ${company.country}, opportunity ${opportunity.country}.`)
    }
  } else {
    missingFields.push(companyCountry ? 'opportunity.country' : 'company.country')
    uncertainty.push('Geographic eligibility cannot be confirmed because country information is missing.')
  }

  const cTokens = companyTokens(company)
  const oTokens = opportunityTokens(opportunity)
  const shared = cTokens.filter((token) => oTokens.includes(token))
  const genericTerms = new Set([
    'ai', 'product', 'products', 'software', 'technology', 'technologies',
    'infrastructure', 'service', 'services', 'solution', 'solutions',
    'platform', 'platforms', 'system', 'systems', 'data', 'cloud', 'digital',
  ])
  const specificShared = shared.filter((token) => !genericTerms.has(token))
  if (cTokens.length === 0 || oTokens.length === 0) {
    missingFields.push(cTokens.length === 0 ? 'company.sector/description/capabilities' : 'opportunity text')
    uncertainty.push('Sector/capability relevance cannot be confirmed because comparable text is missing.')
  } else if (shared.length > 0) {
    matchedFields.push('sector/capabilities')
    reasons.push(`Shared relevant terms: ${shared.join(', ')}.`)
  } else {
    mismatchedFields.push('sector/capabilities')
    reasons.push('No shared sector, capability, or scope terms between the company profile and the opportunity.')
  }

  if (opportunity.applicantTypes && opportunity.applicantTypes.length > 0) {
    const companyType = normalize(company.companyType)
    if (companyType) {
      const normalizedApplicantTypes = opportunity.applicantTypes.map(normalize)
      if (normalizedApplicantTypes.includes(companyType)) {
        matchedFields.push('applicantType')
        reasons.push(`Company type ${company.companyType} is among the stated applicant types.`)
      } else {
        mismatchedFields.push('applicantType')
        reasons.push(`Company type ${company.companyType} is not among the stated applicant types: ${opportunity.applicantTypes.join(', ')}.`)
      }
    } else {
      missingFields.push('company.companyType')
      uncertainty.push('Applicant-type eligibility cannot be confirmed because company type is missing.')
    }
  }

  if (opportunity.requirements && opportunity.requirements.length > 0) {
    const requirementText = opportunity.requirements.join(' ').toLowerCase()
    const unsupportedRequirements = opportunity.requirements.filter((requirement) => {
      const requirementTokens = tokens(requirement)
      return requirementTokens.length > 0 && !requirementTokens.some((token) => cTokens.includes(token))
    })
    if (unsupportedRequirements.length === opportunity.requirements.length && cTokens.length > 0) {
      uncertainty.push('Some stated requirements are not evidenced by the supplied company profile.')
    }
    if (requirementText.includes('eligible') || requirementText.includes('eligibility')) {
      uncertainty.push('Eligibility is stated by the source and is separate from relevance; it has not been verified for this company.')
    }
  }

  let outcome: TargetRelevanceOutcome
  if (
    mismatchedFields.includes('sector/capabilities') ||
    mismatchedFields.includes('country') ||
    mismatchedFields.includes('applicantType')
  ) {
    outcome = 'not_relevant'
  } else if (matchedFields.includes('sector/capabilities') && specificShared.length >= 1 && matchedFields.includes('country')) {
    outcome = 'relevant'
  } else if (matchedFields.length >= 1) {
    outcome = 'potentially_relevant'
  } else {
    outcome = 'insufficient_evidence'
  }

  if (outcome === 'relevant' && uncertainty.length > 0) {
    outcome = 'potentially_relevant'
  }

  return {
    companyId: company.companyId,
    companyName: company.name,
    opportunityId: opportunity.opportunityId,
    opportunityTitle: opportunity.title,
    opportunityType: opportunity.opportunityType,
    sourceUrl: opportunity.sourceUrl,
    outcome,
    matchedFields,
    mismatchedFields,
    missingFields,
    uncertainty,
    reasons,
    deadline: opportunity.deadline ?? null,
    status: opportunity.status ?? null,
  }
}