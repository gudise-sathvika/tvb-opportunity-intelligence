import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GRANTS_GOV_BRIDGE_SEARCH_PATH } from '../../live-source/grantsgov-bridge/contract'
import type { GrantsGovBridgeSearchResponse } from '../../live-source/grantsgov-bridge/contract'
import { EU_SEDIA_BRIDGE_SEARCH_PATH } from '../../live-source/eu-sedia-bridge/contract'
import type { EuSediaBridgeSearchResponse } from '../../live-source/eu-sedia-bridge/contract'
import { TED_BRIDGE_SEARCH_PATH } from '../../live-source/ted-bridge/contract'
import type { TedBridgeSearchResponse } from '../../live-source/ted-bridge/contract'
import { loadImportedTargetCompanies } from '../../target-companies/store'
import { csvPreviewToTargetCompanies } from '../../target-companies/profiles'
import { buildCompanyDiscoveryQueries } from '../../target-companies/discovery-queries'
import {
  groupTargetRecommendations,
  runTargetCompanyDiscovery,
  runTargetCompanyTedDiscovery,
} from '../../target-companies/live-discovery'
import type { TargetCompanyLiveDiscoveryResult } from '../../target-companies/live-discovery'
import { loadPersistedRuns, persistRunOutcome } from '../../live-source/persisted-runs'
import type { DiscoveryCompanyResult, DiscoveryRunOutcome } from '../../automation/discovery-fixture'
import { createReviewQueue } from '../../automation/review-queue'
import { reviewFixtureStore } from '../../automation/review-fixture'
import type { DiscoveryCandidate } from '../../automation/candidate'
import type { DiscoveryDomain } from '../../automation/types'
import { saveSuppliedReviewState } from '../../live-source/review-persistence'
import { downloadLeadsCsv } from '../../target-companies/export-leads-csv'
import MatchMatrix from './MatchMatrix'
import LeadsDownloadMenu from './LeadsDownloadMenu'

const TARGET_RESULTS_KEY = 'tvb.target-company-results.v1'

function loadCachedResults(): TargetCompanyLiveDiscoveryResult[] {
  try {
    if (typeof sessionStorage === 'undefined') return []
    const raw = sessionStorage.getItem(TARGET_RESULTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as TargetCompanyLiveDiscoveryResult[]) : []
  } catch {
    return []
  }
}

function saveCachedResults(results: TargetCompanyLiveDiscoveryResult[]): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(TARGET_RESULTS_KEY, JSON.stringify(results))
    }
  } catch {
    // Ignore storage failures
  }
}

function syncRecommendationsToReviewQueue(
  resultsList: readonly TargetCompanyLiveDiscoveryResult[],
  runId: string,
  runTime: string,
): DiscoveryCandidate[] {
  const candidatesNeedingReview: DiscoveryCandidate[] = []

  for (const result of resultsList) {
    const compId = result.profile.name || result.profile.companyId
    for (const rec of result.recommendations ?? []) {
      if (rec.outcome === 'not_relevant') continue

      const domain: DiscoveryDomain = rec.opportunityType === 'procurement' ? 'procurement' : 'funding'
      let sourceHost = 'unknown'
      try {
        sourceHost = new URL(rec.sourceUrl).hostname.toLowerCase()
      } catch {}

      const sourceId = sourceHost.includes('grants.gov')
        ? 'SU-GRANTS-001'
        : sourceHost.includes('ted.europa.eu')
          ? 'SU-TED-001'
          : sourceHost.includes('europa.eu')
            ? 'SU-EU-SEDIA-001'
            : 'SU-LIVE-001'
      const sourceName = sourceHost.includes('grants.gov')
        ? 'Grants.gov'
        : sourceHost.includes('ted.europa.eu')
          ? 'TED Procurement'
          : sourceHost.includes('europa.eu')
            ? 'EU SEDIA'
            : sourceHost

      const rawType = rec.opportunityType === 'procurement' ? 'RFP' : 'GRANT'
      const candidateId = `${sourceId}:${rec.opportunityId}:${compId}`

      candidatesNeedingReview.push({
        candidateId,
        discoveryRunId: runId,
        companyId: compId,
        discoveryProfileId: result.profile.companyId,
        sourceId,
        sourceRecordId: rec.opportunityId,
        sourceUrl: rec.sourceUrl,
        sourceTitle: rec.opportunityTitle,
        sourceSummary: Array.isArray(rec.reasons) ? rec.reasons.join(' ') : null,
        sourcePublicationDate: null,
        sourceDeadline: rec.deadline ?? null,
        sourceOrganization: null,
        sourceCountry: null,
        sourceRawType: rawType,
        sourceStatus: rec.status ?? null,
        domain,
        candidateType: 'opportunity',
        candidateStatus: 'REVIEW',
        provenance: {
          runId,
          companyId: compId,
          discoveryProfileId: result.profile.companyId,
          sourceId,
          sourceName,
          sourceUrl: rec.sourceUrl,
          sourceRecordId: rec.opportunityId,
          adapterType: sourceId === 'SU-TED-001' ? 'ted' : sourceId === 'SU-EU-SEDIA-001' ? 'eu-sedia' : 'grantsgov',
          domain,
          accessState: 'AVAILABLE',
          queryTerm: null,
          requestedAt: runTime,
          observedAt: runTime,
          stageHistory: ['transform', 'normalize', 'classify'],
        },
        normalization: {
          ruleVersion: '2026-10-01',
          status: 'NORMALIZED',
          changedFields: [],
          warnings: [],
          title: { original: rec.opportunityTitle, normalized: rec.opportunityTitle },
          sourceUrl: { original: rec.sourceUrl, normalized: rec.sourceUrl },
          canonicalUrl: rec.sourceUrl,
          summary: {
            original: Array.isArray(rec.reasons) ? rec.reasons.join(' ') : null,
            normalized: Array.isArray(rec.reasons) ? rec.reasons.join(' ') : null,
          },
          publicationDate: { original: null, normalized: null },
          deadline: { original: rec.deadline ?? null, normalized: rec.deadline ?? null },
          organization: { original: null, normalized: null },
          country: { original: null, normalized: null },
          rawType: { original: rawType, normalized: rawType },
          sourceStatus: { original: rec.status ?? null, normalized: rec.status ?? null },
        },
        classification: {
          state: 'CLASSIFIED',
          type: rawType,
          certainty: 'HIGH',
          evidence: {
            domain,
            sourceEvidence: { sourceId, adapterType: null, sourceRawType: rawType },
            titleHints: [],
            matchedRule: 'target-company-match',
            ruleVersion: '2026-10-01',
          },
        },
        duplicate: {
          verdict: 'DISTINCT',
          evidence: {
            ruleVersion: '2026-10-01',
            matchedOn: 'source identity',
            tier: 1,
            otherCandidateId: null,
            titleKey: rec.opportunityTitle,
            corroboratingSignals: [],
          },
        },
      })
    }
  }

  if (candidatesNeedingReview.length > 0) {
    const queue = createReviewQueue(candidatesNeedingReview, { createdAt: runTime })
    reviewFixtureStore.addReviewItems(queue)
    saveSuppliedReviewState()
  }

  return candidatesNeedingReview
}

export default function TargetCompanyLiveDiscovery() {
  const imported = loadImportedTargetCompanies()
  const profiles = imported ? csvPreviewToTargetCompanies(imported) : []
  const [results, setResults] = useState<TargetCompanyLiveDiscoveryResult[]>(() => loadCachedResults())

  useEffect(() => {
    if (results.length > 0) {
      const now = new Date().toISOString()
      syncRecommendationsToReviewQueue(results, 'RUN-LIVE-RESTORED', now)
    }
  }, [results])

  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [discoveryScope, setDiscoveryScope] = useState<'grants' | 'rfps' | 'all'>('grants')
  const [viewMode, setViewMode] = useState<'cards' | 'matrix'>('cards')
  const [search, setSearch] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [typeFilter, setTypeFilter] = useState<'all' | 'funding' | 'procurement'>('all')
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all')
  const [companyFilter, setCompanyFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'fit' | 'title' | 'deadline'>('fit')
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(0)

  const opportunityGroups = useMemo(
    () => groupTargetRecommendations(results.flatMap((result) => result.recommendations)),
    [results],
  )

  const assessments = useMemo(
    () => opportunityGroups.flatMap((group) => group.assessments),
    [opportunityGroups],
  )

  const leads = useMemo(
    () => assessments.filter((item) => item.outcome === 'relevant' || item.outcome === 'potentially_relevant').length,
    [assessments],
  )

  const needsReviewCount = useMemo(
    () => assessments.filter((item) => item.outcome !== 'not_relevant').length,
    [assessments],
  )

  const closingSoonCount = useMemo(() => {
    const now = Date.now()
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
    return opportunityGroups.filter((group) => {
      const deadline = group.assessments[0]?.deadline
      if (!deadline) return false
      const dt = new Date(deadline)
      if (isNaN(dt.getTime())) return false
      const diff = dt.getTime() - now
      return diff > 0 && diff <= thirtyDaysMs
    }).length
  }, [opportunityGroups])

  const sourceErrors = useMemo(
    () =>
      results.flatMap((result) =>
        (result.sourceResults ?? []).flatMap((source) =>
          (source.errors ?? []).map((message) => ({
            source: source.source,
            message,
          })),
        ),
      ),
    [results],
  )

  const availableCompanies = useMemo(() => {
    const names = new Set<string>()
    assessments.forEach((a) => names.add(a.companyName))
    return Array.from(names).sort()
  }, [assessments])

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase()
    return opportunityGroups
      .filter((group) => {
        if (typeFilter !== 'all' && group.opportunityType !== typeFilter) return false
        if (outcomeFilter !== 'all' && !group.assessments.some((a) => a.outcome === outcomeFilter)) return false
        if (companyFilter !== 'all' && !group.assessments.some((a) => a.companyName === companyFilter)) return false
        if (!query) return true
        return (
          group.opportunityTitle.toLowerCase().includes(query) ||
          group.source.toLowerCase().includes(query) ||
          group.assessments.some(
            (assessment) =>
              assessment.companyName.toLowerCase().includes(query) ||
              assessment.reasons.some((r) => r.toLowerCase().includes(query)),
          )
        )
      })
      .sort((a, b) => {
        if (sortBy === 'title') {
          return a.opportunityTitle.localeCompare(b.opportunityTitle)
        }
        if (sortBy === 'deadline') {
          const dateA = a.assessments?.[0]?.deadline ? new Date(a.assessments[0].deadline).getTime() : 0
          const dateB = b.assessments?.[0]?.deadline ? new Date(b.assessments[0].deadline).getTime() : 0
          return dateA - dateB
        }
        // sort by max score
        const maxA = Math.max(...(a.assessments ?? []).map((item) => (typeof item?.score === 'number' ? item.score : 0)), 0)
        const maxB = Math.max(...(b.assessments ?? []).map((item) => (typeof item?.score === 'number' ? item.score : 0)), 0)
        return maxB - maxA
      })
  }, [opportunityGroups, search, typeFilter, outcomeFilter, companyFilter, sortBy])

  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const paginatedGroups = useMemo(() => {
    const start = safePage * pageSize
    return filteredGroups.slice(start, start + pageSize)
  }, [filteredGroups, safePage, pageSize])

  const run = async () => {
    if (running || profiles.length === 0) return
    setRunning(true)
    setRunError(null)
    try {
      const runTime = new Date().toISOString()
      const existingRuns = loadPersistedRuns()
      let counter = existingRuns.length + 1
      let currentRunId = `RUN-LIVE-${String(counter).padStart(4, '0')}`
      while (existingRuns.some((r) => r.runId === currentRunId)) {
        counter++
        currentRunId = `RUN-LIVE-${String(counter).padStart(4, '0')}`
      }

      // Deduplicate query terms across all profiles so identical searches are only executed once
      const uniqueGrantsTerms = new Set<string>()
      const uniqueEuTerms = new Set<string>()
      const uniqueTedTerms = new Set<string>()

      for (const profile of profiles) {
        const queries = buildCompanyDiscoveryQueries(profile)
        const terms = [...new Set(queries.map((q) => q.term))]
        for (const term of terms) {
          const trimmed = term.trim()
          if (discoveryScope === 'rfps' || discoveryScope === 'all') {
            if (trimmed !== '') uniqueTedTerms.add(trimmed)
          }
          if (discoveryScope === 'grants' || discoveryScope === 'all') {
            uniqueGrantsTerms.add(trimmed)
            uniqueEuTerms.add(trimmed)
          }
        }
      }

      const grantsCache = new Map<string, Promise<GrantsGovBridgeSearchResponse>>()
      const euCache = new Map<string, Promise<EuSediaBridgeSearchResponse>>()
      const tedCache = new Map<string, Promise<TedBridgeSearchResponse>>()

      const grantsRequester = (term: string): Promise<GrantsGovBridgeSearchResponse> => {
        const key = term.trim().toLowerCase()
        const cached = grantsCache.get(key)
        if (cached) return cached
        const promise: Promise<GrantsGovBridgeSearchResponse> = (async (): Promise<GrantsGovBridgeSearchResponse> => {
          try {
            const response = await fetch(GRANTS_GOV_BRIDGE_SEARCH_PATH, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                runId: currentRunId,
                companyId: 'target-discovery',
                keyword: term.trim(),
                oppStatuses: 'posted',
                limit: 100,
                requestedAt: new Date().toISOString(),
              }),
            })
            const data = (await response.json()) as GrantsGovBridgeSearchResponse & { error?: { code?: string; message?: string } }
            if (!data.ok) {
              const errs = Array.isArray(data.errors)
                ? data.errors
                : data.error
                  ? [{ code: data.error.code ?? 'bridge_error', message: data.error.message ?? 'Grants.gov bridge request failed' }]
                  : [{ code: 'http_error', message: `HTTP ${response.status} from Grants.gov bridge` }]
              return { ok: false as const, status: data.status ?? response.status, body: null, errors: errs }
            }
            return data
          } catch (error) {
            return {
              ok: false as const,
              status: 500,
              body: null,
              errors: [{ code: 'network_error', message: error instanceof Error ? error.message : String(error) }],
            }
          }
        })()
        grantsCache.set(key, promise)
        return promise
      }

      const euRequester = (term: string): Promise<EuSediaBridgeSearchResponse> => {
        const key = term.trim().toLowerCase()
        const cached = euCache.get(key)
        if (cached) return cached
        const promise: Promise<EuSediaBridgeSearchResponse> = (async (): Promise<EuSediaBridgeSearchResponse> => {
          try {
            const response = await fetch(EU_SEDIA_BRIDGE_SEARCH_PATH, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                runId: currentRunId,
                companyId: 'target-discovery',
                keyword: term.trim(),
                limit: 100,
                requestedAt: new Date().toISOString(),
              }),
            })
            const data = (await response.json()) as EuSediaBridgeSearchResponse & { error?: { code?: string; message?: string } }
            if (!data.ok) {
              const errs = Array.isArray(data.errors)
                ? data.errors
                : data.error
                  ? [{ code: data.error.code ?? 'bridge_error', message: data.error.message ?? 'EU SEDIA bridge request failed' }]
                  : [{ code: 'http_error', message: `HTTP ${response.status} from EU SEDIA bridge` }]
              return { ok: false as const, status: data.status ?? response.status, body: null, errors: errs }
            }
            return data
          } catch (error) {
            return {
              ok: false as const,
              status: 500,
              body: null,
              errors: [{ code: 'network_error', message: error instanceof Error ? error.message : String(error) }],
            }
          }
        })()
        euCache.set(key, promise)
        return promise
      }

      const tedRequester = (term: string): Promise<TedBridgeSearchResponse> => {
        const key = term.trim().toLowerCase()
        const cached = tedCache.get(key)
        if (cached) return cached
        const promise: Promise<TedBridgeSearchResponse> = (async (): Promise<TedBridgeSearchResponse> => {
          try {
            const publishedSince = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
              .toISOString()
              .slice(0, 10)
              .replace(/-/g, '')
            const response = await fetch(TED_BRIDGE_SEARCH_PATH, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                runId: currentRunId,
                companyId: 'target-discovery',
                keyword: term.trim(),
                publishedSince,
                limit: 100,
                requestedAt: new Date().toISOString(),
              }),
            })
            const rawText = await response.text()
            let data: (TedBridgeSearchResponse & { error?: { code?: string; message?: string } }) | null = null
            try {
              data = JSON.parse(rawText)
            } catch {
              return {
                ok: false as const,
                status: response.status || 502,
                body: null,
                errors: [{ code: 'invalid_response', message: `TED bridge returned HTTP ${response.status} with non-JSON response` }],
              }
            }
            if (!data || !data.ok || (typeof data.status === 'number' && data.status >= 400)) {
              const resObj = data as { errors?: readonly { code?: string; message?: string }[]; error?: { code?: string; message?: string } } | null
              const errs = Array.isArray(resObj?.errors) && resObj.errors.length > 0
                ? resObj.errors.map((e) => ({ code: e.code ?? 'bridge_error', message: e.message ?? 'TED bridge request failed' }))
                : resObj?.error
                  ? [{ code: resObj.error.code ?? 'bridge_error', message: resObj.error.message ?? 'TED bridge request failed' }]
                  : [{ code: 'http_error', message: `HTTP ${data?.status ?? response.status} from TED bridge` }]
              return { ok: false as const, status: data?.status ?? response.status, body: null, errors: errs }
            }
            if (typeof data.body === 'string' && data.body.trim().startsWith('<')) {
              return {
                ok: false as const,
                status: data.status || 502,
                body: null,
                errors: [{ code: 'invalid_response', message: 'TED source returned HTML error page instead of JSON' }],
              }
            }
            return data
          } catch (error) {
            return {
              ok: false as const,
              status: 500,
              body: null,
              errors: [{ code: 'network_error', message: error instanceof Error ? error.message : String(error) }],
            }
          }
        })()
        tedCache.set(key, promise)
        return promise
      }

      // Pre-warm unique searches:
      // 1. Grants.gov queries run in parallel (US Federal Grants API comfortably handles concurrency)
      await Promise.all(Array.from(uniqueGrantsTerms).map((term) => grantsRequester(term)))

      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

      // 2. TED Procurement queries run sequentially with backoff to avoid triggering the EU TED 429 rate limit
      for (const term of uniqueTedTerms) {
        await tedRequester(term)
        await delay(350)
      }

      // 3. EU SEDIA queries run sequentially to avoid gateway socket timeouts on ec.europa.eu
      for (const term of uniqueEuTerms) {
        await euRequester(term)
        await delay(350)
      }

      const nextResults: TargetCompanyLiveDiscoveryResult[] = []
      for (const profile of profiles) {
        if (discoveryScope === 'rfps') {
          nextResults.push(await runTargetCompanyTedDiscovery(profile, tedRequester))
        } else if (discoveryScope === 'all') {
          const grantsResult = await runTargetCompanyDiscovery(profile, grantsRequester, euRequester)
          const tedResult = await runTargetCompanyTedDiscovery(profile, tedRequester)
          nextResults.push({
            profile,
            queries: [...new Set([...(grantsResult.queries ?? []), ...(tedResult.queries ?? [])])],
            records: [...(grantsResult.records ?? []), ...(tedResult.records ?? [])],
            recommendations: [...(grantsResult.recommendations ?? []), ...(tedResult.recommendations ?? [])],
            errors: [...(grantsResult.errors ?? []), ...(tedResult.errors ?? [])],
            sourceResults: [...(grantsResult.sourceResults ?? []), ...(tedResult.sourceResults ?? [])],
            newRecordCount: (grantsResult.newRecordCount ?? 0) + (tedResult.newRecordCount ?? 0),
          })
        } else {
          // 'grants' (default)
          nextResults.push(await runTargetCompanyDiscovery(profile, grantsRequester, euRequester))
        }
      }
      setResults(nextResults)
      saveCachedResults(nextResults)

      // Persist run outcome to session history and logs
      const allRecords = nextResults.flatMap((r) => r.records ?? [])
      const allSourceResults = nextResults.flatMap((r) => r.sourceResults ?? [])
      const allRecommendations = nextResults.flatMap((r) => r.recommendations ?? [])
      const hasErrors = nextResults.some(
        (r) => (r.errors?.length ?? 0) > 0 || (r.sourceResults ?? []).some((s) => (s.errors?.length ?? 0) > 0),
      )

      // Build DiscoveryCandidates and ReviewItems for human review
      const candidatesNeedingReview = syncRecommendationsToReviewQueue(nextResults, currentRunId, runTime)

      const companyResults: DiscoveryCompanyResult[] = nextResults.map((r) => {
        const compRecs = (r.records ?? []).length
        const compErrors = (r.errors ?? []).length
        const compNeedsReview = (r.recommendations ?? []).filter((rec) => rec.outcome !== 'not_relevant').length
        const compName = r.profile.name || r.profile.companyId
        const srcResults = r.sourceResults ?? []
        return {
          companyId: compName,
          domain: discoveryScope === 'rfps' ? 'procurement' : 'funding',
          runId: currentRunId,
          requestedAt: runTime,
          completedAt: new Date().toISOString(),
          scenario: 'live',
          outcome: compErrors > 0 ? (compRecs > 0 ? 'PARTIAL' : 'FAILED') : compRecs === 0 ? 'NO_RESULTS' : 'SUCCESS',
          counts: {
            totalSources: srcResults.length,
            candidatesReceived: srcResults.reduce((sum, s) => sum + (s.recordCount ?? 0), 0),
            candidatesCreated: compRecs,
            candidatesRequiringReview: compNeedsReview,
            duplicates: 0,
            blockedSources: 0,
            failedSources: compErrors > 0 ? 1 : 0,
          },
          needsReview: compNeedsReview,
          sourceResults: srcResults.map((s) => ({
            sourceId: s.source === 'grantsgov' ? 'SU-GRANTS-001' : s.source === 'eu-sedia' ? 'SU-EU-SEDIA-001' : 'SU-TED-001',
            sourceName: s.source === 'grantsgov' ? 'Grants.gov' : s.source === 'eu-sedia' ? 'EU SEDIA' : 'TED Procurement',
            adapterType: s.source,
            domain: s.source === 'ted' ? 'procurement' : 'funding',
            accessState: 'AVAILABLE' as const,
            outcome: (s.errors?.length ?? 0) > 0 ? ((s.recordCount ?? 0) > 0 ? 'PARTIAL' : 'FAILED') : (s.recordCount ?? 0) === 0 ? 'NO_RESULTS' : 'SUCCESS',
            requestedAt: runTime,
            observedAt: runTime,
            candidatesReceived: s.recordCount ?? 0,
            candidatesCreated: s.recordCount ?? 0,
            candidatesRequiringReview: compNeedsReview,
            duplicates: 0,
            candidateIds: [],
            errors: [...(s.errors ?? [])],
            warnings: [],
          })),
          candidates: candidatesNeedingReview.filter((c) => c.companyId === compName),
        }
      })

      const runOutcome: DiscoveryRunOutcome = {
        runId: currentRunId,
        domain: discoveryScope === 'rfps' ? 'procurement' : 'funding',
        scenario: 'live',
        requestedAt: runTime,
        completedAt: new Date().toISOString(),
        companyIds: profiles.map((p) => p.name || p.companyId),
        companies: companyResults,
        counts: {
          totalSources: allSourceResults.length,
          candidatesReceived: allSourceResults.reduce((sum, s) => sum + (s.recordCount ?? 0), 0),
          candidatesCreated: allRecords.length,
          candidatesRequiringReview: allRecommendations.filter((rec) => rec.outcome !== 'not_relevant').length,
          duplicates: 0,
          blockedSources: 0,
          failedSources: nextResults.filter((r) => (r.errors?.length ?? 0) > 0).length,
        },
        needsReview: allRecommendations.filter((rec) => rec.outcome !== 'not_relevant').length,
        outcome: hasErrors ? (allRecords.length > 0 ? 'PARTIAL' : 'FAILED') : allRecords.length === 0 ? 'NO_RESULTS' : 'SUCCESS',
        reviewQueue: reviewFixtureStore.suppliedItems(),
        sector: 'all',
        keyword: search.trim(),
        location: 'all',
      }

      persistRunOutcome(runOutcome)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
    }
  }

  const toggleGroupExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const expandAll = () => {
    setExpandedKeys(new Set(opportunityGroups.map((g) => g.key)))
  }

  const collapseAll = () => {
    setExpandedKeys(new Set())
  }

  const clearFilters = () => {
    setSearch('')
    setTypeFilter('all')
    setOutcomeFilter('all')
    setCompanyFilter('all')
    setPage(0)
  }

  if (profiles.length === 0) {
    return (
      <div
        className="card sn-discovery-empty-card"
        style={{
          padding: '32px 24px',
          margin: '20px 0 28px',
          textAlign: 'center',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg, 12px)',
        }}
      >
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎯</div>
        <div style={{ fontWeight: 700, fontSize: '16.5px', color: 'var(--text)', marginBottom: '6px' }}>
          Ready to Discover Opportunities
        </div>
        <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', margin: '0 auto 16px', maxWidth: '540px', lineHeight: 1.5 }}>
          Upload a target company CSV above (1–50 companies) to unlock automated multi-source discovery across Grants.gov, EU SEDIA, and TED Procurement tenders with explainable suitability scoring.
        </p>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '6px 16px', borderRadius: '999px', border: '1px solid var(--border)' }}>
          <span>💡 Tip:</span>
          <span>Click <strong>Browse your computer</strong> in the box above to load your company list.</span>
        </div>
      </div>
    )
  }

  const hasSourceErrors = sourceErrors.length > 0

  return (
    <section className="sn-discovery-workspace" aria-labelledby="target-live-discovery-heading" style={{ marginTop: '24px' }}>
      <div className="card sn-discovery-command-card" style={{ padding: '24px', marginBottom: '24px', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '18px' }}>
          <div>
            <h2 className="page__title page__title--sub" id="target-live-discovery-heading" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
              Target Company Live Discovery
            </h2>
            <p className="page__description" style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
              Automated multi-source search across Grants.gov, EU SEDIA, and TED Procurement tenders, matched against your {profiles.length} imported company profiles with explainable suitability scoring.
            </p>
          </div>
          <span className="sn-tag sn-tag--accent" style={{ alignSelf: 'center', fontSize: '12px' }}>
            ● {profiles.length} Active Profiles
          </span>
        </div>

        {/* Main Action Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void run()}
            disabled={running || profiles.length === 0}
            style={{ padding: '9px 20px', fontWeight: 600 }}
          >
            {running ? 'Discovering opportunities...' : hasSourceErrors ? 'Retry discovery' : 'Discover Opportunities'}
          </button>

          {/* Opportunity Scope Selector: Grants vs RFPs vs Both */}
          <label
            htmlFor="discovery-scope-select"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}
          >
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Opportunity Scope:</span>
            <select
              id="discovery-scope-select"
              className="sn-select"
              value={discoveryScope}
              onChange={(e) => setDiscoveryScope(e.target.value as 'grants' | 'rfps' | 'all')}
              disabled={running}
              aria-label="Opportunity Discovery Scope"
            >
              <option value="grants">Grants &amp; Funding (Grants.gov + EU SEDIA)</option>
              <option value="rfps">RFPs &amp; Government Tenders (TED Procurement)</option>
              <option value="all">All Opportunities (Grants + RFPs Combined)</option>
            </select>
          </label>

          {results.length > 0 && leads > 0 ? (
            <LeadsDownloadMenu
              results={results}
              companyName={profiles[0]?.name}
              totalLeads={leads}
              disabled={running}
              variant="primary"
              idPrefix="action-bar"
            />
          ) : null}

          {running ? <span role="status" style={{ fontSize: '13px', color: 'var(--accent)' }}>Searching live sources &amp; assessing fit...</span> : null}
        </div>
      </div>

      {runError !== null ? (
        <div role="alert" className="empty" style={{ borderColor: 'var(--error-border)', background: 'var(--error-bg)', marginBottom: '16px' }}>
          <p className="empty__headline" style={{ color: 'var(--error-text)' }}>
            Discovery could not complete
          </p>
          <p className="empty__body" style={{ color: 'var(--error-text)' }}>
            {runError}
          </p>
        </div>
      ) : null}

      {sourceErrors.length > 0 ? (
        <div
          role="alert"
          aria-label="Discovery source errors"
          style={{
            background: 'var(--warn-bg)',
            border: '1px solid var(--warn-border)',
            borderRadius: 'var(--radius)',
            padding: '14px 18px',
            marginBottom: '20px',
            color: 'var(--warn-text)',
          }}
        >
          <strong style={{ fontSize: '14px' }}>Some discovery sources did not complete successfully:</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: '20px', fontSize: '13px' }}>
            {sourceErrors.map(({ source, message }, index) => (
              <li key={`${source}-${index}`}>
                <strong>{source === 'grantsgov' ? 'Grants.gov' : source === 'eu-sedia' ? 'EU Funding & Tenders' : 'TED'}:</strong>{' '}
                {message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Data Summary Area */}
      {results.length > 0 ? (
        <>
          <p className="visually-hidden">
            Opportunities: {opportunityGroups.length} · Evaluations: {assessments.length} · Potential leads: {leads}
          </p>

          <div className="sn-overview-grid">
            <div className="sn-stat-card">
              <div className="sn-stat-card__header">
                <span className="sn-stat-card__title">Unique Opportunities</span>
                <span className="sn-stat-card__icon">🎯</span>
              </div>
              <span className="sn-stat-card__value">{opportunityGroups.length}</span>
              <span className="sn-stat-card__meta">Canonical opportunity records</span>
            </div>

            <div className="sn-stat-card">
              <div className="sn-stat-card__header">
                <span className="sn-stat-card__title">Company Assessments</span>
                <span className="sn-stat-card__icon">🤝</span>
              </div>
              <span className="sn-stat-card__value">{assessments.length}</span>
              <span className="sn-stat-card__meta">Individual company-opportunity evaluations</span>
            </div>

            <Link
              to="/discovery?view=human-review"
              className="sn-stat-card"
              style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
              title="Click to view all candidates awaiting review"
            >
              <div className="sn-stat-card__header">
                <span className="sn-stat-card__title">Awaiting Review</span>
                <span className="sn-stat-card__icon" style={{ color: 'var(--accent)' }}>
                  📝
                </span>
              </div>
              <span className="sn-stat-card__value">{needsReviewCount}</span>
              <span className="sn-stat-card__meta">Candidates needing human evaluation &rarr;</span>
            </Link>

            <div className="sn-stat-card">
              <div className="sn-stat-card__header">
                <span className="sn-stat-card__title">Closing Soon</span>
                <span className="sn-stat-card__icon" style={{ color: closingSoonCount > 0 ? 'var(--gold)' : 'inherit' }}>
                  ⏳
                </span>
              </div>
              <span className="sn-stat-card__value">{closingSoonCount}</span>
              <span className="sn-stat-card__meta">Verified deadline in &le; 30 days</span>
            </div>

            <div
              className="sn-stat-card"
              style={{
                cursor: leads > 0 ? 'pointer' : 'default',
                borderColor: leads > 0 ? 'rgba(16, 185, 129, 0.4)' : undefined,
                background: leads > 0 ? 'linear-gradient(180deg, var(--surface) 0%, rgba(16, 185, 129, 0.05) 100%)' : undefined,
              }}
              onClick={() => {
                if (leads > 10) {
                  document.getElementById('action-bar-download-leads-btn')?.click()
                } else if (leads > 0) {
                  downloadLeadsCsv(results, profiles[0]?.name)
                }
              }}
              title={leads > 10 ? 'Click to view batch download options' : leads > 0 ? 'Click to download qualified leads CSV' : undefined}
            >
              <div className="sn-stat-card__header">
                <span className="sn-stat-card__title">Potential Leads</span>
                <span className="sn-stat-card__icon" style={{ color: 'var(--success, #10b981)' }}>
                  🎯
                </span>
              </div>
              <span className="sn-stat-card__value" style={{ color: leads > 0 ? 'var(--success, #10b981)' : undefined }}>
                {leads}
              </span>
              <span className="sn-stat-card__meta">
                {leads > 0 ? '📥 Click to export leads CSV' : 'Qualified by fit score'}
              </span>
            </div>
          </div>

          {/* View Mode Switcher: Cards | Match Matrix */}
          <div className="sn-view-mode-bar">
            <div className="sn-segmented-control" role="tablist" aria-label="Opportunity view format">
              <button
                type="button"
                role="tab"
                id="tab-view-cards"
                aria-selected={viewMode === 'cards'}
                className={`sn-segmented-btn ${viewMode === 'cards' ? 'sn-segmented-btn--active' : ''}`}
                onClick={() => setViewMode('cards')}
              >
                <span className="sn-segmented-icon">📑</span>
                Cards
              </button>
              <button
                type="button"
                role="tab"
                id="tab-view-matrix"
                aria-selected={viewMode === 'matrix'}
                className={`sn-segmented-btn ${viewMode === 'matrix' ? 'sn-segmented-btn--active' : ''}`}
                onClick={() => setViewMode('matrix')}
              >
                <span className="sn-segmented-icon">📊</span>
                Match Matrix
              </button>
            </div>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              {opportunityGroups.length} opportunities across {availableCompanies.length} companies
            </span>
          </div>

          {viewMode === 'matrix' ? (
            <MatchMatrix
              opportunityGroups={opportunityGroups}
              allCompanies={availableCompanies}
            />
          ) : (
            <>
              {/* Interactive Toolbar & Controls */}
              <div className="sn-toolbar">
            <div className="sn-toolbar__search-group">
              <label htmlFor="rec-search" style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                Search recommendations
              </label>
              <input
                id="rec-search"
                type="search"
                className="sn-search-input"
                placeholder="Search by company or opportunity title…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search recommendations"
                autoComplete="off"
              />
              {search ? (
                <button type="button" className="btn btn--clear" onClick={() => setSearch('')}>
                  Clear
                </button>
              ) : null}
            </div>

            <div className="sn-toolbar__filters">
              <label htmlFor="type-filter" className="sn-filter-label">
                <span className="visually-hidden">Filter category</span>
                <select
                  id="type-filter"
                  className="sn-select"
                  aria-label="Filter category"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as any)}
                >
                  <option value="all">All Categories</option>
                  <option value="funding">Funding only</option>
                  <option value="procurement">Procurement only</option>
                </select>
              </label>

              <label htmlFor="outcome-filter" className="sn-filter-label">
                <span className="visually-hidden">Filter match classification</span>
                <select
                  id="outcome-filter"
                  className="sn-select"
                  aria-label="Filter match classification"
                  value={outcomeFilter}
                  onChange={(e) => setOutcomeFilter(e.target.value)}
                >
                  <option value="all">All Classifications</option>
                  <option value="relevant">Relevant</option>
                  <option value="potentially_relevant">Potentially relevant</option>
                  <option value="not_relevant">Not relevant</option>
                </select>
              </label>

              {availableCompanies.length > 0 ? (
                <label htmlFor="company-filter" className="sn-filter-label">
                  <span className="visually-hidden">Filter by company</span>
                  <select
                    id="company-filter"
                    className="sn-select"
                    aria-label="Filter by company"
                    value={companyFilter}
                    onChange={(e) => setCompanyFilter(e.target.value)}
                  >
                    <option value="all">All Companies</option>
                    {availableCompanies.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label htmlFor="sort-by-opportunity" className="sn-filter-label">
                <span className="visually-hidden">Sort by</span>
                <select
                  id="sort-by-opportunity"
                  className="sn-select"
                  aria-label="Sort by"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                >
                  <option value="fit">Sort by Fit Score</option>
                  <option value="title">Sort by Title (A-Z)</option>
                  <option value="deadline">Sort by Deadline</option>
                </select>
              </label>

              {/* Rows per page selector matching Companies table */}
              <label htmlFor="cards-page-size" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                <span>Rows:</span>
                <select
                  id="cards-page-size"
                  className="sn-select"
                  aria-label="Rows per page"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(0)
                  }}
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </label>

              <button type="button" className="btn btn--sm btn--outline" onClick={expandAll}>
                Expand All
              </button>
              <button type="button" className="btn btn--sm btn--outline" onClick={collapseAll}>
                Collapse All
              </button>
              {leads > 0 ? (
                <LeadsDownloadMenu
                  results={results}
                  companyName={profiles[0]?.name}
                  totalLeads={leads}
                  disabled={running}
                  variant="toolbar"
                  idPrefix="toolbar"
                />
              ) : null}
              {(search || typeFilter !== 'all' || outcomeFilter !== 'all' || companyFilter !== 'all') ? (
                <button type="button" className="btn btn--sm btn--outline" onClick={clearFilters}>
                  Clear Filters
                </button>
              ) : null}
            </div>
          </div>

          {/* Results List */}
          {filteredGroups.length === 0 ? (
            <p role="status" className="dg-empty">
              No recommendations match this search.
            </p>
          ) : (
            <>
              <div role="feed" aria-label="Discovered opportunities">
                {paginatedGroups.map((group) => {
                const open = expandedKeys.has(group.key)
                const firstAssessment = group.assessments[0]
                const maxScore = Math.max(
                  ...(group.assessments ?? []).map((a) => (typeof a?.score === 'number' ? a.score : 0)),
                  0,
                )
                const scoreDisplay = maxScore > 0 ? `${maxScore <= 1 ? Math.round(maxScore * 100) : Math.round(maxScore)}%` : null

                return (
                  <article
                    key={group.key}
                    className="card sn-opportunity-card"
                    data-testid="target-company-opportunity"
                  >
                    <div className="sn-opportunity-card__header">
                      <h3 className="sn-opportunity-card__title">{group.opportunityTitle}</h3>
                      <div className="sn-opportunity-card__badges">
                        <span className="sn-tag sn-tag--accent">
                          {group.opportunityType === 'procurement' ? 'Procurement' : 'Funding'}
                        </span>
                        <span className="sn-tag">{group.source}</span>
                        {scoreDisplay ? (
                          <span className="sn-tag sn-tag--success" title="Highest suitability score across evaluated companies">
                            Fit: {scoreDisplay}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="sn-opportunity-card__meta">
                      <span>
                        <strong>Source:</strong> {group.source} ·{' '}
                        {firstAssessment?.sourceUrl ? (
                          <a href={firstAssessment.sourceUrl} target="_blank" rel="noreferrer">
                            {firstAssessment.sourceUrl}
                          </a>
                        ) : (
                          'Official link available'
                        )}
                      </span>
                      <span>
                        <strong>Deadline:</strong> {firstAssessment?.deadline ?? 'Not specified'}
                      </span>
                      <span>
                        <strong>Status:</strong>{' '}
                        <span className="sn-tag">{firstAssessment?.status ?? 'unknown'}</span>
                      </span>
                      <span role="status">
                        <strong>Company assessments: {group.assessments.length}</strong>
                      </span>
                    </div>

                    <div className="sn-opportunity-card__actions">
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <Link
                          className="btn btn--outline"
                          to={`/discovery?view=${group.opportunityType === 'procurement' ? 'procurement-review' : 'funding-review'}`}
                        >
                          Open {group.opportunityType === 'procurement' ? 'procurement' : 'funding'} review
                        </Link>
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => toggleGroupExpanded(group.key)}
                          aria-expanded={open}
                        >
                          {open ? 'Hide assessments' : 'View assessments'}
                        </button>
                      </div>

                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {group.assessments.length} {group.assessments.length === 1 ? 'company assessment' : 'company assessments'}
                      </span>
                    </div>

                    {open ? (
                      <div className="sn-assessments-container">
                        <p className="sn-assessments-disclaimer">
                          Suitability scores are evaluated independently for each company based on sector, ICP, and scope alignment.
                          They represent system fit criteria, not guaranteed probabilities of award.
                        </p>
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                          {(group.assessments ?? []).map((assessment, index) => {
                            const scoreVal =
                              assessment.score != null
                                ? assessment.score <= 1
                                  ? `${Math.round(assessment.score * 100)}%`
                                  : `${Math.round(assessment.score)}%`
                                : 'n/a'

                            const outcomeBadge =
                              assessment.outcome === 'relevant'
                                ? 'sn-tag sn-tag--success'
                                : assessment.outcome === 'potentially_relevant'
                                  ? 'sn-tag sn-tag--warn'
                                  : 'sn-tag'

                            return (
                              <li
                                key={`${assessment.companyId || assessment.companyName}-${index}`}
                                data-testid="target-company-assessment"
                                className="sn-assessment-item"
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <span className="sn-assessment-company">{assessment.companyName}</span>
                                  <span className={outcomeBadge}>{assessment.outcome}</span>
                                  <span className="sn-assessment-score">Score: {scoreVal}</span>
                                </div>

                                <div className="sn-assessment-reasons">
                                  <strong>Evaluation rationale:</strong> {Array.isArray(assessment.reasons) ? assessment.reasons.join(' ') : ''}
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>

              {/* Pagination Bar for Cards */}
              <div className="listbar sn-matrix-pagination" style={{ marginTop: '16px' }}>
                <div className="listbar__counts">
                  <span className="company-directory-pagination__range">
                    Showing <strong>{filteredGroups.length === 0 ? 0 : safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filteredGroups.length)}</strong> of <strong>{filteredGroups.length}</strong> opportunities
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <label htmlFor="cards-page-size-bottom" style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
                    Rows per page:
                    <select
                      id="cards-page-size-bottom"
                      className="sn-select"
                      style={{ marginLeft: '6px', padding: '3px 8px', fontSize: '12.5px' }}
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value))
                        setPage(0)
                      }}
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                    </select>
                  </label>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="btn btn--sm btn--outline"
                      disabled={safePage <= 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      aria-label="Previous cards page"
                    >
                      Previous
                    </button>
                    <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', padding: '0 4px' }}>
                      Page {safePage + 1} of {totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn--sm btn--outline"
                      disabled={safePage >= totalPages - 1}
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      aria-label="Next cards page"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  ) : null}
    </section>
  )
}
