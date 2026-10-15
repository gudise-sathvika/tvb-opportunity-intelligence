/**
 * Phase 03A FTS bridge — Node-side request handler.
 *
 * This module sits on the Vite dev and preview servers (`plugin.ts`) and is
 * the ONE place a real UK Find a Tender Service search can be executed
 * safely: the browser only talks to this same-origin endpoint, and only HERE
 * does `createFetchTransport` — the codebase's single live network caller —
 * perform its GET. The bridge never writes anything and never downloads
 * documents: one read-only search per request, returning the raw status +
 * body unchanged.
 *
 * The request body carries only discovery parameters. The endpoint and the
 * source are FIXED here (`FTS_SEARCH_ENDPOINT`, `FTS_SOURCE_ID`), so a
 * browser can never redirect the server toward another host, and the query is
 * built with the REAL adapter query planner (`buildFtsQueryPlan`) so the
 * limit is honored exactly, with the same warnings.
 *
 * The search is deliberately broad (latest published notices, no keyword):
 * the OCDS release-packages feed has no keyword search, and the adapter maps
 * whatever the feed returns. Filtering by keyword happens downstream on
 * candidate titles, exactly like the TED path.
 *
 * Honesty: any handler-side failure returns explicit `errors` and is NEVER
 * converted into an empty successful search. The browser's adapter receives
 * either the genuine source response or a thrown transport error it reports
 * as FAILED through the normal pipeline.
 */

import type { DiscoveryRequest } from '../../automation/request'
import { createDiscoveryRequest } from '../../automation/request'
import { FTS_SOURCE_ID } from '../../automation/registry'
import { buildFtsQueryPlan, buildFtsSearchUrl } from '../../automation/fts-adapter'
import type { FtsTransport } from '../../automation/fts-adapter'
import { createFetchTransport } from '../fetch-transport'
import { clampSearchLimit } from '../http-boundary'
import type { FtsBridgeError, FtsBridgeSearchRequest, FtsBridgeSearchResponse } from './contract'

export const FTS_BRIDGE_PROFILE_ID = 'DP-LIVE-FTS-001'
export const FTS_BRIDGE_DEFAULT_LIMIT = 10

export interface FtsBridgeResult {
  readonly httpStatus: number
  readonly body: FtsBridgeSearchResponse
}

function okBody(status: number, body: string): FtsBridgeSearchResponse {
  return { ok: true, status, body }
}

function failureBody(
  status: number,
  errors: readonly FtsBridgeError[],
  body: string | null = null,
): FtsBridgeSearchResponse {
  return { ok: false, status, body, errors }
}

function reject(status: number, errors: readonly FtsBridgeError[]): FtsBridgeResult {
  return { httpStatus: status, body: failureBody(status, errors) }
}

type BuildOutcome =
  | { readonly kind: 'request'; readonly request: DiscoveryRequest }
  | { readonly kind: 'error'; readonly result: FtsBridgeResult }

/**
 * Builds the single live request. Validation failures return an explicit,
 * honest error object rather than a guess (never an empty success).
 */
function buildRequest(value: FtsBridgeSearchRequest | null): BuildOutcome {
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

  const rawLimit = fields.limit
  const limit = clampSearchLimit(rawLimit, FTS_BRIDGE_DEFAULT_LIMIT)

  const input: DiscoveryRequest = {
    runId: `${runId}-${companyId}`,
    companyId,
    discoveryProfileId: FTS_BRIDGE_PROFILE_ID,
    sourceId: FTS_SOURCE_ID,
    domain: 'procurement',
    queryTerms: ['*'],
    exclusions: [],
    requestedAt,
    keyword: '',
    adapterConfig: { limit },
  }

  try {
    return { kind: 'request', request: createDiscoveryRequest(input) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', result: reject(400, [{ code: 'invalid_request', message }]) }
  }
}

export interface FtsBridgeHandleOptions {
  /** Injectable transport for tests; defaults to the single live fetch transport. */
  readonly transport?: FtsTransport
}

/**
 * Handles one same-origin live FTS search request. Performs exactly one
 * read-only GET against the official Find a Tender OCDS endpoint through the
 * single live transport; the response (status + raw body) is returned
 * unchanged.
 */
export async function handleFtsBridge(
  value: FtsBridgeSearchRequest | null,
  options: FtsBridgeHandleOptions = {},
): Promise<FtsBridgeResult> {
  const built = buildRequest(value)
  if (built.kind === 'error') return built.result
  const request = built.request

  const planResult = buildFtsQueryPlan(request)
  if (!planResult.ok) {
    return reject(400, [{ code: 'invalid_request', message: planResult.message }])
  }

  const url = buildFtsSearchUrl(planResult.plan)
  const transport = options.transport ?? createFetchTransport()
  try {
    const answer = await transport(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    return { httpStatus: answer.status >= 200 && answer.status < 300 ? 200 : answer.status, body: okBody(answer.status, answer.body) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return reject(502, [{ code: 'source_failure', message: `live Find a Tender search failed: ${message}` }])
  }
}
