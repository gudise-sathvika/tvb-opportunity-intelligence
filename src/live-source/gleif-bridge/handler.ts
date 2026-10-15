/**
 * Phase 06 GLEIF bridge — Node-side request handler.
 *
 * This module sits on the Vite dev and preview servers (`plugin.ts`) and is
 * the ONE place a real GLEIF LEI search can be executed safely: the browser
 * only talks to this same-origin endpoint, and only HERE does
 * `createFetchTransport` — the codebase's single live network caller —
 * perform its GET. The bridge never writes anything: one read-only search per
 * request against the official public GLEIF API (no auth, no key), returning
 * the raw status + body unchanged.
 *
 * The request body carries only discovery parameters. The endpoint and host
 * are FIXED here (`GLEIF_API_HOST`), so a browser can never redirect the
 * server toward another host. Admission of records (ACTIVE/ISSUED only) and
 * identity derivation happen downstream in `gleif-company-discovery`, never
 * here — the bridge returns whatever the source returned, verbatim.
 *
 * Honesty: any handler-side failure returns explicit `errors` and is NEVER
 * converted into an empty successful search.
 */

import { GLEIF_API_HOST } from '../../automation/gleif-company-discovery'
import { clampSearchLimit } from '../http-boundary'
import type { GleifBridgeError, GleifBridgeSearchRequest, GleifBridgeSearchResponse } from './contract'

export const GLEIF_BRIDGE_DEFAULT_LIMIT = 5

export interface GleifBridgeResult {
  readonly httpStatus: number
  readonly body: GleifBridgeSearchResponse
}

function okBody(status: number, body: string): GleifBridgeSearchResponse {
  return { ok: true, status, body }
}

function failureBody(
  status: number,
  errors: readonly GleifBridgeError[],
  body: string | null = null,
): GleifBridgeSearchResponse {
  return { ok: false, status, body, errors }
}

function reject(status: number, errors: readonly GleifBridgeError[]): GleifBridgeResult {
  return { httpStatus: status, body: failureBody(status, errors) }
}

export interface GleifBridgeHandleOptions {
  /** Injectable fetch for tests; defaults to global fetch with a hard timeout. */
  readonly fetchImpl?: typeof globalThis.fetch
}

/**
 * Handles one same-origin live GLEIF search request. Performs exactly one
 * read-only GET against the official public LEI records endpoint; the
 * response (status + raw body) is returned unchanged.
 */
export async function handleGleifBridge(
  value: GleifBridgeSearchRequest | null,
  options: GleifBridgeHandleOptions = {},
): Promise<GleifBridgeResult> {
  if (value === null || typeof value !== 'object') {
    return reject(400, [{ code: 'malformed_request', message: 'request body must be an object' }])
  }
  const fields = value as unknown as Record<string, unknown>
  const runId = typeof fields.runId === 'string' ? fields.runId.trim() : ''
  const companyId = typeof fields.companyId === 'string' ? fields.companyId.trim() : ''
  const requestedAt = typeof fields.requestedAt === 'string' ? fields.requestedAt.trim() : ''
  if (runId === '' || companyId === '' || requestedAt === '') {
    return reject(400, [{ code: 'invalid_request', message: 'runId, companyId, and requestedAt are required non-empty strings' }])
  }
  const query = typeof fields.query === 'string' ? fields.query.trim() : ''
  if (query === '') {
    return reject(400, [{ code: 'invalid_request', message: 'a legal-name query is required for a live GLEIF search' }])
  }

  const limit = clampSearchLimit(fields.limit, GLEIF_BRIDGE_DEFAULT_LIMIT)

  const url =
    `https://${GLEIF_API_HOST}/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(query)}` +
    `&page[size]=${limit}`
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  try {
    const answer = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.api+json' },
      signal: AbortSignal.timeout(20_000),
    })
    const body = await answer.text()
    return { httpStatus: answer.status >= 200 && answer.status < 300 ? 200 : answer.status, body: okBody(answer.status, body) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return reject(502, [{ code: 'source_failure', message: `live GLEIF search failed: ${message}` }])
  }
}
