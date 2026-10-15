/**
 * UK Find a Tender Service (FTS) source adapter — Phase 03.
 *
 * The UK Find a Tender Service publishes public procurement notices via its
 * OCDS API (https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages),
 * which returns OCDS release packages containing releases with tender/status,
 * tenderPeriod, ocid, id, publication dates and buyer details. Access is public
 * (no auth) for read-only queries. This adapter treats it as a procurement
 * source and follows the same boundary design as TED/Grants.gov: pure
 * transformation, injected transport, no network in this module.
 *
 * Honesty rules:
 * - Only records that have a tender object are considered. The tender status is
 *   preserved as sourceStatus (e.g. "active", "complete", "cancelled").
 * - An entry is not assumed open because it appears in recent results. The
 *   classifier/opportunity gate decides actionability from evidence (status +
 *   deadline). If tenderPeriod.endDate is missing, deadline remains null.
 * - Official detail link: we construct
 *   https://www.find-tender.service.gov.uk/Notice/{release-id} (the FT notice
 *   number, e.g. `097235-2026`). sourceRecordId stays the release ocid
 *   (stable identity for dedup/review ids).
 * - Missing fields stay null; nothing is fabricated.
 * - Failed requests stay FAILED; rate-limit/HTTP errors are reported as errors
 *   (never converted to empty successes).
 */

import type { DiscoveryRequest } from './request'
import type { AccessState, AdapterResult, ExecutionError, RawResult } from './types'
import type { SourceAdapter } from './adapter'
import { blockedResult, executedResult } from './adapter'
import { FTS_SOURCE_ID, FTS_ADAPTER_TYPE } from './registry'

export { FTS_SOURCE_ID, FTS_ADAPTER_TYPE }
export const FTS_SEARCH_ENDPOINT = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages'
/**
 * Phase 05: verified live 2026-10-14 — the human notice page is
 * `https://www.find-tender.service.gov.uk/Notice/{release-id}` (the FT notice
 * number, e.g. `097235-2026`), which renders the tender title. The earlier
 * `/notice/{ocid}` construction redirected to `/syserror/notfound`
 * ("Page not found") and must never be used.
 */
export const FTS_NOTICE_DETAIL_PREFIX = 'https://www.find-tender.service.gov.uk/Notice/'

export const FTS_SOURCE_NAME = 'UK Find a Tender Service (FTS) — Official UK Procurement Notices'

export interface FtsQueryPlan {
  readonly limit: number
  readonly warnings: readonly string[]
}

type QueryPlanResult =
  | { readonly ok: true; readonly plan: FtsQueryPlan }
  | { readonly ok: false; readonly message: string; readonly warnings: readonly string[] }

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100

export function buildFtsQueryPlan(request: DiscoveryRequest): QueryPlanResult {
  const warnings: string[] = []
  if (request.sector !== undefined && request.sector !== '' && request.sector !== 'all') {
    warnings.push(`sector filter "${request.sector}" was not applied: this source has no supported sector mapping`)
  }
  if (request.location !== undefined && request.location !== '' && request.location !== 'all') {
    warnings.push(`location filter "${request.location}" was not applied: this source does not support free-text location filtering`)
  }
  if (request.exclusions.length > 0) {
    warnings.push(`${request.exclusions.length} exclusion term(s) were not applied by this adapter`)
  }

  const config = request.adapterConfig ?? {}
  const rawLimit = (config['limit'] as unknown) ?? (config['rows'] as unknown)
  let limit = DEFAULT_LIMIT
  if (typeof rawLimit === 'number' && Number.isFinite(rawLimit)) {
    const clamped = Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    if (clamped !== rawLimit) warnings.push(`rows adjusted to ${clamped} (allowed range 1–${MAX_LIMIT})`)
    limit = clamped
  }
  return { ok: true, plan: { limit, warnings } }
}

export function buildFtsSearchUrl(plan: FtsQueryPlan): string {
  const params = new URLSearchParams({ limit: String(plan.limit) })
  return `${FTS_SEARCH_ENDPOINT}?${params.toString()}`
}

export interface FtsParseContext {
  readonly sourceId: string
  readonly observedAt: string
  readonly queryTerm: string | null
}

export interface FtsParseOutcome {
  readonly results: readonly RawResult[]
  readonly errors: readonly ExecutionError[]
  readonly warnings: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().length > 0 ? value.trim() : null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item)
      if (found !== null) return found
    }
  }
  return null
}

function extractDeadline(tenderPeriod: unknown): string | null {
  if (!isRecord(tenderPeriod)) return null
  return firstString(tenderPeriod['endDate'])
}

function extractBuyerName(buyer: unknown): string | null {
  if (!isRecord(buyer)) return null
  return firstString(buyer['name'])
}

/**
 * Phase 05: the official detail page is keyed by the release's FT notice
 * number (`id`, e.g. `097235-2026`), NOT the ocid. A release without a notice
 * number yields no URL (reported as an item error by the caller) — never an
 * ocid-based guess, which the source answers with "Page not found".
 */
function detailUrlForRelease(releaseId: string | null): string | null {
  if (!releaseId) return null
  return `${FTS_NOTICE_DETAIL_PREFIX}${releaseId}`
}

export function parseFtsBody(body: string, context: FtsParseContext): FtsParseOutcome {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return {
      results: [],
      errors: [{ code: 'adapter_error', message: 'source response was not valid JSON' }],
      warnings: [],
    }
  }
  if (!isRecord(payload) || !Array.isArray(payload['releases'])) {
    return {
      results: [],
      errors: [{ code: 'adapter_error', message: 'source response has an unexpected shape (no releases array)' }],
      warnings: [],
    }
  }

  const releases = payload['releases'] as unknown[]
  const warnings: string[] = []
  const errors: ExecutionError[] = []
  const results: RawResult[] = []

  releases.forEach((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      errors.push({ code: 'item_error', message: 'release entry is not an object', itemIndex: index })
      return
    }
    const ocid = firstString(entry['ocid'])
    const releaseId = firstString(entry['id'])
    const tender = entry['tender']
    if (!isRecord(tender)) {
      errors.push({ code: 'item_error', message: 'release has no tender object', itemIndex: index })
      return
    }
    const tenderId = firstString(tender['id'])
    const title = firstString(tender['title'])
    const description = firstString(tender['description'])
    if (title === null) {
      errors.push({ code: 'item_error', message: 'tender has no title', itemIndex: index })
      return
    }
    const sourceRecordId = ocid ?? releaseId ?? tenderId
    const sourceUrl = detailUrlForRelease(releaseId)
    if (sourceUrl === null) {
      errors.push({ code: 'item_error', message: 'release has no FT notice number for its detail URL', itemIndex: index })
      return
    }
    const deadline = extractDeadline(tender['tenderPeriod'])
    const sourceStatus = firstString(tender['status'])

    results.push({
      sourceRecordId: sourceRecordId,
      sourceUrl,
      title,
      description,
      publicationDate: firstString(entry['date']) ?? firstString((payload as Record<string, unknown>)['publishedDate']),
      deadline,
      issuingOrganization: extractBuyerName(entry['buyer']),
      country: 'GB',
      rawType: firstString(tender['procurementMethod']) ?? 'tender',
      sourceStatus: sourceStatus,
      rawPayload: JSON.stringify(entry),
      rawProvenance: {
        sourceId: context.sourceId,
        sourceUrl,
        sourceRecordId: sourceRecordId,
        observedAt: context.observedAt,
        queryTerm: context.queryTerm,
      },
    })
  })

  return { results, errors, warnings }
}

export interface FtsTransportResponse {
  readonly status: number
  readonly body: string
}

export type FtsTransport = (
  url: string,
  init: {
    readonly method: 'GET'
    readonly headers: Readonly<Record<string, string>>
    readonly body?: string
  },
) => FtsTransportResponse | Promise<FtsTransportResponse>

export interface FtsAdapterOptions {
  readonly transport: FtsTransport
  readonly registry?: {
    get(sourceId: string): { name: string; accessState: AccessState } | undefined
  }
}

export interface FtsAdapter extends SourceAdapter {
  retrieve(request: DiscoveryRequest): Promise<void>
}

type TransportOutcome =
  | { readonly kind: 'response'; readonly status: number; readonly body: string }
  | { readonly kind: 'failure'; readonly message: string }

interface StoredRetrieval {
  readonly runId: string
  readonly outcome: TransportOutcome
}

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === 'function'
}

function failureOutcomeFrom(error: unknown): TransportOutcome {
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'failure', message: `source request failed: ${message}` }
}

export function createFtsAdapter(options: FtsAdapterOptions): FtsAdapter {
  let stored: StoredRetrieval | null = null

  function resolveIdentity(): { name: string; accessState: AccessState } | null {
    if (options.registry === undefined) return { name: FTS_SOURCE_NAME, accessState: 'AVAILABLE' }
    const def = options.registry.get(FTS_SOURCE_ID)
    if (def === undefined) return null
    return { name: def.name, accessState: def.accessState }
  }

  function queryTermFor(request: DiscoveryRequest): string | null {
    if (request.keyword !== '' && request.keyword !== undefined) return request.keyword
    const first = request.queryTerms[0]
    return first !== undefined && first !== '' ? first : null
  }

  function interpret(
    request: DiscoveryRequest,
    identity: { name: string; accessState: AccessState },
    plan: FtsQueryPlan,
    outcome: TransportOutcome,
  ): AdapterResult {
    const base = {
      request,
      sourceName: identity.name,
      adapterType: FTS_ADAPTER_TYPE,
      accessState: identity.accessState,
      warnings: [...plan.warnings],
    }
    if (outcome.kind === 'failure') {
      return executedResult({ ...base, results: [], errors: [{ code: 'adapter_error', message: outcome.message }] })
    }
    if (outcome.status === 401 || outcome.status === 403) {
      return blockedResult({
        request,
        sourceName: identity.name,
        accessState: 'RESTRICTED',
        adapterType: FTS_ADAPTER_TYPE,
        reason: `source refused access (HTTP ${outcome.status})`,
        errors: [
          {
            code: 'source_blocked',
            message: `source ${FTS_SOURCE_ID} refused the request (HTTP ${outcome.status}); access restrictions are reported, never bypassed`,
          },
        ],
      })
    }
    if (outcome.status === 429) {
      return executedResult({
        ...base,
        results: [],
        errors: [{ code: 'adapter_error', message: 'source rate-limited the request (HTTP 429); the run failed and is not reported as an empty result' }],
      })
    }
    if (outcome.status < 200 || outcome.status >= 300) {
      const excerpt = outcome.body.slice(0, 200)
      return executedResult({
        ...base,
        results: [],
        errors: [{ code: 'adapter_error', message: `source returned HTTP ${outcome.status}${excerpt === '' ? '' : `: ${excerpt}`}` }],
      })
    }
    const parsed = parseFtsBody(outcome.body, {
      sourceId: FTS_SOURCE_ID,
      observedAt: request.requestedAt,
      queryTerm: queryTermFor(request),
    })
    return executedResult({
      ...base,
      results: parsed.results,
      errors: parsed.errors,
      warnings: [...base.warnings, ...parsed.warnings],
    })
  }

  const urlInit = Object.freeze({ method: 'GET' as const, headers: Object.freeze({ accept: 'application/json' }) })

  return {
    sourceId: FTS_SOURCE_ID,
    adapterType: FTS_ADAPTER_TYPE,

    async retrieve(request: DiscoveryRequest): Promise<void> {
      if (request.sourceId !== FTS_SOURCE_ID) return
      const identity = resolveIdentity()
      if (identity === null || identity.accessState !== 'AVAILABLE') return
      const planResult = buildFtsQueryPlan(request)
      if (!planResult.ok) return
      const url = buildFtsSearchUrl(planResult.plan)
      let outcome: TransportOutcome
      try {
        const answer = await options.transport(url, urlInit)
        outcome = { kind: 'response', status: answer.status, body: answer.body }
      } catch (error) {
        outcome = failureOutcomeFrom(error)
      }
      stored = { runId: request.runId, outcome }
    },

    discover(request: DiscoveryRequest): AdapterResult {
      if (request.sourceId !== FTS_SOURCE_ID) {
        return blockedResult({
          request,
          reason: 'adapter serves Find a Tender only',
          errors: [
            {
              code: 'adapter_not_available',
              message: `adapter for ${FTS_SOURCE_ID} cannot serve request for ${request.sourceId}`,
            },
          ],
        })
      }
      const identity = resolveIdentity()
      if (identity === null) {
        return blockedResult({
          request,
          reason: 'source is not registered',
          errors: [{ code: 'unknown_source', message: `no registered source with sourceId ${FTS_SOURCE_ID}` }],
        })
      }
      if (identity.accessState !== 'AVAILABLE') {
        return blockedResult({
          request,
          sourceName: identity.name,
          accessState: identity.accessState,
          adapterType: FTS_ADAPTER_TYPE,
          reason: `source access state ${identity.accessState} is not AVAILABLE`,
          errors: [
            {
              code: 'source_blocked',
              message: `source ${FTS_SOURCE_ID} has access state ${identity.accessState}; unauthorized sources are never queried`,
            },
          ],
        })
      }
      const planResult = buildFtsQueryPlan(request)
      if (!planResult.ok) {
        return executedResult({
          request,
          sourceName: identity.name,
          adapterType: FTS_ADAPTER_TYPE,
          accessState: identity.accessState,
          results: [],
          errors: [{ code: 'invalid_request', message: planResult.message }],
          warnings: planResult.warnings,
        })
      }
      if (stored !== null && stored.runId === request.runId) {
        const prefetched = stored
        stored = null
        return interpret(request, identity, planResult.plan, prefetched.outcome)
      }
      const url = buildFtsSearchUrl(planResult.plan)
      let answer: FtsTransportResponse | Promise<FtsTransportResponse>
      try {
        answer = options.transport(url, urlInit)
      } catch (error) {
        return interpret(request, identity, planResult.plan, failureOutcomeFrom(error))
      }
      if (isThenable(answer)) {
        void answer.then(undefined, () => undefined)
        return interpret(request, identity, planResult.plan, {
          kind: 'failure',
          message: 'transport answered asynchronously: await adapter.retrieve(request) before running discovery against this source',
        })
      }
      return interpret(request, identity, planResult.plan, { kind: 'response', status: answer.status, body: answer.body })
    },
  }
}
