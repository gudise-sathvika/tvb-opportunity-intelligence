/**
 * Discovery run: the single enforcement point for the Phase A architecture
 * boundaries (Architecture §15–§17 / Phase B brief §6, §9, §12).
 *
 * `gateDiscovery` implements the access and identity gate — nothing reaches the
 * adapter unless every gate passes. A run starts as NOT_RUN, is gated to READY
 * (or BLOCKED), and only then executes to a terminal SUCCESS / PARTIAL / FAILED
 * state. Access states are authoritative here: RESTRICTED / UNAVAILABLE /
 * UNKNOWN are BLOCKED before any adapter call, and the adapter's returned domain
 * and access state are sealed to the request and the registry so a procurement
 * result can never silently become a funding candidate.
 */

import type { AdapterResult } from './types'
import type { DiscoveryRequest } from './request'
import { validateDiscoveryRequest } from './request'
import type { SourceAdapter } from './adapter'
import { blockedResult, executedResult } from './adapter'
import type { SourceRegistry } from './registry'
import { sourceAppliesTo } from './registry'

export interface DiscoveryDependencies {
  registry: SourceRegistry
  adapter: SourceAdapter
}

export interface PendingRun {
  readonly request: DiscoveryRequest
  readonly status: 'NOT_RUN'
}

export type GateResult =
  | { readonly status: 'READY' }
  | { readonly status: 'BLOCKED'; readonly result: AdapterResult }

export function createPendingRun(request: DiscoveryRequest): PendingRun {
  return Object.freeze({ request, status: 'NOT_RUN' })
}

export function gateDiscovery(request: DiscoveryRequest, deps: DiscoveryDependencies): GateResult {
  const validated = validateDiscoveryRequest(request)
  if (!validated.ok) {
    return {
      status: 'BLOCKED',
      result: blockedResult({
        request,
        reason: 'request failed validation',
        errors: validated.errors.map((message) => ({ code: 'missing_field' as const, message })),
      }),
    }
  }

  const source = deps.registry.get(request.sourceId)
  if (!source) {
    return {
      status: 'BLOCKED',
      result: blockedResult({
        request,
        reason: 'source is not registered',
        errors: [{ code: 'unknown_source', message: `no registered source with sourceId ${request.sourceId}` }],
      }),
    }
  }

  if (!sourceAppliesTo(source.applicability, request.domain)) {
    return {
      status: 'BLOCKED',
      result: blockedResult({
        request,
        sourceName: source.name,
        accessState: source.accessState,
        adapterType: source.adapterType,
        reason: 'domain does not match the source applicability',
        errors: [
          {
            code: 'domain_mismatch',
            message: `source ${request.sourceId} applies to ${source.applicability}, not request domain ${request.domain}`,
          },
        ],
      }),
    }
  }

  if (source.accessState !== 'AVAILABLE') {
    return {
      status: 'BLOCKED',
      result: blockedResult({
        request,
        sourceName: source.name,
        accessState: source.accessState,
        adapterType: source.adapterType,
        reason: `source access state ${source.accessState} is not AVAILABLE`,
        errors: [
          {
            code: 'source_blocked',
            message: `source ${request.sourceId} has access state ${source.accessState}; unauthorized sources are never queried`,
          },
        ],
      }),
    }
  }

  if (deps.adapter.sourceId !== request.sourceId) {
    return {
      status: 'BLOCKED',
      result: blockedResult({
        request,
        sourceName: source.name,
        accessState: source.accessState,
        adapterType: deps.adapter.adapterType,
        reason: 'no adapter is bound to this source',
        errors: [
          {
            code: 'adapter_not_available',
            message: `adapter for ${deps.adapter.sourceId} cannot serve request for ${request.sourceId}`,
          },
        ],
      }),
    }
  }

  return { status: 'READY' }
}

/** Executes a gated run to a terminal state. Never returns the error as a success. */
export function runDiscovery(request: DiscoveryRequest, deps: DiscoveryDependencies): AdapterResult {
  const gate = gateDiscovery(request, deps)
  if (gate.status === 'BLOCKED') return gate.result

  const source = deps.registry.get(request.sourceId)!
  try {
    return sealAdapterResult(deps.adapter.discover(request), request, source.name, source.accessState)
  } catch (error) {
    return executedResult({
      request,
      sourceName: source.name,
      adapterType: deps.adapter.adapterType,
      accessState: source.accessState,
      results: [],
      errors: [
        {
          code: 'adapter_error',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    })
  }
}

/**
 * Seals an adapter-returned result: domain and access state are authoritative
 * from the request and the registry, so no adapter can silently relabel a
 * procurement run as funding or inflate its access state.
 */
function sealAdapterResult(
  result: AdapterResult,
  request: DiscoveryRequest,
  sourceName: string,
  accessState: AdapterResult['accessState'],
): AdapterResult {
  return executedResult({
    request,
    sourceName,
    adapterType: result.adapterType ?? 'unknown',
    accessState: accessState ?? 'UNKNOWN',
    results: result.results ?? [],
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
  })
}