/**
 * Phase 21C live EU Funding & Tenders Portal (SEDIA) funding discovery surface.
 *
 * Connects the real EU source (`SU-EU-001`) to a **Run Live EU Funding Search**
 * action. Mirror of the live Grants.gov surface (`live-grantsgov-discovery.ts`):
 * the run issues ONE read-only live search through the same-origin EU bridge
 * (`/__tvb/eu/search`), the returned source body is replayed through the REAL
 * Phase D orchestrator with the EU SEDIA adapter bound to an in-memory
 * transport, and the production pipeline (normalization, classification, dedup,
 * provenance, review handoff) produces candidates. Nothing here reimplements
 * discovery.
 *
 * The query is identical for every selected company, so the bridge request is
 * issued ONCE per run and its response is replayed for each selected company.
 * The companies share one source pool; they are NOT company-matched.
 *
 * Honesty:
 *  - bridge/source failures are REAL FAILED results through the real pipeline,
 *    never invented empty successes;
 *  - the source status code is carried as evidence (`candidate.sourceStatus`) and
 *    is NEVER read as "open"; the explicit open-call gate is separate;
 *  - the static registry keeps `SU-EU-001` at `accessState: 'UNKNOWN'`; this
 *    surface builds a RUN-SCOPED registry view in which ONLY `SU-EU-001` is
 *    AVAILABLE for that run (the mounted, fixed-endpoint, public same-origin
 *    bridge IS the read-only access path). The override never mutates
 *    `DEFAULT_SOURCE_REGISTRY`.
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
import { createSourceRegistry, DEFAULT_SOURCE_REGISTRY, EU_SEDIA_SOURCE_ID } from '../automation/registry'
import { reviewFixtureStore } from '../automation/review-fixture'
import { createReviewQueue, reviewStatusForCandidate } from '../automation/review-queue'
import { createEuSediaAdapter } from '../automation/eu-sedia-adapter'
import type { EuSediaTransport } from '../automation/eu-sedia-adapter'
import { EU_SEDIA_BRIDGE_SEARCH_PATH } from './eu-sedia-bridge/contract'
import type { EuSediaBridgeSearchRequest, EuSediaBridgeSearchResponse } from './eu-sedia-bridge/contract'

export const EU_SEDIA_LIVE_RUN_ID_PREFIX = 'RUN-EU'
export const EU_SEDIA_LIVE_PROFILE_ID = 'DP-LIVE-004'
export const EU_SEDIA_LIVE_DEFAULT_LIMIT = 10
export const EU_SEDIA_LIVE_POOL_COMPANY_ID = 'RUN'

export interface LiveEuSediaRunContext {
  runId: string
  domain: 'funding'
  scenario: 'live'
  requestedAt: string
  sector: DiscoverySector
  keyword: string
  location: DiscoveryLocation
  limit: number
}

export interface LiveEuSediaRunSelection {
  sector?: DiscoverySector
  keyword?: string
  location?: DiscoveryLocation
  limit?: number
}

export interface LiveEuSediaDiscoveryStore {
  beginRun(selection?: LiveEuSediaRunSelection): LiveEuSediaRunContext
  runCompany(context: LiveEuSediaRunContext, companyId: string): Promise<DiscoveryCompanyResult>
  finishRun(context: LiveEuSediaRunContext, companies: readonly DiscoveryCompanyResult[]): DiscoveryRunOutcome
  history(): readonly DiscoveryRunOutcome[]
  reset(): void
}

export type EuSediaBridgeClient = (request: EuSediaBridgeSearchRequest) => Promise<EuSediaBridgeSearchResponse>

export function defaultEuSediaBridgeClient(): EuSediaBridgeClient {
  return async (request) => {
    const response = await globalThis.fetch(EU_SEDIA_BRIDGE_SEARCH_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    return (await response.json()) as EuSediaBridgeSearchResponse
  }
}

export function euSediaLiveRegistry(base: SourceRegistry = DEFAULT_SOURCE_REGISTRY): SourceRegistry {
  return createSourceRegistry(
    base.definitions.map((definition) =>
      definition.sourceId === EU_SEDIA_SOURCE_ID
        ? { ...definition, accessState: 'AVAILABLE' as const }
        : definition,
    ),
  )
}

function nowIso(): string {
  return new Date().toISOString()
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

export function createLiveEuSediaDiscovery(options: {
  readonly bridge: EuSediaBridgeClient
  readonly registry?: SourceRegistry
  readonly requestedAt?: string
}): LiveEuSediaDiscoveryStore {
  const registry = euSediaLiveRegistry(options.registry ?? DEFAULT_SOURCE_REGISTRY)
  let runCounter = 0
  let historyState: readonly DiscoveryRunOutcome[] = deepFreeze([])
  const runResponses = new Map<string, Promise<EuSediaBridgeSearchResponse>>()

  function nextRunId(): string {
    runCounter += 1
    return `${EU_SEDIA_LIVE_RUN_ID_PREFIX}-${String(runCounter).padStart(4, '0')}`
  }

  function sharedResponseFor(context: LiveEuSediaRunContext): Promise<EuSediaBridgeSearchResponse> {
    const cached = runResponses.get(context.runId)
    if (cached !== undefined) return cached
    const bridgeRequest: EuSediaBridgeSearchRequest = {
      runId: context.runId,
      companyId: EU_SEDIA_LIVE_POOL_COMPANY_ID,
      keyword: context.keyword,
      limit: context.limit,
      requestedAt: context.requestedAt,
    }
    const request = Promise.resolve()
      .then(() => options.bridge(bridgeRequest))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        const failure: EuSediaBridgeSearchResponse = {
          ok: false,
          status: 0,
          body: null,
          errors: [{ code: 'bridge_failure', message: `live EU SEDIA search failed: ${message}` }],
        }
        return failure
      })
    runResponses.set(context.runId, request)
    return request
  }

  function transportFor(response: EuSediaBridgeSearchResponse): EuSediaTransport {
    return () => {
      if (!response.ok) {
        throw new Error(response.errors.map((error) => error.message).join('; '))
      }
      return { status: response.status, body: response.body }
    }
  }

  function dependenciesFor(adapter: SourceAdapter): DiscoveryRunDependencies {
    return { registry, adapters: Object.freeze({ [EU_SEDIA_SOURCE_ID]: adapter }) }
  }

  function isBroad(context: LiveEuSediaRunContext): boolean {
    return context.keyword === ''
  }

  function inputFor(context: LiveEuSediaRunContext, companyId: string): DiscoveryRunInput {
    const broad = isBroad(context)
    return {
      runId: `${context.runId}-${companyId}`,
      companyId,
      discoveryProfileId: EU_SEDIA_LIVE_PROFILE_ID,
      domain: context.domain,
      requestedAt: context.requestedAt,
      sourceIds: [EU_SEDIA_SOURCE_ID],
      queryTerms: [broad ? '*' : context.keyword],
      exclusions: [],
      sector: context.sector,
      keyword: context.keyword,
      location: context.location,
      adapterConfig: { rows: context.limit, broadSearch: broad },
    }
  }

  function validateContext(context: LiveEuSediaRunContext): void {
    if (context.domain !== 'funding') {
      throw new Error(`live EU SEDIA discovery is funding-only: ${String(context.domain)}`)
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
    beginRun(selection: LiveEuSediaRunSelection = {}): LiveEuSediaRunContext {
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
      const limit = selection.limit ?? EU_SEDIA_LIVE_DEFAULT_LIMIT
      if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1 || limit > 100) {
        throw new Error(`live EU SEDIA limit must be between 1 and 100: ${String(limit)}`)
      }
      return deepFreeze({
        runId: nextRunId(),
        domain: 'funding',
        scenario: 'live',
        requestedAt: options.requestedAt ?? nowIso(),
        sector,
        keyword: (selection.keyword ?? '').trim().toLowerCase(),
        location,
        limit,
      })
    },

    async runCompany(context: LiveEuSediaRunContext, companyId: string): Promise<DiscoveryCompanyResult> {
      validateContext(context)
      if (typeof companyId !== 'string' || companyId.trim().length === 0) {
        throw new Error('company id must not be blank')
      }
      const cleaned = companyId.trim()

      const response = await sharedResponseFor(context)

      const adapter = createEuSediaAdapter({ transport: transportFor(response), registry })
      const input = inputFor(context, cleaned)
      const result = orchestrateDiscoveryRun(input, dependenciesFor(adapter))
      const candidates = result.candidates
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
      context: LiveEuSediaRunContext,
      companies: readonly DiscoveryCompanyResult[],
    ): DiscoveryRunOutcome {
      validateContext(context)
      if (companies.length === 0) {
        throw new Error('a live EU SEDIA run needs at least one company result')
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
      runResponses.delete(context.runId)
      return outcome
    },

    history(): readonly DiscoveryRunOutcome[] {
      return historyState
    },

    reset(): void {
      historyState = deepFreeze([])
      runCounter = 0
      runResponses.clear()
    },
  }
}

export const liveEuSediaDiscoveryStore = createLiveEuSediaDiscovery({
  bridge: defaultEuSediaBridgeClient(),
})
