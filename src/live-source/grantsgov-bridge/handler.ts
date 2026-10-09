/**
 * Phase 19B Grants.gov bridge — Node-side request handler.
 *
 * Mounts on the Vite dev and preview servers (`plugin.ts`) and on the standalone
 * Node host (`server/serve.ts`), and is the ONE place a real Grants.gov funding
 * search is executed server-side: the browser talks to this same-origin
 * endpoint, and only HERE does `createFetchTransport` perform its POST. One
 * read-only, unauthenticated search per request, returning the raw status +
 * body unchanged (the browser-side adapter normalizes `oppStatus` and builds
 * provenance). The query is built with the REAL adapter query planner
 * (`buildGrantsGovQueryPlan`) so keyword / oppStatuses / rows are honored
 * exactly. Any handler-side failure returns explicit `errors` and is NEVER
 * converted into an empty successful search.
 *
 * No "open opportunity" verdict is computed here and returned records are never
 * implied to be eligible for a TVB company.
 */

import type { DiscoveryRequest } from '../../automation/request'
import { createDiscoveryRequest } from '../../automation/request'
import { GRANTS_GOV_SOURCE_ID } from '../../automation/registry'
import {
  GRANTS_GOV_SEARCH_ENDPOINT,
  buildGrantsGovQueryPlan,
  buildGrantsGovSearchBody,
} from '../../automation/grantsgov-adapter'
import type { GrantsGovTransport } from '../../automation/grantsgov-adapter'
import { createFetchTransport } from '../fetch-transport'
import { clampSearchLimit } from '../http-boundary'
import type { GrantsGovBridgeError, GrantsGovBridgeSearchRequest, GrantsGovBridgeSearchResponse } from './contract'

export const GRANTS_GOV_BRIDGE_PROFILE_ID = 'DP-LIVE-003'
export const GRANTS_GOV_BRIDGE_DEFAULT_LIMIT = 10

export interface GrantsGovBridgeResult {
  readonly httpStatus: number
  readonly body: GrantsGovBridgeSearchResponse
}

function okBody(status: number, body: string): GrantsGovBridgeSearchResponse {
  return { ok: true, status, body }
}

function failureBody(
  status: number,
  errors: readonly GrantsGovBridgeError[],
  body: string | null = null,
): GrantsGovBridgeSearchResponse {
  return { ok: false, status, body, errors }
}

function reject(status: number, errors: readonly GrantsGovBridgeError[]): GrantsGovBridgeResult {
  return { httpStatus: status, body: failureBody(status, errors) }
}

type BuildOutcome =
  | { readonly kind: 'request'; readonly request: DiscoveryRequest }
  | { readonly kind: 'error'; readonly result: GrantsGovBridgeResult }

function buildRequest(value: GrantsGovBridgeSearchRequest | null): BuildOutcome {
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

  // A blank keyword is a BROAD search of posted opportunities, not an error and
  // never a company-name substitution. queryTerms must be a non-empty array of
  // non-empty strings, so broad mode carries a placeholder ('*') that is never
  // sent to the source (the planner ignores it when broadSearch is set).
  const rawKeyword = typeof fields.keyword === 'string' ? fields.keyword : ''
  const keyword = rawKeyword.trim()
  const broad = keyword === ''

  const rawLimit = fields.limit
  const limit = clampSearchLimit(rawLimit, GRANTS_GOV_BRIDGE_DEFAULT_LIMIT)

  const rawStatuses = typeof fields.oppStatuses === 'string' ? fields.oppStatuses.trim() : ''

  const adapterConfig: Record<string, unknown> = { rows: limit, broadSearch: broad }
  if (rawStatuses !== '') adapterConfig.oppStatuses = rawStatuses

  const input: DiscoveryRequest = {
    runId: `${runId}-${companyId}`,
    companyId,
    discoveryProfileId: GRANTS_GOV_BRIDGE_PROFILE_ID,
    sourceId: GRANTS_GOV_SOURCE_ID,
    domain: 'funding',
    queryTerms: [broad ? '*' : keyword],
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

export interface GrantsGovBridgeHandleOptions {
  /** Injectable transport for tests; defaults to the single live fetch transport. */
  readonly transport?: GrantsGovTransport
}

export async function handleGrantsGovBridge(
  value: GrantsGovBridgeSearchRequest | null,
  options: GrantsGovBridgeHandleOptions = {},
): Promise<GrantsGovBridgeResult> {
  const built = buildRequest(value)
  if (built.kind === 'error') return built.result
  const request = built.request

  const planResult = buildGrantsGovQueryPlan(request)
  if (!planResult.ok) {
    return reject(400, [{ code: 'invalid_request', message: planResult.message }])
  }

  const body = buildGrantsGovSearchBody(planResult.plan)
  const transport = options.transport ?? createFetchTransport()
  try {
    const answer = await transport(GRANTS_GOV_SEARCH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    return { httpStatus: answer.status >= 200 && answer.status < 300 ? 200 : answer.status, body: okBody(answer.status, answer.body) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return reject(502, [{ code: 'source_failure', message: `live Grants.gov search failed: ${message}` }])
  }
}
