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
 * Phase 03A: when an FTS bridge is provided, the same run ALSO issues one
 * broad latest-notices search to the UK Find a Tender Service (shared by all
 * selected companies, never company-matched) through the same-origin
 * fts-bridge, bound to the real FTS adapter. This keeps procurement runs
 * honest when the company-name TED title search legitimately returns nothing:
 * both sources' outcomes, counts, errors, and warnings stay visible
 * separately, and the shared classifier gates every record.
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
import { DEFAULT_SOURCE_REGISTRY, FTS_SOURCE_ID, TED_SOURCE_ID, createSourceRegistry } from '../automation/registry'
import { reviewFixtureStore } from '../automation/review-fixture'
import { createReviewQueue, reviewStatusForCandidate } from '../automation/review-queue'
import { partitionByActionability } from '../automation/opportunity-status'
import { createTedAdapter } from '../automation/ted-adapter'
import type { TedTransport } from '../automation/ted-adapter'
import { createFtsAdapter } from '../automation/fts-adapter'
import type { FtsTransport } from '../automation/fts-adapter'
import { TED_BRIDGE_SEARCH_PATH } from './ted-bridge/contract'
import type { TedBridgeSearchRequest, TedBridgeSearchResponse } from './ted-bridge/contract'
import { FTS_BRIDGE_SEARCH_PATH } from './fts-bridge/contract'
import type { FtsBridgeSearchRequest, FtsBridgeSearchResponse } from './fts-bridge/contract'

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

/**
 * Phase 04 shared-pool handoff rule. Candidates from the broad, non-keyworded
 * FTS feed are byte-identical for every company in the run (same notice,
 * same candidateId `DC:{sourceId}:{recordId}`), so without this step the same
 * notice would enter the review queue once per company
 * (`RI:…:NORMALIZED`, `…#1`, `…#2`, …). The first occurrence is canonical;
 * later ones are the same notice, not new evidence, and are withheld from the
 * handoff. The canonical item is attributed to the shared pool — a broad
 * notice is unassigned, never company-matched. Company-directed (TED)
 * candidates pass through untouched, as do the per-company display lists.
 * Exported for tests.
 */
export function dedupeHandoffCandidates(
  candidates: readonly DiscoveryCandidate[],
  poolSourceIds: readonly string[] = [FTS_SOURCE_ID],
  poolCompanyId: string = FTS_LIVE_POOL_COMPANY_ID,
): DiscoveryCandidate[] {
  const seen = new Set<string>()
  const handoff: DiscoveryCandidate[] = []
  for (const candidate of candidates) {
    if (!poolSourceIds.includes(candidate.sourceId)) {
      handoff.push(candidate)
      continue
    }
    if (seen.has(candidate.candidateId)) continue
    seen.add(candidate.candidateId)
    handoff.push(
      deepFreeze({
        ...candidate,
        companyId: poolCompanyId,
        provenance: { ...candidate.provenance, companyId: poolCompanyId },
      }),
    )
  }
  return handoff
}

/** Async same-origin FTS bridge client; injectable for tests. */
export type FtsBridgeClient = (request: FtsBridgeSearchRequest) => Promise<FtsBridgeSearchResponse>

export function defaultFtsBridgeClient(): FtsBridgeClient {
  return async (request) => {
    const response = await globalThis.fetch(FTS_BRIDGE_SEARCH_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    return (await response.json()) as FtsBridgeSearchResponse
  }
}

/**
 * Run-level `companyId` carried on the single shared FTS bridge request. The
 * FTS feed has no keyword search — every run fetches the same latest
 * notices — so this marker, not any company's id, is sent. It never implies
 * the results belong to a company.
 */
export const FTS_LIVE_POOL_COMPANY_ID = 'RUN'

/**
 * Builds the run-scoped registry view used when the run includes the UK Find
 * a Tender Service: identical to the base registry, except `SU-FTS-001` is
 * presented as AVAILABLE for that run, because the mounted, fixed-endpoint,
 * no-auth same-origin FTS bridge IS the read-only access path. The
 * base/global registry (and `DEFAULT_SOURCE_REGISTRY`) is never mutated.
 * Exported for tests.
 */
export function tedFtsLiveRegistry(base: SourceRegistry = DEFAULT_SOURCE_REGISTRY): SourceRegistry {
  return createSourceRegistry(
    base.definitions.map((definition) =>
      definition.sourceId === FTS_SOURCE_ID
        ? { ...definition, accessState: 'AVAILABLE' as const }
        : definition,
    ),
  )
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
  /** Optional FTS bridge. When provided, the run also queries the UK Find a
   * Tender Service (one broad latest-notices search per run, shared by every
   * selected company); when absent, the run is TED-only, exactly as before. */
  readonly ftsBridge?: FtsBridgeClient
  readonly registry?: SourceRegistry
  readonly requestedAt?: string
}): LiveTedDiscoveryStore {
  const registry = options.ftsBridge !== undefined ? tedFtsLiveRegistry(options.registry ?? DEFAULT_SOURCE_REGISTRY) : (options.registry ?? DEFAULT_SOURCE_REGISTRY)
  let runCounter = 0
  let historyState: readonly DiscoveryRunOutcome[] = deepFreeze([])
  /**
   * Phase 03A: one in-flight/resolved FTS bridge response per run. The FTS
   * feed has no keyword search, so `runCompany` awaits the SAME promise for
   * every selected company and a run issues exactly one FTS search.
   */
  const ftsRunResponses = new Map<string, Promise<FtsBridgeSearchResponse>>()

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

  function dependenciesFor(tedAdapter: SourceAdapter | undefined, ftsAdapter?: SourceAdapter): DiscoveryRunDependencies {
    const adapters: Record<string, SourceAdapter> = {}
    if (tedAdapter !== undefined) adapters[TED_SOURCE_ID] = tedAdapter
    if (ftsAdapter !== undefined) adapters[FTS_SOURCE_ID] = ftsAdapter
    return { registry, adapters: Object.freeze(adapters) }
  }

  function ftsTransportFor(response: FtsBridgeSearchResponse): FtsTransport {
    return () => {
      if (!response.ok) {
        throw new Error(response.errors.map((error) => error.message).join('; '))
      }
      return { status: response.status, body: response.body }
    }
  }

  /**
   * Returns the run's single FTS response, issuing the bridge request on
   * first use and reusing it for every later company in the same run. A
   * transport throw becomes a REAL failure response (never an empty success).
   */
  function sharedFtsResponseFor(context: LiveTedRunContext): Promise<FtsBridgeSearchResponse> {
    const cached = ftsRunResponses.get(context.runId)
    if (cached !== undefined) return cached
    const bridgeRequest: FtsBridgeSearchRequest = {
      runId: context.runId,
      companyId: FTS_LIVE_POOL_COMPANY_ID,
      limit: context.limit,
      requestedAt: context.requestedAt,
    }
    const bridge = options.ftsBridge ?? defaultFtsBridgeClient()
    const request = Promise.resolve()
      .then(() => bridge(bridgeRequest))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        const failure: FtsBridgeSearchResponse = {
          ok: false,
          status: 0,
          body: null,
          errors: [{ code: 'bridge_failure', message: `live Find a Tender search failed: ${message}` }],
        }
        return failure
      })
    ftsRunResponses.set(context.runId, request)
    return request
  }

  /**
   * Phase 34: the TED search term is the explicit keyword or nothing at all.
   * A company/supplier name is NEVER substituted: tender titles rarely contain
   * it, so the fallback manufactured confident-looking zero-result searches
   * (RUN-T-0001: `notice-title~"CapitalstackAI"` → 0 rows, HTTP 200). A null
   * term means TED cannot run for this company; the keyword-independent FTS
   * feed still runs.
   */
  function searchTermFor(context: LiveTedRunContext): string | null {
    return context.keyword !== '' ? context.keyword : null
  }

  function inputFor(context: LiveTedRunContext, companyId: string): DiscoveryRunInput {
    const adapterConfig: Record<string, unknown> = { limit: context.limit }
    if (context.publishedSince !== '') adapterConfig.publishedSince = context.publishedSince
    const term = searchTermFor(context)
    const useTed = term !== null
    const useFts = options.ftsBridge !== undefined
    return {
      runId: `${context.runId}-${companyId}`,
      companyId,
      discoveryProfileId: TED_LIVE_PROFILE_ID,
      domain: context.domain,
      requestedAt: context.requestedAt,
      sourceIds: [...(useTed ? [TED_SOURCE_ID] : []), ...(useFts ? [FTS_SOURCE_ID] : [])],
      queryTerms: [term ?? '*'],
      exclusions: [],
      sector: context.sector,
      keyword: term ?? '',
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
      const term = searchTermFor(context)
      if (term === null && options.ftsBridge === undefined) {
        throw new Error(
          'Live TED needs an explicit procurement keyword: without one there is no honest TED query to run',
        )
      }

      // Phase 34: no TED bridge call without an explicit term. A blank keyword
      // means TED does not run for this company (insufficiently specified),
      // while the keyword-independent FTS feed still runs below.
      let tedAdapter: SourceAdapter | undefined
      if (term !== null) {
        const bridgeRequest: TedBridgeSearchRequest = {
          runId: context.runId,
          companyId: cleaned,
          keyword: term,
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
        tedAdapter = createTedAdapter({ transport: transportFor(response), registry })
      }
      const input = inputFor(context, cleaned)
      let ftsAdapter: SourceAdapter | undefined
      if (options.ftsBridge !== undefined) {
        // Phase 03A: one broad FTS latest-notices search per run, replayed for
        // every selected company. The FTS feed has no keyword search, so its
        // candidates are real latest UK notices, never company-matched.
        const ftsResponse = await sharedFtsResponseFor(context)
        ftsAdapter = createFtsAdapter({ transport: ftsTransportFor(ftsResponse), registry })
      }
      const result = orchestrateDiscoveryRun(input, dependenciesFor(tedAdapter, ftsAdapter))
      const candidates = result.candidates.filter((candidate) => matchesKeyword(candidate, context.keyword))
      // Phase 23 ingest gate: only records the shared classifier marks `open`
      // may enter the actionable pool. Everything else is preserved as
      // `excludedCandidates` (never dropped) and can never be presented as an
      // open opportunity.
      const { actionable, excluded } = partitionByActionability(candidates, context.requestedAt)
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
        actionableCandidates: actionable,
        excludedCandidates: excluded,
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

      // Phase 04: the handoff is deduped across companies (shared broad FTS
      // notices yield one canonical unassigned item, not one per company).
      // Per-company display lists above are untouched.
      const reviewQueue = createReviewQueue(dedupeHandoffCandidates(allCandidates), { createdAt: context.requestedAt })
      ftsRunResponses.delete(context.runId)
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
      ftsRunResponses.clear()
    },
  }
}

export const liveDiscoveryStore = createLiveTedDiscovery({
  bridge: defaultTedBridgeClient(),
  ftsBridge: defaultFtsBridgeClient(),
})