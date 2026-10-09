/**
 * SourceAdapter contract and AdapterResult construction (Architecture §8–§9,
 * §16 / Phase B brief §5, §6, §8).
 *
 * An adapter is a boundary object bound to one source id. It returns raw,
 * unmodified source results through the shared AdapterResult envelope. It must
 * not create or modify vault records, create matches or bids, or classify
 * candidates into final vault records — classification is a later stage. This
 * module depends only on `types.ts` and `request.ts`, never on the import
 * pipeline or any vault writer.
 */

import type { DiscoveryRequest } from './request'
import {
  type AccessState,
  type AdapterResult,
  type ExecutionError,
  type ExecutionState,
  type RawResult,
} from './types'

export interface SourceAdapter {
  readonly sourceId: string
  readonly adapterType: string
  discover(request: DiscoveryRequest): AdapterResult
}

/**
 * Single derivation rule for the terminal execution state of a completed
 * adapter run (brief §6 and Architecture §16's error/access model):
 *  - no errors                       → SUCCESS (even zero results, which is only
 *                                      legal because the access gate already
 *                                      proved the source is AVAILABLE)
 *  - errors with some results        → PARTIAL
 *  - errors with no results          → FAILED
 */
export function deriveExecutionState(results: readonly unknown[], errors: readonly unknown[]): ExecutionState {
  if (errors.length === 0) return 'SUCCESS'
  return results.length > 0 ? 'PARTIAL' : 'FAILED'
}

export interface ExecutedResultArgs {
  request: DiscoveryRequest
  sourceName: string
  adapterType: string
  accessState: AccessState
  results: readonly RawResult[]
  errors: readonly ExecutionError[]
  warnings?: readonly string[]
}

/** Builds a terminal adapter result for a run whose gate passed. */
export function executedResult(args: ExecutedResultArgs): AdapterResult {
  const { request, sourceName, adapterType, accessState, results, errors, warnings = [] } = args
  const observedAt = request.requestedAt
  const result: AdapterResult = {
    status: deriveExecutionState(results, errors),
    sourceId: request.sourceId,
    adapterType,
    runId: request.runId,
    domain: request.domain,
    accessState,
    requestedAt: request.requestedAt,
    observedAt,
    blockedReason: null,
    results,
    errors,
    warnings,
    provenance: {
      runId: request.runId,
      companyId: request.companyId,
      discoveryProfileId: request.discoveryProfileId,
      sourceId: request.sourceId,
      sourceName,
      sourceUrl: results.length > 0 ? results[0].sourceUrl : null,
      adapterType,
      domain: request.domain,
      accessState,
      requestedAt: request.requestedAt,
      observedAt,
    },
  }
  return deepFreeze(result)
}

export interface BlockedResultArgs {
  request?: DiscoveryRequest | null
  sourceName?: string | null
  accessState?: AccessState | null
  adapterType?: string | null
  reason: string
  errors: readonly ExecutionError[]
}

/** Builds a BLOCKED result. Never carries fabricated results. */
export function blockedResult(args: BlockedResultArgs): AdapterResult {
  const request = args.request ?? null
  const result: AdapterResult = {
    status: 'BLOCKED',
    sourceId: request ? request.sourceId : null,
    adapterType: args.adapterType ?? null,
    runId: request ? request.runId : null,
    domain: request ? request.domain : null,
    accessState: args.accessState ?? null,
    requestedAt: request ? request.requestedAt : null,
    observedAt: request ? request.requestedAt : 'unknown',
    blockedReason: args.reason,
    results: [],
    errors: args.errors,
    warnings: [],
    provenance: {
      runId: request ? request.runId : null,
      companyId: request ? request.companyId : null,
      discoveryProfileId: request ? request.discoveryProfileId : null,
      sourceId: request ? request.sourceId : null,
      sourceName: args.sourceName ?? null,
      sourceUrl: null,
      adapterType: args.adapterType ?? null,
      domain: request ? request.domain : null,
      accessState: args.accessState ?? null,
      requestedAt: request ? request.requestedAt : null,
      observedAt: request ? request.requestedAt : 'unknown',
    },
  }
  return deepFreeze(result)
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