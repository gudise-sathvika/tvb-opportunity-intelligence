/**
 * Phase 21C EU Funding & Tenders Portal (SEDIA) bridge — Node-side handler.
 *
 * Mounts on the Vite dev/preview servers (`plugin.ts`) and is the ONE place a
 * real EU search is executed server-side: the browser talks to this same-origin
 * endpoint, and only HERE does `createFetchTransport` perform its POST. One
 * read-only, unauthenticated (shared public `apiKey=SEDIA`) search per request,
 * returning the raw status + body unchanged. The multipart body and the portal
 * browser headers are built server-side; the browser never talks to the source.
 *
 * The query is built with the REAL adapter query planner (`buildEuSediaQueryPlan`)
 * so type/status filters and the broad-vs-keyword choice are honored exactly.
 * Any handler-side failure returns explicit `errors` and is NEVER converted into
 * an empty successful search. No "open call" verdict is computed here.
 */

import type { DiscoveryRequest } from '../../automation/request'
import { createDiscoveryRequest } from '../../automation/request'
import { EU_SEDIA_SOURCE_ID } from '../../automation/registry'
import {
  EU_SEDIA_CONTENT_TYPE,
  EU_SEDIA_ORIGIN,
  EU_SEDIA_REFERER,
  buildEuSediaQueryPlan,
  buildEuSediaSearchBody,
  buildEuSediaSearchUrl,
} from '../../automation/eu-sedia-adapter'
import type { EuSediaTransport } from '../../automation/eu-sedia-adapter'
import { createFetchTransport } from '../fetch-transport'
import { clampSearchLimit } from '../http-boundary'
import type { EuSediaBridgeError, EuSediaBridgeSearchRequest, EuSediaBridgeSearchResponse } from './contract'

export const EU_SEDIA_BRIDGE_PROFILE_ID = 'DP-LIVE-004'
export const EU_SEDIA_BRIDGE_DEFAULT_LIMIT = 10

export interface EuSediaBridgeResult {
  readonly httpStatus: number
  readonly body: EuSediaBridgeSearchResponse
}

/** Browser headers the EU portal itself sends with the search request. */
export const EU_SEDIA_BROWSER_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  accept: 'application/json, text/plain, */*',
  'user-agent': 'Mozilla/5.0 (compatible; TVB-Opportunity-Intelligence/1.0; +https://tvb.example)',
  referer: EU_SEDIA_REFERER,
  origin: EU_SEDIA_ORIGIN,
})

function okBody(status: number, body: string): EuSediaBridgeSearchResponse {
  return { ok: true, status, body }
}

function failureBody(
  status: number,
  errors: readonly EuSediaBridgeError[],
  body: string | null = null,
): EuSediaBridgeSearchResponse {
  return { ok: false, status, body, errors }
}

function reject(status: number, errors: readonly EuSediaBridgeError[]): EuSediaBridgeResult {
  return { httpStatus: status, body: failureBody(status, errors) }
}

type BuildOutcome =
  | { readonly kind: 'request'; readonly request: DiscoveryRequest }
  | { readonly kind: 'error'; readonly result: EuSediaBridgeResult }

function buildRequest(value: EuSediaBridgeSearchRequest | null): BuildOutcome {
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
  const broad = keyword === ''
  const limit = clampSearchLimit(fields.limit, EU_SEDIA_BRIDGE_DEFAULT_LIMIT)

  const input: DiscoveryRequest = {
    runId: `${runId}-${companyId}`,
    companyId,
    discoveryProfileId: EU_SEDIA_BRIDGE_PROFILE_ID,
    sourceId: EU_SEDIA_SOURCE_ID,
    domain: 'funding',
    queryTerms: [broad ? '*' : keyword],
    exclusions: [],
    requestedAt,
    keyword,
    adapterConfig: { rows: limit, broadSearch: broad },
  }

  try {
    return { kind: 'request', request: createDiscoveryRequest(input) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', result: reject(400, [{ code: 'invalid_request', message }]) }
  }
}

export interface EuSediaBridgeHandleOptions {
  /** Injectable transport for tests; defaults to the single live fetch transport. */
  readonly transport?: EuSediaTransport
}

export async function handleEuSediaBridge(
  value: EuSediaBridgeSearchRequest | null,
  options: EuSediaBridgeHandleOptions = {},
): Promise<EuSediaBridgeResult> {
  const built = buildRequest(value)
  if (built.kind === 'error') return built.result
  const request = built.request

  const planResult = buildEuSediaQueryPlan(request)
  if (!planResult.ok) {
    return reject(400, [{ code: 'invalid_request', message: planResult.message }])
  }

  const body = buildEuSediaSearchBody(planResult.plan)
  const transport = options.transport ?? createFetchTransport()
  try {
    const answer = await transport(buildEuSediaSearchUrl(planResult.plan), {
      method: 'POST',
      headers: { 'content-type': EU_SEDIA_CONTENT_TYPE, ...EU_SEDIA_BROWSER_HEADERS },
      body,
    })
    return {
      httpStatus: answer.status >= 200 && answer.status < 300 ? 200 : answer.status,
      body: okBody(answer.status, answer.body),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return reject(502, [{ code: 'source_failure', message: `live EU SEDIA search failed: ${message}` }])
  }
}
