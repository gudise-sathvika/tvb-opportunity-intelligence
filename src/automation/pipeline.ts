/**
 * Discovery candidate pipeline (Phase C brief §10–§12).
 *
 * `buildPipelineResult` is the pure, testable composition of the four stages:
 * transform → normalize → classify → dedup — over a sealed AdapterResult.
 * `runCandidatePipeline` wires it to a DiscoveryRequest + adapter exactly as
 * a real run would: it delegates to the Phase B discovery runner (which
 * enforces the access gate), so the pipeline can never bypass a BLOCKED
 * source or fabricate results.
 *
 * Outcomes (brief §12): SUCCESS / NO_RESULTS / PARTIAL / BLOCKED / FAILED.
 * A successful-but-empty run is NO_RESULTS and is deliberately distinct from
 * BLOCKED and FAILED. A PARTIAL run keeps its per-item errors. Blocked and
 * failed runs produce no candidates.
 */

import type { AccessState, AdapterResult, DiscoveryDomain, ResultProvenance } from './types'
import type { DiscoveryRequest } from './request'
import type { SourceAdapter } from './adapter'
import type { SourceRegistry } from './registry'
import { runDiscovery } from './discovery-run'
import type { DiscoveryCandidate } from './candidate'
import { transformAdapterResult } from './transform'
import { normalizeCandidate } from './normalize'
import { classifyCandidate } from './classify'
import { deduplicateCandidates } from './dedup'

export const PIPELINE_OUTCOMES = ['SUCCESS', 'NO_RESULTS', 'PARTIAL', 'BLOCKED', 'FAILED'] as const
export type PipelineOutcome = (typeof PIPELINE_OUTCOMES)[number]

/**
 * Stage-level counts. `blocked` counts candidates whose normalization failed
 * plus the run itself when the outcome is BLOCKED (the run is the thing that
 * was blocked). `failed` counts the run when the outcome is FAILED.
 */
export interface PipelineStageCounts {
  candidatesReceived: number
  candidatesCreated: number
  normalized: number
  classified: number
  distinct: number
  duplicates: number
  possibleDuplicates: number
  blocked: number
  failed: number
}

export interface DiscoveryPipelineResult {
  outcome: PipelineOutcome
  runId: string | null
  sourceId: string | null
  sourceName: string | null
  domain: DiscoveryDomain | null
  adapterType: string | null
  accessState: AccessState | null
  counts: PipelineStageCounts
  errors: readonly string[]
  warnings: readonly string[]
  candidates: readonly DiscoveryCandidate[]
  provenance: ResultProvenance
}

export interface PipelineDependencies {
  readonly registry: SourceRegistry
  readonly adapter: SourceAdapter
}

const ZERO_COUNTS: PipelineStageCounts = {
  candidatesReceived: 0,
  candidatesCreated: 0,
  normalized: 0,
  classified: 0,
  distinct: 0,
  duplicates: 0,
  possibleDuplicates: 0,
  blocked: 0,
  failed: 0,
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

function countsWith(candidateCounts: PipelineStageCounts, overrides: Partial<PipelineStageCounts>): PipelineStageCounts {
  return { ...candidateCounts, ...overrides }
}

/**
 * Runs the four stages over a sealed AdapterResult and returns a frozen
 * pipeline result. This is pure: it performs no I/O, so tests can pass any
 * AdapterResult — including synthetic GlobalTenders-style results — without
 * ever touching the network.
 */
export function buildPipelineResult(adapterResult: AdapterResult): DiscoveryPipelineResult {
  const base = {
    runId: adapterResult.runId,
    sourceId: adapterResult.sourceId,
    sourceName: adapterResult.provenance.sourceName,
    domain: adapterResult.domain,
    adapterType: adapterResult.adapterType,
    accessState: adapterResult.accessState,
    warnings: adapterResult.warnings,
    provenance: adapterResult.provenance,
  }

  const transformed = transformAdapterResult(adapterResult)

  if (transformed.kind === 'blocked') {
    return deepFreeze({
      ...base,
      outcome: 'BLOCKED' as const,
      counts: countsWith(ZERO_COUNTS, { blocked: 1 }),
      errors: transformed.errors,
      candidates: deepFreeze([]),
    })
  }

  if (transformed.kind === 'failed') {
    return deepFreeze({
      ...base,
      outcome: 'FAILED' as const,
      counts: countsWith(ZERO_COUNTS, { failed: 1 }),
      errors: transformed.errors,
      candidates: deepFreeze([]),
    })
  }

  if (transformed.kind === 'empty') {
    return deepFreeze({
      ...base,
      outcome: 'NO_RESULTS' as const,
      counts: countsWith(ZERO_COUNTS, {
        candidatesReceived: adapterResult.results.length,
      }),
      errors: deepFreeze([]),
      candidates: deepFreeze([]),
    })
  }

  const normalized = transformed.candidates.map(normalizeCandidate)
  const blockedCandidates = normalized.filter((candidate) => candidate.candidateStatus === 'BLOCKED')
  const surviving = normalized.filter((candidate) => candidate.candidateStatus !== 'BLOCKED')
  const classified = surviving.map(classifyCandidate)
  const deduped = deduplicateCandidates(classified)

  const finalById = new Map<string, DiscoveryCandidate>()
  for (const candidate of deduped) finalById.set(candidate.candidateId, candidate)
  for (const candidate of blockedCandidates) finalById.set(candidate.candidateId, candidate)

  const ordered: DiscoveryCandidate[] = []
  for (const candidate of transformed.candidates) {
    const final = finalById.get(candidate.candidateId)
    if (final !== undefined) ordered.push(final)
  }

  const counts: PipelineStageCounts = {
    candidatesReceived: adapterResult.results.length,
    candidatesCreated: transformed.candidates.length,
    normalized: deduped.length,
    classified: deduped.length,
    distinct: deduped.filter((candidate) => candidate.duplicate?.verdict === 'DISTINCT').length,
    duplicates: deduped.filter((candidate) => candidate.duplicate?.verdict === 'EXACT_DUPLICATE').length,
    possibleDuplicates: deduped.filter((candidate) => candidate.duplicate?.verdict === 'POSSIBLE_DUPLICATE').length,
    blocked: blockedCandidates.length,
    failed: 0,
  }

  return deepFreeze({
    ...base,
    outcome: transformed.kind === 'partial' ? ('PARTIAL' as const) : ('SUCCESS' as const),
    counts,
    errors: transformed.errors,
    candidates: deepFreeze(ordered),
  })
}

/**
 * Runs discovery for a request through the Phase B access gate, then builds
 * the candidate pipeline result. GlobalTenders remains BLOCKED here — a
 * synthetic GlobalTenders-style result can still be exercised through
 * `buildPipelineResult` without any network access.
 */
export function runCandidatePipeline(request: DiscoveryRequest, deps: PipelineDependencies): DiscoveryPipelineResult {
  const adapterResult = runDiscovery(request, deps)
  return buildPipelineResult(adapterResult)
}