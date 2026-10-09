/**
 * Phase V live USAspending funding discovery surface.
 *
 * Mirror of the Phase 4 live TED surface (`live-discovery.ts`) for the FUNDING
 * domain and the one verified real funding source (USAspending, `SU-US-001`).
 * Each selected company is one read-only live search issued through the
 * same-origin USAspending bridge, the returned source body is replayed through
 * the REAL Phase D orchestrator with the USAspending adapter bound to an
 * in-memory transport, and the exact production code path (normalization,
 * classification, deduplication, access gate, provenance, warnings, Phase E
 * review handoff) produces funding candidates. Nothing here reimplements
 * discovery.
 *
 * Honesty: bridge/source failures are REAL FAILED source results through the
 * real pipeline, never invented empty successes. Outcomes share the
 * `DiscoveryRunOutcome` shape with `scenario: 'live'` and `domain: 'funding'`,
 * so live and fixture funding runs render identically with provenance intact.
 */

import { deepFreeze } from '../automation/candidate'
import type { DiscoveryCandidate } from '../automation/candidate'
import type {
  DiscoveryCompanyResult,
  DiscoveryLocation,
  DiscoveryRunOutcome,
  DiscoverySector,
} from '../automation/discovery-fixture'
import { DISCOVERY_LOCATIONS, DISCOVERY_SECTORS } from '../automation/discovery-fixture'
import { deriveRunOutcome, orchestrateDiscoveryRun } from '../automation/orchestrator'
import type { DiscoveryRunCounts, DiscoveryRunDependencies, DiscoveryRunInput, SourceRunResult } from '../automation/orchestrator'
import type { SourceAdapter } from '../automation/adapter'
import type { SourceRegistry } from '../automation/registry'
import { DEFAULT_SOURCE_REGISTRY, USA_SPENDING_SOURCE_ID } from '../automation/registry'
import { reviewFixtureStore } from '../automation/review-fixture'
import { createReviewQueue, reviewStatusForCandidate } from '../automation/review-queue'
import { createUsaSpendingAdapter } from '../automation/usaspending-adapter'
import type { UsaSpendingTransport } from '../automation/usaspending-adapter'
import { USA_BRIDGE_SEARCH_PATH } from './usaspending-bridge/contract'
import type { UsaSpendingBridgeSearchRequest, UsaSpendingBridgeSearchResponse } from './usaspending-bridge/contract'

export const USA_LIVE_RUN_ID_PREFIX = 'RUN-F'
export const USA_LIVE_PROFILE_ID = 'DP-LIVE-002'
export const USA_LIVE_DEFAULT_LIMIT = 10
export const USA_LIVE_WINDOW_DAYS = 365

export interface LiveUsaSpendingRunContext {
  runId: string
  domain: 'funding'
  scenario: 'live'
  requestedAt: string
  sector: DiscoverySector
  keyword: string
  location: DiscoveryLocation
  publishedSince: string
  limit: number
}

export interface LiveUsaSpendingRunSelection {
  sector?: DiscoverySector
  keyword?: string
  location?: DiscoveryLocation
  publishedSince?: string
  limit?: number
}

export interface LiveUsaSpendingDiscoveryStore {
  beginRun(selection?: LiveUsaSpendingRunSelection): LiveUsaSpendingRunContext
  runCompany(context: LiveUsaSpendingRunContext, companyId: string): Promise<DiscoveryCompanyResult>
  finishRun(context: LiveUsaSpendingRunContext, companies: readonly DiscoveryCompanyResult[]): DiscoveryRunOutcome
  history(): readonly DiscoveryRunOutcome[]
  reset(): void
}

export type UsaSpendingBridgeClient = (request: UsaSpendingBridgeSearchRequest) => Promise<UsaSpendingBridgeSearchResponse>

export function defaultUsaSpendingBridgeClient(): UsaSpendingBridgeClient {
  return async (request) => {
    const response = await globalThis.fetch(USA_BRIDGE_SEARCH_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    return (await response.json()) as UsaSpendingBridgeSearchResponse
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function recentDateDaysAgo(days: number): string {
  const now = new Date()
  now.setUTCDate(now.getUTCDate() - days)
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function rollupCounts(results: readonly SourceRunResult[]): DiscoveryRunCounts {
  return deepFreeze({
    totalSources: results.length,
    candidatesReceived: results.reduce((sum, result) => sum + result.candidatesReceived, 0),
    candidatesCreated: results.reduce((sum, result) => sum + result.candidatesCreated, 0),
    candidatesRequiringReview: results.reduce((sum, result) => sum + result.candidatesRequiringReview, 0),
    duplicates: results.reduce((sum, result) => sum + result.duplicates, 0),
    blockedSources: results.filter((result) => result.outcome === 'BLOCKED').length,
    failedSources: results.filter((result) => result.outcome === 'FAILED').length,
  })
}

function candidateNeedsReview(candidate: DiscoveryCandidate): boolean {
  return reviewStatusForCandidate(candidate) === 'NEEDS_REVIEW'
}

function matchesKeyword(candidate: DiscoveryCandidate, keyword: string): boolean {
  if (keyword === '') return true
  return candidate.sourceTitle.toLowerCase().includes(keyword)
}

export function createLiveUsaSpendingDiscovery(options: {
  readonly bridge: UsaSpendingBridgeClient
  readonly registry?: SourceRegistry
  readonly requestedAt?: string
}): LiveUsaSpendingDiscoveryStore {
  const registry = options.registry ?? DEFAULT_SOURCE_REGISTRY
  let runCounter = 0
  let historyState: readonly DiscoveryRunOutcome[] = deepFreeze([])

  function nextRunId(): string {
    runCounter += 1
    return `${USA_LIVE_RUN_ID_PREFIX}-${String(runCounter).padStart(4, '0')}`
  }

  function beginNow(): string {
    return options.requestedAt ?? nowIso()
  }

  function transportFor(response: UsaSpendingBridgeSearchResponse): UsaSpendingTransport {
    return () => {
      if (!response.ok) {
        throw new Error(response.errors.map((error) => error.message).join('; '))
      }
      return { status: response.status, body: response.body }
    }
  }

  function dependenciesFor(adapter: SourceAdapter): DiscoveryRunDependencies {
    return { registry, adapters: Object.freeze({ [USA_SPENDING_SOURCE_ID]: adapter }) }
  }

  function searchTermFor(context: LiveUsaSpendingRunContext, companyId: string): string {
    return context.keyword !== '' ? context.keyword : companyId
  }

  function inputFor(context: LiveUsaSpendingRunContext, companyId: string): DiscoveryRunInput {
    const adapterConfig: Record<string, unknown> = { limit: context.limit }
    if (context.publishedSince !== '') adapterConfig.publishedSince = context.publishedSince
    return {
      runId: `${context.runId}-${companyId}`,
      companyId,
      discoveryProfileId: USA_LIVE_PROFILE_ID,
      domain: context.domain,
      requestedAt: context.requestedAt,
      sourceIds: [USA_SPENDING_SOURCE_ID],
      queryTerms: [searchTermFor(context, companyId)],
      exclusions: [],
      sector: context.sector,
      keyword: searchTermFor(context, companyId),
      location: context.location,
      adapterConfig,
    }
  }

  function validateContext(context: LiveUsaSpendingRunContext): void {
    if (context.domain !== 'funding') {
      throw new Error(`live USAspending discovery is funding-only: ${String(context.domain)}`)
    }
    if (context.scenario !== 'live') {
      throw new Error(`invalid live run scenario: ${String(context.scenario)}`)
    }
    if (typeof context.runId !== 'string' || context.runId.length === 0) {
      throw new Error('run id is required')
    }
    if (typeof context.requestedAt !== 'string' || context.requestedAt.length === 0) {
      throw new Error('requestedAt is required')
    }
    if (!(DISCOVERY_SECTORS as readonly string[]).includes(context.sector)) {
      throw new Error(`invalid discovery sector: ${String(context.sector)}`)
    }
    if (!(DISCOVERY_LOCATIONS as readonly string[]).includes(context.location)) {
      throw new Error(`invalid discovery location: ${String(context.location)}`)
    }
    if (typeof context.keyword !== 'string') {
      throw new Error('discovery keyword must be a string')
    }
  }

  return {
    beginRun(selection: LiveUsaSpendingRunSelection = {}): LiveUsaSpendingRunContext {
      const sector = selection.sector ?? 'all'
      if (!(DISCOVERY_SECTORS as readonly string[]).includes(sector)) {
        throw new Error(`invalid discovery sector: ${String(sector)}`)
      }
      const location = selection.location ?? 'all'
      if (!(DISCOVERY_LOCATIONS as readonly string[]).includes(location)) {
        throw new Error(`invalid discovery location: ${String(location)}`)
      }
      if (selection.keyword !== undefined && typeof selection.keyword !== 'string') {
        throw new Error('discovery keyword must be a string')
      }
      const limit = selection.limit ?? USA_LIVE_DEFAULT_LIMIT
      if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1 || limit > 100) {
        throw new Error(`live USAspending limit must be between 1 and 100: ${String(limit)}`)
      }
      return deepFreeze({
        runId: nextRunId(),
        domain: 'funding',
        scenario: 'live',
        requestedAt: beginNow(),
        sector,
        keyword: (selection.keyword ?? '').trim().toLowerCase(),
        location,
        publishedSince: selection.publishedSince ?? recentDateDaysAgo(USA_LIVE_WINDOW_DAYS),
        limit,
      })
    },

    async runCompany(context: LiveUsaSpendingRunContext, companyId: string): Promise<DiscoveryCompanyResult> {
      validateContext(context)
      if (typeof companyId !== 'string' || companyId.trim().length === 0) {
        throw new Error('company id must not be blank')
      }
      const cleaned = companyId.trim()

      const bridgeRequest: UsaSpendingBridgeSearchRequest = {
        runId: context.runId,
        companyId: cleaned,
        keyword: searchTermFor(context, cleaned),
        publishedSince: context.publishedSince,
        limit: context.limit,
        requestedAt: context.requestedAt,
      }

      let response: UsaSpendingBridgeSearchResponse
      try {
        response = await options.bridge(bridgeRequest)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        response = {
          ok: false,
          status: 0,
          body: null,
          errors: [{ code: 'bridge_failure', message: `live USAspending search failed: ${message}` }],
        }
      }

      const adapter = createUsaSpendingAdapter({ transport: transportFor(response), registry })
      const input = inputFor(context, cleaned)
      const result = orchestrateDiscoveryRun(input, dependenciesFor(adapter))
      const candidates = result.candidates.filter((candidate) => matchesKeyword(candidate, context.keyword))
      const needsReview = candidates.filter(candidateNeedsReview).length
      return deepFreeze({
        companyId: cleaned,
        domain: context.domain,
        runId: result.runId,
        requestedAt: result.requestedAt,
        completedAt: result.completedAt,
        scenario: context.scenario,
        outcome: result.outcome,
        counts: result.counts,
        needsReview,
        sourceResults: result.sourceResults,
        candidates,
      })
    },

    finishRun(
      context: LiveUsaSpendingRunContext,
      companies: readonly DiscoveryCompanyResult[],
    ): DiscoveryRunOutcome {
      validateContext(context)
      if (companies.length === 0) {
        throw new Error('a live USAspending run needs at least one company result')
      }

      const allCandidates: DiscoveryCandidate[] = []
      const allSourceResults: SourceRunResult[] = []

      for (const company of companies) {
        if (company.domain !== context.domain) {
          throw new Error(`run domain mismatch: ${company.domain} !== ${context.domain}`)
        }
        if (!company.runId.startsWith(`${context.runId}-`)) {
          throw new Error(`company result ${company.companyId} does not belong to run ${context.runId}`)
        }
        if (company.requestedAt !== context.requestedAt || company.completedAt !== context.requestedAt) {
          throw new Error(`company result ${company.companyId} uses unexpected timestamps`)
        }
        allSourceResults.push(...company.sourceResults)
        allCandidates.push(...company.candidates)
      }

      const reviewQueue = createReviewQueue(allCandidates, { createdAt: context.requestedAt })
      reviewFixtureStore.addReviewItems(reviewQueue)
      const outcome: DiscoveryRunOutcome = deepFreeze({
        runId: context.runId,
        domain: context.domain,
        scenario: context.scenario,
        requestedAt: context.requestedAt,
        completedAt: context.requestedAt,
        companyIds: deepFreeze(companies.map((company) => company.companyId)),
        companies: deepFreeze([...companies]),
        counts: rollupCounts(allSourceResults),
        needsReview: reviewQueue.filter((item) => item.reviewStatus === 'NEEDS_REVIEW').length,
        outcome: deriveRunOutcome(allSourceResults),
        reviewQueue,
        sector: context.sector,
        keyword: context.keyword,
        location: context.location,
      })
      historyState = deepFreeze([...historyState, outcome])
      return outcome
    },

    history(): readonly DiscoveryRunOutcome[] {
      return historyState
    },

    reset(): void {
      historyState = deepFreeze([])
      runCounter = 0
    },
  }
}

export const liveUsaSpendingDiscoveryStore = createLiveUsaSpendingDiscovery({
  bridge: defaultUsaSpendingBridgeClient(),
})