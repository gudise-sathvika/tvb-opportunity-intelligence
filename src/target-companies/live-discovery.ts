/**
 * Phase 2.23/2.42 minimal vertical slice: one imported profile, Grants.gov and
 * EU SEDIA, existing recommendation engine. This does not replace shared discovery.
 */

import { buildCompanyDiscoveryQueries } from './discovery-queries'
import { csvPreviewToTargetCompanies } from './profiles'
import { loadImportedTargetCompanies } from './store'
import { loadKnownDiscoveryIds, saveKnownDiscoveryIds } from './discovery-history'
import { recommendOpportunitiesForTargetCompanies } from './recommendations'
import type { TargetCompanyMatchInput, TargetOpportunityInput, TargetRelevanceResult } from './matching'
import { parseGrantsGovBody } from '../automation/grantsgov-adapter'
import { parseEuSediaBody } from '../automation/eu-sedia-adapter'
import { buildPipelineResult } from '../automation/pipeline'
import { createReviewQueue } from '../automation/review-queue'
import { reviewFixtureStore } from '../automation/review-fixture'
import type { AdapterResult } from '../automation/types'
import { parseTedSearchBody } from '../automation/ted-adapter'
import type { GrantsGovBridgeSearchResponse } from '../live-source/grantsgov-bridge/contract'
import type { EuSediaBridgeSearchResponse } from '../live-source/eu-sedia-bridge/contract'
import type { TedBridgeSearchResponse } from '../live-source/ted-bridge/contract'

function extractResponseErrors(response: unknown, fallback: string): string[] {
  const res = response as { errors?: Array<{ message?: string }>; error?: { message?: string } } | null | undefined
  if (Array.isArray(res?.errors) && res.errors.length > 0) {
    return res.errors.map((e) => e?.message ?? fallback)
  }
  if (res?.error?.message) {
    return [res.error.message]
  }
  return [fallback]
}

export interface TargetCompanyLiveDiscoveryRecord {
  readonly source: 'grantsgov' | 'eu-sedia' | 'ted'
  readonly linkValidation?: 'source-provided' | 'constructed-unverified' | 'confirmed-unavailable' | null
  readonly sourceRecordId: string | null
  readonly title: string
  readonly sourceUrl: string
  readonly description: string | null
  readonly deadline: string | null
  readonly status: string | null
}

export interface TargetCompanyLiveDiscoverySourceResult {
  readonly source: 'grantsgov' | 'eu-sedia' | 'ted'
  readonly queries: readonly string[]
  readonly recordCount: number
  readonly errors: readonly string[]
}

export interface TargetCompanyLiveDiscoveryResult {
  readonly profile: TargetCompanyMatchInput
  readonly queries: readonly string[]
  readonly records: readonly TargetCompanyLiveDiscoveryRecord[]
  readonly recommendations: readonly TargetRelevanceResult[]
  readonly errors: readonly string[]
  readonly sourceResults: readonly TargetCompanyLiveDiscoverySourceResult[]
  readonly newRecordCount: number
}

export function grantsGovRawToOpportunity(record: TargetCompanyLiveDiscoveryRecord): TargetOpportunityInput {
  return {
    opportunityId: record.sourceRecordId ?? record.sourceUrl,
    opportunityType: 'funding',
    title: record.title,
    description: record.description,
    country: 'US',
    sectors: null,
    requirements: null,
    applicantTypes: null,
    deadline: record.deadline,
    status: record.status,
    sourceUrl: record.sourceUrl,
  }
}

export function euSediaRawToOpportunity(record: TargetCompanyLiveDiscoveryRecord): TargetOpportunityInput {
  return {
    opportunityId: record.sourceRecordId ?? record.sourceUrl,
    opportunityType: 'funding',
    title: record.title,
    description: record.description,
    country: null,
    sectors: null,
    requirements: null,
    applicantTypes: null,
    deadline: record.deadline,
    status: record.status,
    sourceUrl: record.sourceUrl,
  }
}

export async function runTargetCompanyGrantsGovDiscovery(
  profile: TargetCompanyMatchInput,
  requester: (term: string) => Promise<GrantsGovBridgeSearchResponse>,
): Promise<TargetCompanyLiveDiscoveryResult> {
  const queries = buildCompanyDiscoveryQueries(profile)
  const uniqueTerms = [...new Set(queries.map((query) => query.term))]
  const recordsById = new Map<string, TargetCompanyLiveDiscoveryRecord>()
  const errors: string[] = []

  for (const term of uniqueTerms) {
    let response: GrantsGovBridgeSearchResponse
    try {
      response = await requester(term)
    } catch (error) {
      errors.push(`Grants.gov request failed: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (!response.ok || (typeof response.status === 'number' && response.status >= 400)) {
      errors.push(...extractResponseErrors(response, `Grants.gov bridge request failed (status ${response.status})`))
      continue
    }
    if (!response.body || (typeof response.body === 'string' && response.body.trim().startsWith('<'))) {
      errors.push(`Grants.gov source returned an HTML response instead of JSON (status ${response.status})`)
      continue
    }
    const parsed = parseGrantsGovBody(response.body, {
      sourceId: 'SU-GRANTS-001',
      observedAt: new Date().toISOString(),
      queryTerm: term || null,
    })
    for (const error of parsed.errors) errors.push(error.message)

    const observedAt = new Date().toISOString()
    const adapterResult: AdapterResult = {
      status: 'SUCCESS',
      sourceId: 'SU-GRANTS-001',
      adapterType: 'grantsgov',
      runId: 'target-company-run',
      domain: 'funding',
      accessState: 'AVAILABLE',
      requestedAt: observedAt,
      observedAt,
      blockedReason: null,
      results: parsed.results,
      errors: parsed.errors,
      warnings: parsed.warnings,
      provenance: {
        runId: 'target-company-run',
        companyId: profile.companyId,
        discoveryProfileId: profile.companyId,
        sourceId: 'SU-GRANTS-001',
        sourceName: 'Grants.gov',
        sourceUrl: null,
        adapterType: 'grantsgov',
        domain: 'funding',
        accessState: 'AVAILABLE',
        requestedAt: observedAt,
        observedAt,
      },
    }
    const pipeline = buildPipelineResult(adapterResult)
    const reviewItems = createReviewQueue(pipeline.candidates, { createdAt: observedAt })
    reviewFixtureStore.addReviewItems(reviewItems)

    for (const result of parsed.results) {
      const id = `grantsgov:${result.sourceRecordId ?? result.sourceUrl}`
      if (!recordsById.has(id)) {
        recordsById.set(id, {
          source: 'grantsgov',
          sourceRecordId: result.sourceRecordId,
          title: result.title,
          sourceUrl: result.sourceUrl,
          description: result.description,
          deadline: result.deadline,
          status: result.sourceStatus ?? null,
        })
      }
    }
  }

  const records = [...recordsById.values()]
  const known = loadKnownDiscoveryIds()
  const newRecordCount = records.filter((record) => !known.has(record.sourceRecordId ?? record.sourceUrl)).length
  saveKnownDiscoveryIds(records.map((record) => record.sourceRecordId ?? record.sourceUrl))
  const opportunities = records.map(grantsGovRawToOpportunity)
  const recommendations = recommendOpportunitiesForTargetCompanies([profile], opportunities)

  return {
    profile,
    queries: uniqueTerms,
    records,
    recommendations,
    errors,
    sourceResults: [{ source: 'grantsgov', queries: uniqueTerms, recordCount: records.length, errors }],
    newRecordCount,
  }
}

export async function runTargetCompanyEuSediaDiscovery(
  profile: TargetCompanyMatchInput,
  requester: (term: string) => Promise<EuSediaBridgeSearchResponse>,
): Promise<TargetCompanyLiveDiscoveryResult> {
  const queries = buildCompanyDiscoveryQueries(profile)
  const uniqueTerms = [...new Set(queries.map((query) => query.term))]
  const recordsById = new Map<string, TargetCompanyLiveDiscoveryRecord>()
  const errors: string[] = []

  for (const term of uniqueTerms) {
    let response: EuSediaBridgeSearchResponse
    try {
      response = await requester(term)
    } catch (error) {
      errors.push(`EU Funding & Tenders request failed: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (!response.ok || (typeof response.status === 'number' && response.status >= 400)) {
      errors.push(...extractResponseErrors(response, `EU Funding & Tenders bridge request failed (status ${response.status})`))
      continue
    }
    if (!response.body || (typeof response.body === 'string' && response.body.trim().startsWith('<'))) {
      errors.push(`EU Funding & Tenders source returned an HTML response instead of JSON (status ${response.status})`)
      continue
    }
    const parsed = parseEuSediaBody(response.body, {
      sourceId: 'SU-EU-001',
      observedAt: new Date().toISOString(),
      queryTerm: term || null,
    })
    for (const error of parsed.errors) errors.push(error.message)
    for (const result of parsed.results) {
      const id = `eu-sedia:${result.sourceRecordId ?? result.sourceUrl}`
      if (!recordsById.has(id)) {
        recordsById.set(id, {
          source: 'eu-sedia',
          sourceRecordId: result.sourceRecordId,
          title: result.title,
          sourceUrl: result.sourceUrl,
          description: result.description,
          deadline: result.deadline,
          status: result.sourceStatus ?? null,
          linkValidation: result.linkValidation ?? null,
        })
      }
    }
  }

  const records = [...recordsById.values()]
  const known = loadKnownDiscoveryIds()
  const newRecordCount = records.filter((record) => !known.has(record.sourceRecordId ?? record.sourceUrl)).length
  saveKnownDiscoveryIds(records.map((record) => record.sourceRecordId ?? record.sourceUrl))
  const opportunities = records.map(euSediaRawToOpportunity)
  const recommendations = recommendOpportunitiesForTargetCompanies([profile], opportunities)

  return {
    profile,
    queries: uniqueTerms,
    records,
    recommendations,
    errors,
    sourceResults: [{ source: 'eu-sedia', queries: uniqueTerms, recordCount: records.length, errors }],
    newRecordCount,
  }
}

export async function runTargetCompanyDiscovery(
  profile: TargetCompanyMatchInput,
  grantsRequester: (term: string) => Promise<GrantsGovBridgeSearchResponse>,
  euRequester: (term: string) => Promise<EuSediaBridgeSearchResponse>,
): Promise<TargetCompanyLiveDiscoveryResult> {
  const grants = await runTargetCompanyGrantsGovDiscovery(profile, grantsRequester)
  const eu = await runTargetCompanyEuSediaDiscovery(profile, euRequester)

  const recordsById = new Map<string, TargetCompanyLiveDiscoveryRecord>()
  for (const record of [...grants.records, ...eu.records]) {
    const id = `${record.source}:${record.sourceRecordId ?? record.sourceUrl}`
    if (!recordsById.has(id)) recordsById.set(id, record)
  }
  const records = [...recordsById.values()]
  saveKnownDiscoveryIds(records.map((record) => record.sourceRecordId ?? record.sourceUrl))
  const opportunities = records.map((record) =>
    record.source === 'grantsgov' ? grantsGovRawToOpportunity(record) : euSediaRawToOpportunity(record),
  )
  const recommendations = recommendOpportunitiesForTargetCompanies([profile], opportunities)

  return {
    profile,
    queries: [...new Set([...grants.queries, ...eu.queries])],
    records,
    recommendations,
    errors: [...grants.errors, ...eu.errors],
    sourceResults: [...grants.sourceResults, ...eu.sourceResults],
    newRecordCount: grants.newRecordCount + eu.newRecordCount,
  }
}

export async function runTargetCompanyTedDiscovery(
  profile: TargetCompanyMatchInput,
  requester: (term: string) => Promise<TedBridgeSearchResponse>,
): Promise<TargetCompanyLiveDiscoveryResult> {
  const queries = buildCompanyDiscoveryQueries(profile)
  const uniqueTerms = [...new Set(queries.map((query) => query.term))]
  const recordsById = new Map<string, TargetCompanyLiveDiscoveryRecord>()
  const errors: string[] = []

  for (const term of uniqueTerms) {
    if (term === '') continue
    const response = await requester(term)
    if (!response.ok || (typeof response.status === 'number' && response.status >= 400)) {
      errors.push(...extractResponseErrors(response, `TED bridge request failed (status ${response.status})`))
      continue
    }
    if (!response.body || (typeof response.body === 'string' && response.body.trim().startsWith('<'))) {
      errors.push(`TED source returned an HTML response instead of JSON (status ${response.status})`)
      continue
    }
    const parsed = parseTedSearchBody(response.body, {
      sourceId: 'SU-TED-001',
      observedAt: new Date().toISOString(),
      queryTerm: term || null,
    })
    for (const error of parsed.errors) errors.push(error.message)
    for (const result of parsed.results) {
      const id = `ted:${result.sourceRecordId ?? result.sourceUrl}`
      if (!recordsById.has(id)) {
        recordsById.set(id, {
          source: 'ted',
          sourceRecordId: result.sourceRecordId,
          title: result.title,
          sourceUrl: result.sourceUrl,
          description: result.description,
          deadline: result.deadline,
          status: result.sourceStatus ?? null,
        })
      }
    }
  }

  const records = [...recordsById.values()]
  const opportunities = records.map((record) => ({
    opportunityId: record.sourceRecordId ?? record.sourceUrl,
    opportunityType: 'procurement' as const,
    title: record.title,
    description: record.description,
    country: null,
    sectors: null,
    requirements: null,
    applicantTypes: null,
    deadline: record.deadline,
    status: record.status,
    sourceUrl: record.sourceUrl,
  }))
  const recommendations = recommendOpportunitiesForTargetCompanies([profile], opportunities)

  return {
    profile,
    queries: uniqueTerms,
    records,
    recommendations,
    errors,
    sourceResults: [{ source: 'ted', queries: uniqueTerms, recordCount: records.length, errors }],
    newRecordCount: records.length,
  }
}

export interface OpportunityAssessmentGroup {
  readonly key: string
  readonly opportunityId: string
  readonly opportunityTitle: string
  readonly source: string
  readonly opportunityType: TargetOpportunityInput['opportunityType']
  readonly assessments: readonly TargetRelevanceResult[]
}

export function groupTargetRecommendations(recommendations: readonly TargetRelevanceResult[]): OpportunityAssessmentGroup[] {
  const map = new Map<string, OpportunityAssessmentGroup & { assessments: TargetRelevanceResult[] }>()
  let ungroupedIndex = 0
  for (const recommendation of recommendations) {
    let sourceHost: string | null = null
    try {
      const url = new URL(recommendation.sourceUrl)
      if (url.protocol === 'https:' || url.protocol === 'http:') sourceHost = url.hostname.toLowerCase()
    } catch {}
    const opportunityId = recommendation.opportunityId.trim()
    const canonicalKey =
      sourceHost !== null && opportunityId !== ''
        ? JSON.stringify([sourceHost, opportunityId])
        : null
    const key = canonicalKey ?? `unidentified:${ungroupedIndex++}`
    const existing = map.get(key)
    if (existing === undefined) {
      map.set(key, {
        key,
        opportunityId: recommendation.opportunityId,
        opportunityTitle: recommendation.opportunityTitle,
        source: sourceHost ?? 'Unknown source',
        opportunityType: recommendation.opportunityType,
        assessments: [recommendation],
      })
    } else {
      const companyId = recommendation.companyId.trim()
      const companyName = recommendation.companyName.trim()
      const alreadyAssessed =
        companyId !== ''
          ? existing.assessments.some((assessment) => assessment.companyId.trim() === companyId)
          : companyName !== '' &&
            existing.assessments.some((assessment) => assessment.companyId.trim() === '' && assessment.companyName.trim() === companyName)
      if (!alreadyAssessed) existing.assessments.push(recommendation)
    }
  }
  return [...map.values()]
}

export function firstImportedTargetCompany(): TargetCompanyMatchInput | null {
  const preview = loadImportedTargetCompanies()
  if (!preview) return null
  const companies = csvPreviewToTargetCompanies(preview)
  return companies.length > 0 ? companies[0] : null
}