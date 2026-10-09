/**
 * Phase 4 live TED discovery surface for the Discovery control panel.
 *
 * Mirrors the fixture store's surface (`beginRun` / `runCompany` / `finishRun`
 * / `history` / `reset`) but drives the REAL TED source: each selected company
 * is one read-only live search issued through the same-origin ted-bridge, and
 * the returned source body is replayed through the REAL Phase D orchestrator
 * with a TED adapter bound to an in-memory transport. Normalization,
 * classification, deduplication, the access gate, provenance, warnings, and
 * the Phase E review handoff are therefore the exact production code path —
 * nothing here reimplements discovery.
 *
 * The ONE live network call happens server-side in `ted-bridge/handler.ts`
 * (`createFetchTransport`). This browser module talks only to the same-origin
 * bridge via plain `fetch`, and can never reach the source directly (it offers
 * no CORS headers, so a browser call is impossible by design).
 *
 * Honesty: a bridge failure or source error is a REAL FAILED source result
 * produced by the real adapter/pipeline — never an invented empty success.
 * Outcomes share the `DiscoveryRunOutcome` shape with `scenario: 'live'`, so
 * the existing results, workflow, and run-history UI render live and fixture
 * runs identically, with provenance intact.
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
import { DEFAULT_SOURCE_REGISTRY, TED_SOURCE_ID } from '../automation/registry'
import { reviewFixtureStore } from '../automation/review-fixture'
import { createReviewQueue, reviewStatusForCandidate } from '../automation/review-queue'
import { createTedAdapter } from '../automation/ted-adapter'
import type { TedTransport } from '../automation/ted-adapter'
import { TED_BRIDGE_SEARCH_PATH } from './ted-bridge/contract'
import type { TedBridgeSearchRequest, TedBridgeSearchResponse } from './ted-bridge/contract'

export const TED_LIVE_RUN_ID_PREFIX = 'RUN-T'
export const TED_LIVE_PROFILE_ID = 'DP-LIVE-001'
export const TED_LIVE_DEFAULT_LIMIT = 10
/** Recent-window default so a real search finds live, current listings. */
export const TED_LIVE_WINDOW_DAYS = 90

export interface LiveTedRunContext {
  runId: string
  domain: 'procurement'
  scenario: 'live'
  requestedAt: string
  sector: DiscoverySector
  keyword: string
  location: DiscoveryLocation
  publishedSince: string
  limit: number
}

export interface LiveTedRunSelection {
  sector?: DiscoverySector
  keyword?: string
  location?: DiscoveryLocation
  publishedSince?: string
  limit?: number
}

export interface LiveTedDiscoveryStore {
  beginRun(selection?: LiveTedRunSelection): LiveTedRunContext
  runCompany(context: LiveTedRunContext, companyId: string): Promise<DiscoveryCompanyResult>
  finishRun(context: LiveTedRunContext, companies: readonly DiscoveryCompanyResult[]): DiscoveryRunOutcome
  history(): readonly DiscoveryRunOutcome[]
  reset(): void
}

/** Async same-origin bridge client; injectable for tests. */
export type TedBridgeClient = (request: TedBridgeSearchRequest) => Promise<TedBridgeSearchResponse>

export function defaultTedBridgeClient(): TedBridgeClient {
  return async (request) => {
    const response = await globalThis.fetch(TED_BRIDGE_SEARCH_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    return (await response.json()) as TedBridgeSearchResponse
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

/** Same keyword semantics as the fixture store: exact, case-insensitive. */
function matchesKeyword(candidate: DiscoveryCandidate, keyword: string): boolean {
  if (keyword === '') return true
  return candidate.sourceTitle.toLowerCase().includes(keyword)
}

/**
 * Builds a live discovery module bound to one bridge client: the factory keeps
 * the store deterministic and testable (tests inject a fake bridge carrying a
 * recorded TED response, so no network or server is needed).
 */
export function createLiveTedDiscovery(options: {
  readonly bridge: TedBridgeClient
  readonly registry?: SourceRegistry
  readonly requestedAt?: string
}): LiveTedDiscoveryStore {
  const registry = options.registry ?? DEFAULT_SOURCE_REGISTRY
  let runCounter = 0
  let historyState: readonly DiscoveryRunOutcome[] = deepFreeze([])

  function nextRunId(): string {
    runCounter += 1
    return `${TED_LIVE_RUN_ID_PREFIX}-${String(runCounter).padStart(4, '0')}`
  }

  function beginNow(): string {
    return options.requestedAt ?? nowIso()
  }

  /**
   * A transport that either replays the genuine bridge response for the REAL
   * TED adapter (status + raw body exactly as the source returned it) or
   * throws with the bridge's honest errors — so a failed live call surfaces
   * as a FAILED source result through the real pipeline, never as invented
   * success.
   */
  function transportFor(response: TedBridgeSearchResponse): TedTransport {
    return () => {
      if (!response.ok) {
        throw new Error(response.errors.map((error) => error.message).join('; '))
      }
      return { status: response.status, body: response.body }
    }
  }

  function dependenciesFor(adapter: SourceAdapter): DiscoveryRunDependencies {
    return { registry, adapters: Object.freeze({ [TED_SOURCE_ID]: adapter }) }
  }

  function searchTermFor(context: LiveTedRunContext, companyId: string): string {
    return context.keyword !== '' ? context.keyword : companyId
  }

  function inputFor(context: LiveTedRunContext, companyId: string): DiscoveryRunInput {
    const adapterConfig: Record<string, unknown> = { limit: context.limit }
    if (context.publishedSince !== '') adapterConfig.publishedSince = context.publishedSince
    return {
      runId: `${context.runId}-${companyId}`,
      companyId,
      discoveryProfileId: TED_LIVE_PROFILE_ID,
      domain: context.domain,
      requestedAt: context.requestedAt,
      sourceIds: [TED_SOURCE_ID],
      queryTerms: [searchTermFor(context, companyId)],
      exclusions: [],
      sector: context.sector,
      keyword: searchTermFor(context, companyId),
      location: context.location,
      adapterConfig,
    }
  }

  function validateContext(context: LiveTedRunContext): void {
    if (context.domain !== 'procurement') {
      throw new Error(`live TED discovery is procurement-only: ${String(context.domain)}`)
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
    beginRun(selection: LiveTedRunSelection = {}): LiveTedRunContext {
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
      const limit = selection.limit ?? TED_LIVE_DEFAULT_LIMIT
      if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1 || limit > 100) {
        throw new Error(`live TED limit must be between 1 and 100: ${String(limit)}`)
      }
      return deepFreeze({
        runId: nextRunId(),
        domain: 'procurement',
        scenario: 'live',
        requestedAt: beginNow(),
        sector,
        keyword: (selection.keyword ?? '').trim().toLowerCase(),
        location,
        publishedSince: selection.publishedSince ?? recentDateDaysAgo(TED_LIVE_WINDOW_DAYS),
        limit,
      })
    },

    async runCompany(context: LiveTedRunContext, companyId: string): Promise<DiscoveryCompanyResult> {
      validateContext(context)
      if (typeof companyId !== 'string' || companyId.trim().length === 0) {
        throw new Error('company id must not be blank')
      }
      const cleaned = companyId.trim()

      const bridgeRequest: TedBridgeSearchRequest = {
        runId: context.runId,
        companyId: cleaned,
        keyword: searchTermFor(context, cleaned),
        publishedSince: context.publishedSince,
        limit: context.limit,
        requestedAt: context.requestedAt,
      }

      let response: TedBridgeSearchResponse
      try {
        response = await options.bridge(bridgeRequest)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        response = {
          ok: false,
          status: 0,
          body: null,
          errors: [{ code: 'bridge_failure', message: `live TED search failed: ${message}` }],
        }
      }

      const adapter = createTedAdapter({ transport: transportFor(response), registry })
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
      context: LiveTedRunContext,
      companies: readonly DiscoveryCompanyResult[],
    ): DiscoveryRunOutcome {
      validateContext(context)
      if (companies.length === 0) {
        throw new Error('a live TED run needs at least one company result')
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
      // Review handoff: the live run's candidates enter the real Phase E queue
      // backing the Human review page, exactly like fixture runs.
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

export const liveDiscoveryStore = createLiveTedDiscovery({ bridge: defaultTedBridgeClient() })