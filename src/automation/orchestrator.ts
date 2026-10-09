/**
 * Phase D discovery run orchestration (Architecture §19 / Phase D brief §3–§7).
 *
 * The orchestrator is the deterministic, single-call layer that turns explicit
 * run inputs (run/company/profile identity, domain, timestamps, source ids,
 * query terms) into a DiscoveryRun result. For EVERY requested source it:
 *   1. builds an isolated DiscoveryRequest (each source gets its own request;
 *      the run's adapterConfig is applied to every request);
 *   2. resolves the source against the Source Registry;
 *   3. binds the source's own adapter (never another source's adapter);
 *   4. executes through the Phase B access gate + Phase C candidate pipeline;
 *   5. records a per-source SourceRunResult and the run-level outcome.
 *
 * Boundaries (brief §5, §7):
 *  - GlobalTenders stays BLOCKED: it is registered with access state UNKNOWN
 *    and is never queried, whether or not an adapter happens to be bound.
 *  - blocked sources are never passed to an adapter (no discover() call), and
 *    a source with no bound adapter is never invoked — the runner uses a
 *    never-invoked stub whose discover() throws if a regression lets it through.
 *  - one failed source never erases another source's successful candidates.
 *  - no vault writes, no network, no current time: completedAt == requestedAt,
 *    run ids come from the caller, and everything is deeply frozen.
 *
 * Outcomes reuse the locked Phase C vocabulary: SUCCESS / NO_RESULTS / PARTIAL /
 * BLOCKED / FAILED. No new outcome values are introduced.
 */

import type { AccessState, DiscoveryDomain } from './types'
import { DISCOVERY_DOMAINS } from './types'
import type { DiscoveryRequest } from './request'
import { createDiscoveryRequest } from './request'
import type { SourceRegistry } from './registry'
import type { SourceAdapter } from './adapter'
import { blockedResult } from './adapter'
import type { DiscoveryPipelineResult, PipelineOutcome } from './pipeline'
import { buildPipelineResult, runCandidatePipeline } from './pipeline'
import type { DiscoveryCandidate } from './candidate'

/**
 * Explicit, caller-supplied run inputs. Identity fields and the timestamp are
 * the caller's, never generated here: the orchestrator fabricates no run id and
 * reads no clock. `sourceIds` may contain duplicates (deduplicated, order
 * preserved) but must be a non-empty array of non-empty strings.
 */
export interface DiscoveryRunInput {
  runId: string
  companyId: string
  discoveryProfileId: string
  domain: DiscoveryDomain
  requestedAt: string
  sourceIds: readonly string[]
  queryTerms: readonly string[]
  exclusions?: readonly string[]
  adapterConfig?: Readonly<Record<string, unknown>>
  /**
   * Optional Phase H discovery filters, forwarded unchanged into each
   * source-level DiscoveryRequest. The orchestrator never interprets them;
   * they ride along so a request reproduced later still carries the founder's
   * selection.
   */
  sector?: string
  keyword?: string
  location?: string
}

/**
 * Everything the orchestrator needs to run: the Source Registry (the gate of
 * record) and the map of adapters keyed by source id. A source is only ever
 * handed its own adapter; the map makes it structurally impossible to run a
 * source with a stranger's adapter.
 */
export interface DiscoveryRunDependencies {
  readonly registry: SourceRegistry
  readonly adapters: Readonly<Record<string, SourceAdapter>>
}

/**
 * Per-source record inside a DiscoveryRun. Keeps every source's own outcome,
 * counts, identities, and provenance so a multi-source run never collapses
 * sources into each other.
 */
export interface SourceRunResult {
  sourceId: string
  sourceName: string | null
  adapterType: string | null
  accessState: AccessState | null
  domain: DiscoveryDomain | null
  outcome: PipelineOutcome
  requestedAt: string | null
  observedAt: string
  candidatesReceived: number
  candidatesCreated: number
  candidatesRequiringReview: number
  duplicates: number
  candidateIds: readonly string[]
  errors: readonly string[]
  warnings: readonly string[]
}

/** Aggregated, run-level counts (never per-source counts). */
export interface DiscoveryRunCounts {
  totalSources: number
  candidatesReceived: number
  candidatesCreated: number
  candidatesRequiringReview: number
  duplicates: number
  blockedSources: number
  failedSources: number
}

/**
 * The discovery run result: run identity and timestamps, the deduplicated
 * source ids in request order, the run-level outcome, aggregate counts, the
 * per-source results, all candidates (Phase C provenance retained), and the
 * aggregated errors and warnings.
 */
export interface DiscoveryRunResult {
  runId: string
  companyId: string
  discoveryProfileId: string
  domain: DiscoveryDomain
  requestedAt: string
  completedAt: string
  sourceIds: readonly string[]
  outcome: PipelineOutcome
  counts: DiscoveryRunCounts
  sourceResults: readonly SourceRunResult[]
  candidates: readonly DiscoveryCandidate[]
  errors: readonly string[]
  warnings: readonly string[]
}

export type DiscoveryRunInputValidation =
  | { ok: true; input: DiscoveryRunInput }
  | { ok: false; errors: readonly string[] }

const ZERO_COUNTS: DiscoveryRunCounts = {
  totalSources: 0,
  candidatesReceived: 0,
  candidatesCreated: 0,
  candidatesRequiringReview: 0,
  duplicates: 0,
  blockedSources: 0,
  failedSources: 0,
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
  const object = value as Record<string, unknown>
  for (const key of Object.keys(object)) {
    const child = object[key]
    if (child !== null && typeof child === 'object') deepFreeze(child)
  }
  return Object.freeze(object) as T
}

/** Validates run inputs without mutating them; failures list field errors. */
export function validateDiscoveryRunInput(value: unknown): DiscoveryRunInputValidation {
  const errors: string[] = []

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['run input must be an object'] }
  }
  const record = value as Record<string, unknown>

  for (const field of ['runId', 'companyId', 'discoveryProfileId', 'requestedAt']) {
    if (!isNonEmptyString(record[field])) {
      errors.push(`missing required field: ${field}`)
    }
  }
  if (
    record.domain !== undefined &&
    !(DISCOVERY_DOMAINS as readonly string[]).includes(record.domain as string)
  ) {
    errors.push('invalid domain: must be funding or procurement')
  }
  if (!isStringArray(record.sourceIds) || (record.sourceIds as string[]).length === 0) {
    errors.push('field sourceIds must be a non-empty array of non-empty strings')
  }
  if (!isStringArray(record.queryTerms) || (record.queryTerms as string[]).length === 0) {
    errors.push('field queryTerms must be a non-empty array of non-empty strings')
  }
  if (record.exclusions !== undefined && !isStringArray(record.exclusions)) {
    errors.push('field exclusions must be an array of non-empty strings')
  }
  if (
    record.adapterConfig !== undefined &&
    (record.adapterConfig === null || typeof record.adapterConfig !== 'object')
  ) {
    errors.push('field adapterConfig must be an object')
  }
  for (const field of ['sector', 'keyword', 'location'] as const) {
    if (record[field] !== undefined && typeof record[field] !== 'string') {
      errors.push(`field ${field} must be a string`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  const input: DiscoveryRunInput = {
    runId: String(record.runId),
    companyId: String(record.companyId),
    discoveryProfileId: String(record.discoveryProfileId),
    domain: record.domain as DiscoveryDomain,
    requestedAt: String(record.requestedAt),
    sourceIds: [...(record.sourceIds as string[])],
    queryTerms: [...(record.queryTerms as string[])],
    exclusions: [...((record.exclusions as string[] | undefined) ?? [])],
    ...(record.adapterConfig !== undefined
      ? { adapterConfig: { ...(record.adapterConfig as Record<string, unknown>) } }
      : {}),
    ...(record.sector !== undefined ? { sector: String(record.sector) } : {}),
    ...(record.keyword !== undefined ? { keyword: String(record.keyword) } : {}),
    ...(record.location !== undefined ? { location: String(record.location) } : {}),
  }
  return { ok: true, input: deepFreeze(input) }
}

function dedupeSourceIds(sourceIds: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const sourceId of sourceIds) {
    if (!seen.has(sourceId)) {
      seen.add(sourceId)
      result.push(sourceId)
    }
  }
  return result
}

/**
 * Source-level outcome derivation. Returns the Phase C pipeline outcome as-is,
 * but defends one invariant: a source can never be reported SUCCESS with zero
 * candidates on its own — an empty success is the distinct NO_RESULTS signal.
 */
export function deriveSourceOutcome(result: DiscoveryPipelineResult): PipelineOutcome {
  if (result.outcome === 'SUCCESS' && result.candidates.length === 0) return 'NO_RESULTS'
  return result.outcome
}

/**
 * Run-level outcome derivation with documented precedence (brief §4):
 *  1. no sources ran                              → BLOCKED (defensive)
 *  2. all sources empty (NO_RESULTS)              → NO_RESULTS
 *  3. candidates and no problems at all           → SUCCESS
 *  4. candidates and any blocked/failed/partial   → PARTIAL
 *  5. blocked plus failed (no candidates)         → FAILED
 *  6. blocked only (no candidates)                → BLOCKED
 *  7. failed only (no candidates)                 → FAILED
 *  8. any other mix (no candidates)               → PARTIAL (defensive)
 */
export function deriveRunOutcome(sourceResults: readonly SourceRunResult[]): PipelineOutcome {
  if (sourceResults.length === 0) return 'BLOCKED'
  const producedCandidates = sourceResults.some((result) => result.candidatesCreated > 0)
  const hasBlocked = sourceResults.some((result) => result.outcome === 'BLOCKED')
  const hasFailed = sourceResults.some((result) => result.outcome === 'FAILED')
  const hasPartial = sourceResults.some((result) => result.outcome === 'PARTIAL')

  if (sourceResults.every((result) => result.outcome === 'NO_RESULTS') && !producedCandidates) {
    return 'NO_RESULTS'
  }
  if (producedCandidates && !hasBlocked && !hasFailed && !hasPartial) return 'SUCCESS'
  if (producedCandidates) return 'PARTIAL'
  if (hasBlocked && hasFailed) return 'FAILED'
  if (hasBlocked) return 'BLOCKED'
  if (hasFailed) return 'FAILED'
  return 'PARTIAL'
}

function requestForSource(input: DiscoveryRunInput, sourceId: string): DiscoveryRequest {
  return createDiscoveryRequest({
    runId: input.runId,
    companyId: input.companyId,
    discoveryProfileId: input.discoveryProfileId,
    sourceId,
    domain: input.domain,
    queryTerms: input.queryTerms,
    exclusions: input.exclusions ?? [],
    requestedAt: input.requestedAt,
    ...(input.adapterConfig !== undefined ? { adapterConfig: input.adapterConfig } : {}),
    ...(input.sector !== undefined ? { sector: input.sector } : {}),
    ...(input.keyword !== undefined ? { keyword: input.keyword } : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
  })
}

/**
 * A guard adapter for a source that has NO bound adapter but is NOT AVAILABLE.
 * Its discover() throws so that any future regression which lets a blocked or
 * unbound source reach an adapter fails loudly instead of fabricating results.
 */
function neverInvokedAdapter(sourceId: string, adapterType: string): SourceAdapter {
  return Object.freeze({
    sourceId,
    adapterType,
    discover: () => {
      throw new Error(`discovery must never be invoked on unbound source ${sourceId}`)
    },
  })
}

function runDiscoverySource(input: DiscoveryRunInput, sourceId: string, deps: DiscoveryRunDependencies): DiscoveryPipelineResult {
  const request = requestForSource(input, sourceId)
  const source = deps.registry.get(sourceId)

  if (source === undefined) {
    return buildPipelineResult(
      blockedResult({
        request,
        reason: 'source is not registered',
        errors: [{ code: 'unknown_source' as const, message: `no registered source with sourceId ${sourceId}` }],
      }),
    )
  }

  const adapter = deps.adapters[sourceId]
  if (adapter === undefined && source.accessState === 'AVAILABLE') {
    return buildPipelineResult(
      blockedResult({
        request,
        sourceName: source.name,
        accessState: source.accessState,
        adapterType: source.adapterType,
        reason: 'no adapter is bound to this source',
        errors: [
          {
            code: 'adapter_not_available' as const,
            message: `no adapter is bound to AVAILABLE source ${sourceId}`,
          },
        ],
      }),
    )
  }

  const bound = adapter ?? neverInvokedAdapter(sourceId, source.adapterType)
  return runCandidatePipeline(request, { registry: deps.registry, adapter: bound })
}

function sourceResultFrom(pipeline: DiscoveryPipelineResult): SourceRunResult {
  return deepFreeze({
    sourceId: pipeline.sourceId ?? '',
    sourceName: pipeline.sourceName,
    adapterType: pipeline.adapterType,
    accessState: pipeline.accessState,
    domain: pipeline.domain,
    outcome: deriveSourceOutcome(pipeline),
    requestedAt: pipeline.provenance.requestedAt,
    observedAt: pipeline.provenance.observedAt,
    candidatesReceived: pipeline.counts.candidatesReceived,
    candidatesCreated: pipeline.counts.candidatesCreated,
    candidatesRequiringReview: pipeline.candidates.filter((candidate) => candidate.candidateStatus === 'REVIEW').length,
    duplicates: pipeline.counts.duplicates,
    candidateIds: pipeline.candidates.map((candidate) => candidate.candidateId),
    errors: pipeline.errors,
    warnings: pipeline.warnings,
  })
}

function buildRunResult(
  input: DiscoveryRunInput,
  sourceIds: readonly string[],
  sourceResults: readonly SourceRunResult[],
  candidates: readonly DiscoveryCandidate[],
): DiscoveryRunResult {
  const counts: DiscoveryRunCounts = {
    totalSources: sourceResults.length,
    candidatesReceived: sourceResults.reduce((sum, result) => sum + result.candidatesReceived, 0),
    candidatesCreated: sourceResults.reduce((sum, result) => sum + result.candidatesCreated, 0),
    candidatesRequiringReview: sourceResults.reduce((sum, result) => sum + result.candidatesRequiringReview, 0),
    duplicates: sourceResults.reduce((sum, result) => sum + result.duplicates, 0),
    blockedSources: sourceResults.filter((result) => result.outcome === 'BLOCKED').length,
    failedSources: sourceResults.filter((result) => result.outcome === 'FAILED').length,
  }
  const errors: string[] = []
  const warnings: string[] = []
  for (const result of sourceResults) {
    errors.push(...result.errors)
    warnings.push(...result.warnings)
  }

  return deepFreeze({
    runId: input.runId,
    companyId: input.companyId,
    discoveryProfileId: input.discoveryProfileId,
    domain: input.domain,
    requestedAt: input.requestedAt,
    completedAt: input.requestedAt,
    sourceIds: deepFreeze(sourceIds),
    outcome: deriveRunOutcome(sourceResults),
    counts,
    sourceResults: deepFreeze([...sourceResults]),
    candidates: deepFreeze([...candidates]),
    errors: deepFreeze(errors),
    warnings: deepFreeze(warnings),
  })
}

/**
 * Result for an invalid run input: BLOCKED, no source ran, and the validation
 * errors explain why. This is a rejection, never a partial execution.
 */
function rejectedRunResult(input: unknown, errors: readonly string[]): DiscoveryRunResult {
  const record = (input !== null && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const requestedAt = typeof record.requestedAt === 'string' ? record.requestedAt : ''
  const domain = (DISCOVERY_DOMAINS as readonly string[]).includes(record.domain as string)
    ? (record.domain as DiscoveryDomain)
    : 'procurement'
  return deepFreeze({
    runId: typeof record.runId === 'string' ? record.runId : '',
    companyId: typeof record.companyId === 'string' ? record.companyId : '',
    discoveryProfileId: typeof record.discoveryProfileId === 'string' ? record.discoveryProfileId : '',
    domain,
    requestedAt,
    completedAt: requestedAt,
    sourceIds: deepFreeze([]),
    outcome: 'BLOCKED',
    counts: ZERO_COUNTS,
    sourceResults: deepFreeze([]),
    candidates: deepFreeze([]),
    errors: deepFreeze(errors),
    warnings: deepFreeze([]),
  })
}

/**
 * Runs discovery for every requested source and returns a frozen DiscoveryRun
 * result. Deterministic: the output is a pure function of the input and the
 * dependencies, completedAt always equals requestedAt, and no source's outcome
 * can erase another's.
 */
export function orchestrateDiscoveryRun(input: DiscoveryRunInput, deps: DiscoveryRunDependencies): DiscoveryRunResult {
  const validated = validateDiscoveryRunInput(input)
  if (!validated.ok) return rejectedRunResult(input, validated.errors)

  const sourceIds = dedupeSourceIds(validated.input.sourceIds)
  const sourceResults: SourceRunResult[] = []
  const candidates: DiscoveryCandidate[] = []
  for (const sourceId of sourceIds) {
    const pipeline = runDiscoverySource(validated.input, sourceId, deps)
    sourceResults.push(sourceResultFrom(pipeline))
    for (const candidate of pipeline.candidates) candidates.push(candidate)
  }

  return buildRunResult(validated.input, sourceIds, sourceResults, candidates)
}