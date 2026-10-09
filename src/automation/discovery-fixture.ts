/**
 * Phase G Discovery Control Panel fixture orchestration (Phase G brief §5–§8).
 *
 * The control panel is a thin surface over the REAL Phase D orchestrator. This
 * module constructs deterministic DiscoveryRunInputs for the EXISTING fixture
 * sources and executes them through `orchestrateDiscoveryRun` — the same pure
 * pipeline the automation tests use. Nothing is reimplemented here: no
 * normalization, classification, deduplication, or source gating, and no source
 * adapter other than `createFixtureAdapter` is ever bound.
 *
 * Every run carries exactly one domain (funding → Grants, procurement → RFBs)
 * and requests only that domain's fixture source, so candidate separation is
 * structural: a Grants run can never surface an RFB listing and vice versa.
 *
 * Discovery semantics (§8, §13): each selected company runs the fixture source
 * for the run's domain, and the run's review handoff is the REAL Phase E queue
 * built over every candidate. The queue keeps each company's finding (Phase C
 * occurrence-indexed ids), so a Grants run over three companies hands three
 * review items — one per company, exactly the numbers the fixtures produce.
 *
 * Phase H filters: the selection may carry a sector, keyword, and location.
 * All three ride the run input into each source-level DiscoveryRequest
 * (received, not acted on, by the fixture adapter) and are echoed on the
 * context and outcome. Only the keyword narrows fixture candidates — exact,
 * case-insensitive substring matching on the normalized title — because the
 * fixture listings carry no sector or location attributes to match against.
 * Sector/location are recorded and displayed so the workflow demonstrates
 * end to end; no candidates are invented.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, socket, scheduler, or vault write of any
 *    kind — every id and timestamp is a fixed constant;
 *  - imports are sibling `src/automation` modules only;
 *  - the store surface (`beginRun` / `runCompany` / `finishRun` / `history` /
 *    `reset`) is the seam a real discovery back-end can later slot into
 *    without touching the UI.
 */

import type { SourceAdapter } from './adapter'
import { deepFreeze } from './candidate'
import type { DiscoveryCandidate } from './candidate'
import { createFixtureAdapter } from './fixture-adapter'
import { deriveRunOutcome, orchestrateDiscoveryRun } from './orchestrator'
import type {
  DiscoveryRunCounts,
  DiscoveryRunDependencies,
  DiscoveryRunInput,
  SourceRunResult,
} from './orchestrator'
import type { PipelineOutcome } from './pipeline'
import {
  DEFAULT_SOURCE_REGISTRY,
  FIXTURE_FUNDING_SOURCE_ID,
  FIXTURE_PROCUREMENT_SOURCE_ID,
} from './registry'
import { reviewFixtureStore } from './review-fixture'
import { createReviewQueue, reviewStatusForCandidate } from './review-queue'
import type { ReviewItem } from './review-queue'
import { DISCOVERY_DOMAINS } from './types'
import type { DiscoveryDomain } from './types'

/* ------------------------------------------------------------------ */
/* Fixed fixture constants                                             */
/* ------------------------------------------------------------------ */

export const DISCOVERY_FIXTURE_REQUESTED_AT = '2026-10-07T00:00:00.000Z'
export const DISCOVERY_FIXTURE_PROFILE_ID = 'DP-G-001'

/**
 * The panel's fixture scenarios. `standard` is the plain adapter; `partial`,
 * `failure`, and `empty` are the documented fixture-adapter scenarios, and
 * `blocked` leaves the fixture source without a bound adapter so the REAL
 * orchestrator reports BLOCKED (`adapter_not_available`) — no live source is
 * ever involved.
 */
export const DISCOVERY_FIXTURE_SCENARIOS = ['standard', 'partial', 'failure', 'blocked', 'empty'] as const
export type DiscoveryFixtureScenario = (typeof DISCOVERY_FIXTURE_SCENARIOS)[number]

/**
 * The scenario marker carried on run outcomes. Fixture runs use one of
 * `DISCOVERY_FIXTURE_SCENARIOS`; a live source run (Phase 4, driven through
 * the same orchestrator) is marked `'live'` so provenance stays honest. The
 * marker is carried but never rendered by the control panel.
 */
export type DiscoveryRunScenario = DiscoveryFixtureScenario | 'live'

/**
 * Phase H filter vocabularies. Sectors are the founder's fixed nine plus the
 * unfiltered default; locations are the fallback list from the brief because
 * the fixture/demo data provides no reliable location vocabulary of its own
 * (fixture listings carry country 'Wonderland' or nothing at all). Both lists
 * stay small by design.
 */
export const DISCOVERY_SECTORS = [
  'all',
  'infrastructure',
  'transportation',
  'construction',
  'engineering',
  'technology',
  'healthcare',
  'energy',
  'agriculture',
  'other',
] as const
export type DiscoverySector = (typeof DISCOVERY_SECTORS)[number]

export const DISCOVERY_LOCATIONS = ['all', 'usa', 'india', 'other'] as const
export type DiscoveryLocation = (typeof DISCOVERY_LOCATIONS)[number]

export interface DiscoveryRunSelection {
  domain: DiscoveryDomain
  scenario?: DiscoveryFixtureScenario
  requestedAt?: string
  /** Phase H: optional sector filter; defaults to 'all' (no filtering). */
  sector?: DiscoverySector
  /** Phase H: optional free-text filter; trimmed, empty means no filtering. */
  keyword?: string
  /** Phase H: optional location filter; defaults to 'all' (no filtering). */
  location?: DiscoveryLocation
}

export interface DiscoveryRunContext {
  runId: string
  domain: DiscoveryDomain
  scenario: DiscoveryFixtureScenario
  requestedAt: string
  /** Normalized Phase H filters (sector/location validated, keyword trimmed). */
  sector: DiscoverySector
  keyword: string
  location: DiscoveryLocation
}

export interface DiscoveryCompanyResult {
  companyId: string
  domain: DiscoveryDomain
  runId: string
  requestedAt: string
  completedAt: string
  scenario: DiscoveryRunScenario
  outcome: PipelineOutcome
  counts: DiscoveryRunCounts
  /** Candidates a human must review for this company, from the review queue. */
  needsReview: number
  sourceResults: readonly SourceRunResult[]
  candidates: readonly DiscoveryCandidate[]
}

export interface DiscoveryRunOutcome {
  runId: string
  domain: DiscoveryDomain
  scenario: DiscoveryRunScenario
  requestedAt: string
  completedAt: string
  companyIds: readonly string[]
  companies: readonly DiscoveryCompanyResult[]
  counts: DiscoveryRunCounts
  /** Run-level count of review items handed to the queue. */
  needsReview: number
  outcome: PipelineOutcome
  reviewQueue: readonly ReviewItem[]
  /** The normalized Phase H filters this run was requested with. */
  sector: DiscoverySector
  keyword: string
  location: DiscoveryLocation
}

export interface DiscoveryFixtureStore {
  beginRun(selection: DiscoveryRunSelection): DiscoveryRunContext
  runCompany(context: DiscoveryRunContext, companyId: string): DiscoveryCompanyResult
  finishRun(context: DiscoveryRunContext, companies: readonly DiscoveryCompanyResult[]): DiscoveryRunOutcome
  history(): readonly DiscoveryRunOutcome[]
  reset(): void
}

/* ------------------------------------------------------------------ */
/* Adapter wiring                                                      */
/* ------------------------------------------------------------------ */

function sourceIdFor(domain: DiscoveryDomain): string {
  return domain === 'funding' ? FIXTURE_FUNDING_SOURCE_ID : FIXTURE_PROCUREMENT_SOURCE_ID
}

const FIXTURE_ADAPTERS: Readonly<Record<string, SourceAdapter>> = Object.freeze({
  [FIXTURE_PROCUREMENT_SOURCE_ID]: createFixtureAdapter(FIXTURE_PROCUREMENT_SOURCE_ID),
  [FIXTURE_FUNDING_SOURCE_ID]: createFixtureAdapter(FIXTURE_FUNDING_SOURCE_ID),
})

function dependenciesFor(scenario: DiscoveryFixtureScenario): DiscoveryRunDependencies {
  return {
    registry: DEFAULT_SOURCE_REGISTRY,
    adapters: scenario === 'blocked' ? Object.freeze({}) : FIXTURE_ADAPTERS,
  }
}

function adapterConfigFor(scenario: DiscoveryFixtureScenario): DiscoveryRunInput['adapterConfig'] {
  if (scenario === 'partial' || scenario === 'failure' || scenario === 'empty') {
    return { scenario } as DiscoveryRunInput['adapterConfig']
  }
  return undefined
}

function inputFor(context: DiscoveryRunContext, companyId: string): DiscoveryRunInput {
  const input: DiscoveryRunInput = {
    runId: `${context.runId}-${companyId}`,
    companyId,
    discoveryProfileId: DISCOVERY_FIXTURE_PROFILE_ID,
    domain: context.domain,
    requestedAt: context.requestedAt,
    sourceIds: [sourceIdFor(context.domain)],
    queryTerms: [companyId],
    sector: context.sector,
    keyword: context.keyword,
    location: context.location,
  }
  const adapterConfig = adapterConfigFor(context.scenario)
  if (adapterConfig !== undefined) input.adapterConfig = adapterConfig
  return input
}

/* ------------------------------------------------------------------ */
/* Run execution                                                       */
/* ------------------------------------------------------------------ */

/** The review-status count for one candidate, from the Phase E contract. */
function candidateNeedsReview(candidate: DiscoveryCandidate): boolean {
  return reviewStatusForCandidate(candidate) === 'NEEDS_REVIEW'
}

/**
 * Phase H fixture keyword matching. The fixture listings carry no sector or
 * location attributes (country is 'Wonderland' or absent), so sector and
 * location are recorded on the request but cannot narrow fixture candidates —
 * no candidates are invented to pretend otherwise. The keyword, already
 * normalized by beginRun, must appear exactly (case-insensitively, no
 * stemming, no fuzzy matching) in the candidate's whitespace-normalized
 * source title. An empty keyword matches everything.
 */
function matchesKeyword(candidate: DiscoveryCandidate, keyword: string): boolean {
  if (keyword === '') return true
  return candidate.sourceTitle.toLowerCase().includes(keyword)
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

function validateContext(context: DiscoveryRunContext): void {
  if (!DISCOVERY_DOMAINS.includes(context.domain)) {
    throw new Error(`invalid discovery domain: ${String(context.domain)}`)
  }
  if (!(DISCOVERY_FIXTURE_SCENARIOS as readonly string[]).includes(context.scenario)) {
    throw new Error(`invalid fixture scenario: ${String(context.scenario)}`)
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

/* ------------------------------------------------------------------ */
/* Store state                                                         */
/* ------------------------------------------------------------------ */

let runCounter = 0
let historyState: readonly DiscoveryRunOutcome[] = deepFreeze([])

function nextRunId(): string {
  runCounter += 1
  return `RUN-G-${String(runCounter).padStart(4, '0')}`
}

export function beginRun(selection: DiscoveryRunSelection): DiscoveryRunContext {
  if (!DISCOVERY_DOMAINS.includes(selection.domain)) {
    throw new Error(`invalid discovery domain: ${String(selection.domain)}`)
  }
  const scenario = selection.scenario ?? 'standard'
  if (!(DISCOVERY_FIXTURE_SCENARIOS as readonly string[]).includes(scenario)) {
    throw new Error(`invalid fixture scenario: ${String(scenario)}`)
  }
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
  return deepFreeze({
    runId: nextRunId(),
    domain: selection.domain,
    scenario,
    requestedAt: selection.requestedAt ?? DISCOVERY_FIXTURE_REQUESTED_AT,
    sector,
    keyword: (selection.keyword ?? '').trim().toLowerCase(),
    location,
  })
}

export function runCompany(context: DiscoveryRunContext, companyId: string): DiscoveryCompanyResult {
  validateContext(context)
  if (typeof companyId !== 'string' || companyId.trim().length === 0) {
    throw new Error('company id must not be blank')
  }
  const cleaned = companyId.trim()
  const result = orchestrateDiscoveryRun(inputFor(context, cleaned), dependenciesFor(context.scenario))
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
}

export function finishRun(context: DiscoveryRunContext, companies: readonly DiscoveryCompanyResult[]): DiscoveryRunOutcome {
  validateContext(context)
  if (companies.length === 0) {
    throw new Error('a discovery run needs at least one company result')
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
  // Review handoff: the run's candidates enter the real Phase E queue backing
  // the Human review page. The queue is keyed first, so replaying or re-running
  // the same candidates never duplicates an existing review item.
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
}

export const discoveryFixtureStore: DiscoveryFixtureStore = {
  beginRun,
  runCompany,
  finishRun,
  history(): readonly DiscoveryRunOutcome[] {
    return historyState
  },
  reset(): void {
    historyState = deepFreeze([])
    runCounter = 0
  },
}