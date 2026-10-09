/**
 * Phase V USAspending bridge — Node-side request handler.
 *
 * Mounts on the Vite dev and preview servers (`plugin.ts`) and is the ONE
 * place a real USAspending funding search is executed server-side: the browser
 * talks to this same-origin endpoint, and only HERE does `createFetchTransport`
 * perform its POST. One read-only search per request, returning the raw status
 * + body unchanged. Builds the query with the REAL adapter query planner
 * (`buildUsaSpendingQueryPlan`) so keyword / publishedSince / limit are honored
 * exactly. Any handler-side failure returns explicit `errors` and is NEVER
 * converted into an empty successful search.
 */

import type { DiscoveryRequest } from '../../automation/request'
import { createDiscoveryRequest } from '../../automation/request'
import { USA_SPENDING_SOURCE_ID } from '../../automation/registry'
import {
  USA_SPENDING_SEARCH_ENDPOINT,
  buildUsaSpendingQueryPlan,
  buildUsaSpendingSearchBody,
} from '../../automation/usaspending-adapter'
import type { UsaSpendingTransport } from '../../automation/usaspending-adapter'
import { createFetchTransport } from '../fetch-transport'
import { clampSearchLimit } from '../http-boundary'
import type { UsaSpendingBridgeError, UsaSpendingBridgeSearchRequest, UsaSpendingBridgeSearchResponse } from './contract'

export const USA_BRIDGE_PROFILE_ID = 'DP-LIVE-002'
export const USA_BRIDGE_DEFAULT_LIMIT = 10

export interface UsaSpendingBridgeResult {
  readonly httpStatus: number
  readonly body: UsaSpendingBridgeSearchResponse
}

function okBody(status: number, body: string): UsaSpendingBridgeSearchResponse {
  return { ok: true, status, body }
}

function failureBody(
  status: number,
  errors: readonly UsaSpendingBridgeError[],
  body: string | null = null,
): UsaSpendingBridgeSearchResponse {
  return { ok: false, status, body, errors }
}

function reject(status: number, errors: readonly UsaSpendingBridgeError[]): UsaSpendingBridgeResult {
  return { httpStatus: status, body: failureBody(status, errors) }
}

type BuildOutcome =
  | { readonly kind: 'request'; readonly request: DiscoveryRequest }
  | { readonly kind: 'error'; readonly result: UsaSpendingBridgeResult }

function buildRequest(value: UsaSpendingBridgeSearchRequest | null): BuildOutcome {
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
      result: reject(400, [{ code: 'invalid_request', message: 'a keyword is required for a live USAspending search' }]),
    }
  }

  const rawLimit = fields.limit
  const limit = clampSearchLimit(rawLimit, USA_BRIDGE_DEFAULT_LIMIT)

  const rawSince = fields.publishedSince
  const publishedSince = typeof rawSince === 'string' ? rawSince.trim() : ''

  const adapterConfig: Record<string, unknown> = { limit }
  if (publishedSince !== '') adapterConfig.publishedSince = publishedSince

  const input: DiscoveryRequest = {
    runId: `${runId}-${companyId}`,
    companyId,
    discoveryProfileId: USA_BRIDGE_PROFILE_ID,
    sourceId: USA_SPENDING_SOURCE_ID,
    domain: 'funding',
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

export interface UsaSpendingBridgeHandleOptions {
  readonly transport?: UsaSpendingTransport
}

export async function handleUsaSpendingBridge(
  value: UsaSpendingBridgeSearchRequest | null,
  options: UsaSpendingBridgeHandleOptions = {},
): Promise<UsaSpendingBridgeResult> {
  const built = buildRequest(value)
  if (built.kind === 'error') return built.result
  const request = built.request

  const planResult = buildUsaSpendingQueryPlan(request)
  if (!planResult.ok) {
    return reject(400, [{ code: 'invalid_request', message: planResult.message }])
  }

  const body = buildUsaSpendingSearchBody(planResult.plan)
  const transport = options.transport ?? createFetchTransport()
  try {
    const answer = await transport(USA_SPENDING_SEARCH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    return { httpStatus: answer.status >= 200 && answer.status < 300 ? 200 : answer.status, body: okBody(answer.status, answer.body) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return reject(502, [{ code: 'source_failure', message: `live USAspending search failed: ${message}` }])
  }
}