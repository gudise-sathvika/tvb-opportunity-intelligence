/**
 * Phase 4 TED bridge — Node-side request handler.
 *
 * This module sits on the Vite dev and preview servers (`plugin.ts`) and is
 * the ONE place a real TED search can be executed safely: the browser only
 * talks to this same-origin endpoint, and only HERE does `createFetchTransport`
 * — the codebase's single live network caller — perform its POST. The bridge
 * never writes anything and never downloads documents: one read-only search
 * per request, returning the raw status + body unchanged.
 *
 * The request body carries only discovery parameters. The endpoint and the
 * source are FIXED here (`TED_SEARCH_ENDPOINT`, `TED_SOURCE_ID`), so a
 * browser can never redirect the server toward another host, and the query is
 * built with the REAL adapter query planner (`buildTedQueryPlan`) so the
 * keyword and the supported `adapterConfig` filters (publishedSince, limit)
 * are honored exactly, with the same warnings.
 *
 * Honesty: any handler-side failure returns explicit `errors` and is NEVER
 * converted into an empty successful search. The browser's adapter receives
 * either the genuine source response or a thrown transport error it reports
 * as FAILED through the normal pipeline.
 */

import type { DiscoveryRequest } from '../../automation/request'
import { createDiscoveryRequest } from '../../automation/request'
import { TED_SOURCE_ID } from '../../automation/registry'
import { TED_SEARCH_ENDPOINT, buildTedQueryPlan, buildTedSearchBody } from '../../automation/ted-adapter'
import type { TedTransport } from '../../automation/ted-adapter'
import { createFetchTransport } from '../fetch-transport'
import { clampSearchLimit } from '../http-boundary'
import type { TedBridgeError, TedBridgeSearchRequest, TedBridgeSearchResponse } from './contract'

export const TED_BRIDGE_PROFILE_ID = 'DP-LIVE-001'
export const TED_BRIDGE_DEFAULT_LIMIT = 10

export interface TedBridgeResult {
  readonly httpStatus: number
  readonly body: TedBridgeSearchResponse
}

function okBody(status: number, body: string): TedBridgeSearchResponse {
  return { ok: true, status, body }
}

function failureBody(status: number, errors: readonly TedBridgeError[], body: string | null = null): TedBridgeSearchResponse {
  return { ok: false, status, body, errors }
}

function reject(status: number, errors: readonly TedBridgeError[]): TedBridgeResult {
  return { httpStatus: status, body: failureBody(status, errors) }
}

type BuildOutcome =
  | { readonly kind: 'request'; readonly request: DiscoveryRequest }
  | { readonly kind: 'error'; readonly result: TedBridgeResult }

/**
 * Builds the single live request. Validation failures return an explicit,
 * honest error object rather than a guess (never an empty success).
 */
function buildRequest(value: TedBridgeSearchRequest | null): BuildOutcome {
  if (value === null || typeof value !== 'object') {
    return { kind: 'error', result: reject(400, [{ code: 'malformed_request', message: 'request body must be an object' }]) }
  }
  const fields = value as unknown as Record<string, unknown>
  const runId = typeof fields.runId === 'string' ? fields.runId.trim() : ''
  const companyId = typeof fields.companyId === 'string' ? fields.companyId.trim() : ''
  const requestedAt = typeof fields.requestedAt === 'string' ? fields.requestedAt.trim() : ''
  if (runId === '' || companyId === '' || requestedAt === '') {
    return {
      kind: 'error',
      result: reject(400, [{ code: 'invalid_request', message: 'runId, companyId, and requestedAt are required non-empty strings' }]),
    }
  }

  const rawKeyword = typeof fields.keyword === 'string' ? fields.keyword : ''
  const keyword = rawKeyword.trim()
  if (keyword === '') {
    return {
      kind: 'error',
      result: reject(400, [{ code: 'invalid_request', message: 'a keyword is required for a live TED search' }]),
    }
  }

  const rawLimit = fields.limit
  const limit = clampSearchLimit(rawLimit, TED_BRIDGE_DEFAULT_LIMIT)

  const rawSince = fields.publishedSince
  const publishedSince = typeof rawSince === 'string' ? rawSince.trim() : ''

  const adapterConfig: Record<string, unknown> = { limit }
  if (publishedSince !== '') adapterConfig.publishedSince = publishedSince

  const input: DiscoveryRequest = {
    runId: `${runId}-${companyId}`,
    companyId,
    discoveryProfileId: TED_BRIDGE_PROFILE_ID,
    sourceId: TED_SOURCE_ID,
    domain: 'procurement',
    queryTerms: [keyword],
    exclusions: [],
    requestedAt,
    keyword,
    adapterConfig,
  }

  try {
    return { kind: 'request', request: createDiscoveryRequest(input) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', result: reject(400, [{ code: 'invalid_request', message }]) }
  }
}

export interface TedBridgeHandleOptions {
  /** Injectable transport for tests; defaults to the single live fetch transport. */
  readonly transport?: TedTransport
}

/**
 * Handles one same-origin live TED search request. Performs exactly one
 * read-only POST to the official TED search endpoint through the single
 * live transport; the response (status + raw body) is returned unchanged.
 */
export async function handleTedBridge(
  value: TedBridgeSearchRequest | null,
  options: TedBridgeHandleOptions = {},
): Promise<TedBridgeResult> {
  const built = buildRequest(value)
  if (built.kind === 'error') return built.result
  const request = built.request

  const planResult = buildTedQueryPlan(request)
  if (!planResult.ok) {
    return reject(400, [{ code: 'invalid_request', message: planResult.message }])
  }

  const body = buildTedSearchBody(planResult.plan)
  const transport = options.transport ?? createFetchTransport()
  try {
    const answer = await transport(TED_SEARCH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    return { httpStatus: answer.status >= 200 && answer.status < 300 ? 200 : answer.status, body: okBody(answer.status, answer.body) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return reject(502, [{ code: 'source_failure', message: `live TED search failed: ${message}` }])
  }
}