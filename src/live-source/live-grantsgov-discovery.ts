/**
 * Phase 20B live Grants.gov funding-opportunity discovery surface.
 *
 * Connects the real Grants.gov source (`SU-GRANTS-001`) to the **Run Live
 * Funding Search** action. Mirror of the live USAspending surface
 * (`live-funding-discovery.ts`) for the grant-OPPORTUNITY capability: the run
 * issues ONE read-only live search through the already mounted same-origin
 * Grants.gov bridge (`/__tvb/grantsgov/search`), the returned source body is
 * replayed through the REAL Phase D orchestrator with the Grants.gov adapter
 * bound to an in-memory transport, and the production pipeline (normalization,
 * classification, dedup, provenance, review handoff) produces candidates.
 * Nothing here reimplements discovery.
 *
 * Phase 20D: the query is identical for every selected company (a keyword run
 * searches that keyword; a blank keyword is a broad posted search), so the
 * bridge request is issued ONCE per run and its response is replayed for each
 * selected company. The selected companies share one source pool; they are NOT
 * company-matched — no company fact is inferred, and broad results are never
 * restricted by a company name. Review items are still produced per company run.
 *
 * Honesty:
 *  - bridge/source failures are REAL FAILED results through the real pipeline,
 *    never invented empty successes;
 *  - the source-published `oppStatus` is carried as evidence
 *    (`candidate.sourceStatus`) and is NEVER read as "open" or "eligible"; the
 *    explicit open-opportunity gate is a separate rule, so no record is labelled
 *    confirmed open through this store;
 *  - Phase 20B decision: the static registry keeps `SU-GRANTS-001` at
 *    `accessState: 'UNKNOWN'` (global promotion still requires a verified live
 *    query). This live surface therefore builds a RUN-SCOPED registry view in
 *    which ONLY `SU-GRANTS-001` is treated as AVAILABLE for that run, because
 *    the mounted, fixed-endpoint, no-auth same-origin bridge IS the read-only
 *    access path. The override never mutates
 *    `DEFAULT_SOURCE_REGISTRY` and never leaks into any other run.
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
import { createSourceRegistry, DEFAULT_SOURCE_REGISTRY, GRANTS_GOV_SOURCE_ID } from '../automation/registry'
import { reviewFixtureStore } from '../automation/review-fixture'
import { createReviewQueue, reviewStatusForCandidate } from '../automation/review-queue'
import { createGrantsGovAdapter } from '../automation/grantsgov-adapter'
import type { GrantsGovTransport } from '../automation/grantsgov-adapter'
import { GRANTS_GOV_BRIDGE_SEARCH_PATH } from './grantsgov-bridge/contract'
import type { GrantsGovBridgeSearchRequest, GrantsGovBridgeSearchResponse } from './grantsgov-bridge/contract'

export const GRANTS_GOV_LIVE_RUN_ID_PREFIX = 'RUN-G'
export const GRANTS_GOV_LIVE_PROFILE_ID = 'DP-LIVE-003'
export const GRANTS_GOV_LIVE_DEFAULT_LIMIT = 10
/** Status requested by default: OPEN, currently-posted opportunities. */
export const GRANTS_GOV_LIVE_DEFAULT_STATUSES = 'posted'
/**
 * Run-level `companyId` carried on the single shared bridge request. The bridge
 * requires a non-blank company id, but the query is run-wide (the same for every
 * selected company), so this marker — not any company's id — is sent. It never
 * implies the results belong to a company.
 */
export const GRANTS_GOV_LIVE_POOL_COMPANY_ID = 'RUN'

export interface LiveGrantsGovRunContext {
  runId: string
  domain: 'funding'
  scenario: 'live'
  requestedAt: string
  sector: DiscoverySector
  keyword: string
  location: DiscoveryLocation
  oppStatuses: string
  limit: number
}

export interface LiveGrantsGovRunSelection {
  sector?: DiscoverySector
  keyword?: string
  location?: DiscoveryLocation
  oppStatuses?: string
  limit?: number
}

export interface LiveGrantsGovDiscoveryStore {
  beginRun(selection?: LiveGrantsGovRunSelection): LiveGrantsGovRunContext
  runCompany(context: LiveGrantsGovRunContext, companyId: string): Promise<DiscoveryCompanyResult>
  finishRun(context: LiveGrantsGovRunContext, companies: readonly DiscoveryCompanyResult[]): DiscoveryRunOutcome
  history(): readonly DiscoveryRunOutcome[]
  reset(): void
}

export type GrantsGovBridgeClient = (request: GrantsGovBridgeSearchRequest) => Promise<GrantsGovBridgeSearchResponse>

export function defaultGrantsGovBridgeClient(): GrantsGovBridgeClient {
  return async (request) => {
    const response = await globalThis.fetch(GRANTS_GOV_BRIDGE_SEARCH_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    return (await response.json()) as GrantsGovBridgeSearchResponse
  }
}

/**
 * Builds the run-scoped registry view used by a live Grants.gov run: identical
 * to the base registry, except `SU-GRANTS-001` is presented as AVAILABLE so the
 * in-app, same-origin, fixed-endpoint, no-auth bridge can run. The base/global
 * registry (and `DEFAULT_SOURCE_REGISTRY`) is never mutated. Exported for tests.
 */
export function grantsGovLiveRegistry(base: SourceRegistry = DEFAULT_SOURCE_REGISTRY): SourceRegistry {
  return createSourceRegistry(
    base.definitions.map((definition) =>
      definition.sourceId === GRANTS_GOV_SOURCE_ID
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

export function createLiveGrantsGovDiscovery(options: {
  readonly bridge: GrantsGovBridgeClient
  readonly registry?: SourceRegistry
  readonly requestedAt?: string
}): LiveGrantsGovDiscoveryStore {
  const registry = grantsGovLiveRegistry(options.registry ?? DEFAULT_SOURCE_REGISTRY)
  let runCounter = 0
  let historyState: readonly DiscoveryRunOutcome[] = deepFreeze([])
  /**
   * Phase 20D: one in-flight/resolved bridge response per run. `runCompany`
   * awaits the SAME promise for every selected company, so a run issues exactly
   * one network search regardless of how many companies are selected.
   */
  const runResponses = new Map<string, Promise<GrantsGovBridgeSearchResponse>>()

  function nextRunId(): string {
    runCounter += 1
    return `${GRANTS_GOV_LIVE_RUN_ID_PREFIX}-${String(runCounter).padStart(4, '0')}`
  }

  /**
   * Returns the run's single Grants.gov response, issuing the bridge request on
   * first use and reusing it for every later company in the same run. A
   * transport throw becomes a REAL failure response (never an empty success).
   */
  function sharedResponseFor(context: LiveGrantsGovRunContext): Promise<GrantsGovBridgeSearchResponse> {
    const cached = runResponses.get(context.runId)
    if (cached !== undefined) return cached
    const bridgeRequest: GrantsGovBridgeSearchRequest = {
      runId: context.runId,
      companyId: GRANTS_GOV_LIVE_POOL_COMPANY_ID,
      keyword: context.keyword,
      oppStatuses: context.oppStatuses,
      limit: context.limit,
      requestedAt: context.requestedAt,
    }
    const request = Promise.resolve()
      .then(() => options.bridge(bridgeRequest))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        const failure: GrantsGovBridgeSearchResponse = {
          ok: false,
          status: 0,
          body: null,
          errors: [{ code: 'bridge_failure', message: `live Grants.gov search failed: ${message}` }],
        }
        return failure
      })
    runResponses.set(context.runId, request)
    return request
  }

  function transportFor(response: GrantsGovBridgeSearchResponse): GrantsGovTransport {
    return () => {
      if (!response.ok) {
        throw new Error(response.errors.map((error) => error.message).join('; '))
      }
      return { status: response.status, body: response.body }
    }
  }

  function dependenciesFor(adapter: SourceAdapter): DiscoveryRunDependencies {
    return { registry, adapters: Object.freeze({ [GRANTS_GOV_SOURCE_ID]: adapter }) }
  }

  /**
   * Whether this run is a broad (no-keyword) search. A blank keyword means "all
   * posted opportunities", never a per-company name substitution: company
   * selection must not artificially restrict broad discovery.
   */
  function isBroad(context: LiveGrantsGovRunContext): boolean {
    return context.keyword === ''
  }

  function inputFor(context: LiveGrantsGovRunContext, companyId: string): DiscoveryRunInput {
    const broad = isBroad(context)
    const adapterConfig: Record<string, unknown> = { rows: context.limit, broadSearch: broad }
    if (context.oppStatuses !== '') adapterConfig.oppStatuses = context.oppStatuses
    return {
      runId: `${context.runId}-${companyId}`,
      companyId,
      discoveryProfileId: GRANTS_GOV_LIVE_PROFILE_ID,
      domain: context.domain,
      requestedAt: context.requestedAt,
      sourceIds: [GRANTS_GOV_SOURCE_ID],
      queryTerms: [broad ? '*' : context.keyword],
      exclusions: [],
      sector: context.sector,
      keyword: context.keyword,
      location: context.location,
      adapterConfig,
    }
  }

  function validateContext(context: LiveGrantsGovRunContext): void {
    if (context.domain !== 'funding') {
      throw new Error(`live Grants.gov discovery is funding-only: ${String(context.domain)}`)
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
    beginRun(selection: LiveGrantsGovRunSelection = {}): LiveGrantsGovRunContext {
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
      const limit = selection.limit ?? GRANTS_GOV_LIVE_DEFAULT_LIMIT
      if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1 || limit > 100) {
        throw new Error(`live Grants.gov limit must be between 1 and 100: ${String(limit)}`)
      }
      return deepFreeze({
        runId: nextRunId(),
        domain: 'funding',
        scenario: 'live',
        requestedAt: options.requestedAt ?? nowIso(),
        sector,
        keyword: (selection.keyword ?? '').trim().toLowerCase(),
        location,
        oppStatuses: selection.oppStatuses ?? GRANTS_GOV_LIVE_DEFAULT_STATUSES,
        limit,
      })
    },

    async runCompany(context: LiveGrantsGovRunContext, companyId: string): Promise<DiscoveryCompanyResult> {
      validateContext(context)
      if (typeof companyId !== 'string' || companyId.trim().length === 0) {
        throw new Error('company id must not be blank')
      }
      const cleaned = companyId.trim()

      // Phase 20D: one search per run, replayed for each selected company.
      const response = await sharedResponseFor(context)

      const adapter = createGrantsGovAdapter({ transport: transportFor(response), registry })
      const input = inputFor(context, cleaned)
      const result = orchestrateDiscoveryRun(input, dependenciesFor(adapter))
      // The source applies the keyword across its own searchable fields, so the
      // adapter's results are authoritative. Re-filtering by a title substring
      // here was WRONG and dropped real source matches (Phase 20E): every record
      // the source returned flows through the pipeline.
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
      context: LiveGrantsGovRunContext,
      companies: readonly DiscoveryCompanyResult[],
    ): DiscoveryRunOutcome {
      validateContext(context)
      if (companies.length === 0) {
        throw new Error('a live Grants.gov run needs at least one company result')
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

export const liveGrantsGovDiscoveryStore = createLiveGrantsGovDiscovery({
  bridge: defaultGrantsGovBridgeClient(),
})
