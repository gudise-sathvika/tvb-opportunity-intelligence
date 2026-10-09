/**
 * USAspending source adapter — Phase V first real FUNDING source.
 *
 * The source is USAspending (api.usaspending.gov), the official public U.S.
 * federal spending search API run by the U.S. Department of the Treasury. It
 * exposes obligated federal assistance awards; our search narrows to
 * `award_type_code 02` (grants). Retrieval is one read-only POST, no login, no
 * API key, no access control bypassed.
 *
 * Boundary design mirrors the TED adapter exactly: this module is pure. It
 * builds the source query, maps a response body to raw results, and shapes
 * envelope results — the HTTP round trip happens in an injected
 * `UsaSpendingTransport` (the live implementation lives in `src/live-source/`).
 * The adapter holds no network, filesystem, clock, or vault primitive.
 *
 * Two-phase live retrieval (same as TED): `await adapter.retrieve(request)`
 * performs and stores the round trip; the ordinary synchronous
 * `adapter.discover(request)` parses it. Tests inject a synchronous transport
 * and call `discover()` directly.
 *
 * Filter honesty: keyword → full-text `keywords` filter; `limit` (1–100) →
 * the source page size; `publishedSince` (YYYYMMDD) → the `time_period`
 * start_date, bounded by an end_date taken from the request's `requestedAt`
 * (the source REQUIRES both dates or it answers HTTP 422). `sector`,
 * `location`, `exclusions` are NOT supported and are reported with explicit
 * warnings rather than silently ignored. A publishedSince with no derivable
 * end date (or one that would invert the window) fails before the request is
 * sent rather than reaching the source with an invalid time_period.
 *
 * Error honesty: failed requests stay FAILED, refused access becomes BLOCKED
 * (never bypassed), a genuine empty search is SUCCESS because the access gate
 * already proved the source AVAILABLE.
 */

import type { DiscoveryRequest } from './request'
import type { AdapterResult, ExecutionError, RawResult } from './types'
import type { SourceAdapter } from './adapter'
import { blockedResult, executedResult } from './adapter'
import type { SourceRegistry } from './registry'
import { DEFAULT_SOURCE_REGISTRY, USA_SPENDING_ADAPTER_TYPE, USA_SPENDING_SOURCE_ID } from './registry'

/** The official USAspending search endpoint (POST, JSON, no authentication). */
export const USA_SPENDING_SEARCH_ENDPOINT = 'https://api.usaspending.gov/api/v2/search/spending_by_award/'

/** Canonical award profile-page prefix (source's own public web UI). */
export const USA_SPENDING_AWARD_PREFIX = 'https://www.usaspending.gov/award/'

export interface UsaSpendingTransportResponse {
  readonly status: number
  readonly body: string
}

export type UsaSpendingTransport = (
  url: string,
  init: {
    readonly method: 'POST'
    readonly headers: Readonly<Record<string, string>>
    readonly body: string
  },
) => UsaSpendingTransportResponse | Promise<UsaSpendingTransportResponse>

export interface UsaSpendingAdapterOptions {
  readonly transport: UsaSpendingTransport
  readonly registry?: SourceRegistry
}

export interface UsaSpendingAdapter extends SourceAdapter {
  /** Performs the live round trip and stores the response for the next discover(). */
  retrieve(request: DiscoveryRequest): Promise<void>
}

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100
const PUBLISHED_SINCE_PATTERN = /^20[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$/
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const GRANT_AWARD_TYPE_CODE = '02'

/** True when `value` is a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
function isIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * Derives the YYYY-MM-DD end date of the source time_period from the request's
 * `requestedAt`. The source requires BOTH bounds; a request that cannot supply
 * a valid end date must fail rather than send an unbounded/invalid window.
 */
function endDateFromRequestedAt(requestedAt: string): string | null {
  if (typeof requestedAt !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(requestedAt.trim())
  const candidate = match !== null ? match[1] : requestedAt.trim().slice(0, 10)
  return isIsoCalendarDate(candidate) ? candidate : null
}

const OUTPUT_FIELDS: readonly string[] = ['Award ID', 'Recipient Name', 'Award Amount', 'Description', 'Start Date', 'Awarding Agency']

export function buildUsaSpendingSearchBody(plan: UsaSpendingQueryPlan): string {
  const filters: Record<string, unknown> = {
    award_type_codes: [GRANT_AWARD_TYPE_CODE],
    keywords: [plan.keyword],
  }
  if (plan.publishedSince !== null && plan.publishedUntil !== null) {
    filters.time_period = [{ start_date: plan.publishedSince, end_date: plan.publishedUntil }]
  }
  return JSON.stringify({
    filters,
    fields: OUTPUT_FIELDS,
    page: 1,
    limit: plan.limit,
    sort: 'Start Date',
    order: 'desc',
  })
}

interface UsaSpendingQueryPlan {
  readonly keyword: string
  readonly limit: number
  readonly publishedSince: string | null
  readonly publishedUntil: string | null
  readonly warnings: readonly string[]
}

type QueryPlanResult =
  | { readonly ok: true; readonly plan: UsaSpendingQueryPlan }
  | { readonly ok: false; readonly message: string; readonly warnings: readonly string[] }

export function buildUsaSpendingQueryPlan(request: DiscoveryRequest): QueryPlanResult {
  const warnings: string[] = []
  if (request.sector !== undefined && request.sector !== '' && request.sector !== 'all') {
    warnings.push(`sector filter "${request.sector}" was not applied: this source has no supported sector mapping`)
  }
  if (request.location !== undefined && request.location !== '' && request.location !== 'all') {
    warnings.push(
      `location filter "${request.location}" was not applied: this source does not support free-text location filtering`,
    )
  }
  if (request.exclusions.length > 0) {
    warnings.push(`${request.exclusions.length} exclusion term(s) were not applied by this adapter`)
  }

  const keywordRaw = (request.keyword ?? '').trim()
  const term = keywordRaw !== '' ? keywordRaw : (request.queryTerms[0] ?? '').trim()
  const sanitized = term.replace(/["\\]/g, '')
  if (sanitized === '') {
    return { ok: false, message: 'search term is empty; no query can be built for this source', warnings }
  }
  if (sanitized !== term) {
    warnings.push('double-quote and backslash characters were removed from the search term')
  }

  const config = request.adapterConfig ?? {}
  const rawLimit = config['limit']
  let limit = DEFAULT_LIMIT
  if (typeof rawLimit === 'number' && Number.isFinite(rawLimit)) {
    const clamped = Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    if (clamped !== rawLimit) warnings.push(`limit adjusted to ${clamped} (allowed range 1–${MAX_LIMIT})`)
    limit = clamped
  }

  let publishedSince: string | null = null
  let publishedUntil: string | null = null
  const rawSince = config['publishedSince']
  if (rawSince !== undefined && rawSince !== '') {
    if (typeof rawSince !== 'string' || !PUBLISHED_SINCE_PATTERN.test(rawSince)) {
      return { ok: false, message: 'adapterConfig.publishedSince must be a YYYYMMDD date string', warnings }
    }
    const month = rawSince.slice(4, 6)
    const day = rawSince.slice(6, 8)
    publishedSince = `${rawSince.slice(0, 4)}-${month}-${day}`
    const end = endDateFromRequestedAt(request.requestedAt)
    if (end === null) {
      return {
        ok: false,
        message: 'requestedAt must be a valid ISO 8601 date-time to bound the source time_period end_date',
        warnings,
      }
    }
    if (publishedSince > end) {
      return {
        ok: false,
        message: `publishedSince ${publishedSince} is after the request date ${end}; the source time_period would be empty`,
        warnings,
      }
    }
    publishedUntil = end
    warnings.push(`publishedSince is forwarded to the source time_period window (${publishedSince} to ${publishedUntil})`)
  }

  return { ok: true, plan: { keyword: sanitized, limit, publishedSince, publishedUntil, warnings } }
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export interface UsaSpendingParseContext {
  readonly sourceId: string
  readonly observedAt: string
  readonly queryTerm: string | null
}

export interface UsaSpendingParseOutcome {
  readonly results: readonly RawResult[]
  readonly errors: readonly ExecutionError[]
  readonly warnings: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item)
      if (found !== null) return found
    }
  }
  return null
}

function awardUrlFor(internalId: unknown): string | null {
  if (typeof internalId === 'number' || (typeof internalId === 'string' && internalId.length > 0)) {
    return `${USA_SPENDING_AWARD_PREFIX}${String(internalId)}?tab=overview`
  }
  return null
}

/**
 * Parses a USAspending search response body into raw results. Unusable entries
 * (no title and no award id / no detail link) are reported as item errors;
 * every usable award is preserved exactly as the source published it.
 */
export function parseUsaSpendingBody(body: string, context: UsaSpendingParseContext): UsaSpendingParseOutcome {
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
  if (!isRecord(payload) || !Array.isArray(payload['results'])) {
    return {
      results: [],
      errors: [{ code: 'adapter_error', message: 'source response has an unexpected shape (no results array)' }],
      warnings: [],
    }
  }

  const warnings: string[] = []
  const messages = payload['messages']
  if (Array.isArray(messages)) {
    for (const message of messages) {
      const text = firstString(message)
      if (text !== null) warnings.push(text)
    }
  }

  const results: RawResult[] = []
  const errors: ExecutionError[] = []
  const entries = payload['results'] as unknown[]
  entries.forEach((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      errors.push({ code: 'item_error', message: 'award entry is not an object', itemIndex: index })
      return
    }
    const awardId = firstString(entry['Award ID'])
    const title = firstString(entry['Description'] ?? null)
    const displayTitle = title !== null ? title : awardId !== null ? `Grant award ${awardId}` : null
    if (displayTitle === null) {
      errors.push({ code: 'item_error', message: 'award entry has no title or award id', itemIndex: index })
      return
    }
    const sourceUrl = awardUrlFor(entry['internal_id'])
    if (sourceUrl === null) {
      errors.push({ code: 'item_error', message: 'award entry has no internal_id for a canonical detail link', itemIndex: index })
      return
    }
    results.push({
      sourceRecordId: awardId,
      sourceUrl,
      title: displayTitle,
      description: title,
      publicationDate: firstString(entry['Start Date']),
      deadline: null,
      issuingOrganization: firstString(entry['Awarding Agency']),
      country: 'US',
      rawType: 'grant_award',
      rawPayload: JSON.stringify(entry),
      rawProvenance: {
        sourceId: context.sourceId,
        sourceUrl,
        sourceRecordId: awardId,
        observedAt: context.observedAt,
        queryTerm: context.queryTerm,
      },
    })
  })

  return { results, errors, warnings }
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

type TransportOutcome =
  | { readonly kind: 'response'; readonly status: number; readonly body: string }
  | { readonly kind: 'failure'; readonly message: string }

interface StoredRetrieval {
  readonly runId: string
  readonly outcome: TransportOutcome
}

function isThenable(
  value: UsaSpendingTransportResponse | Promise<UsaSpendingTransportResponse>,
): value is Promise<UsaSpendingTransportResponse> {
  return typeof (value as Promise<UsaSpendingTransportResponse>).then === 'function'
}

function failureOutcomeFrom(error: unknown): TransportOutcome {
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'failure', message: `source request failed: ${message}` }
}

export function createUsaSpendingAdapter(options: UsaSpendingAdapterOptions): UsaSpendingAdapter {
  const registry = options.registry ?? DEFAULT_SOURCE_REGISTRY
  let stored: StoredRetrieval | null = null

  function interpret(
    request: DiscoveryRequest,
    sourceName: string,
    plan: UsaSpendingQueryPlan,
    outcome: TransportOutcome,
    outcomeWarnings: readonly string[] = [],
  ): AdapterResult {
    const base = {
      request,
      sourceName,
      adapterType: USA_SPENDING_ADAPTER_TYPE,
      accessState: 'AVAILABLE' as const,
      warnings: [...plan.warnings, ...outcomeWarnings],
    }

    if (outcome.kind === 'failure') {
      return executedResult({ ...base, results: [], errors: [{ code: 'adapter_error', message: outcome.message }] })
    }
    if (outcome.status === 401 || outcome.status === 403) {
      return blockedResult({
        request,
        sourceName,
        accessState: 'RESTRICTED',
        adapterType: USA_SPENDING_ADAPTER_TYPE,
        reason: `source refused access (HTTP ${outcome.status})`,
        errors: [
          {
            code: 'source_blocked',
            message: `source ${USA_SPENDING_SOURCE_ID} refused the request (HTTP ${outcome.status}); access restrictions are reported, never bypassed`,
          },
        ],
      })
    }
    if (outcome.status === 429) {
      return executedResult({
        ...base,
        results: [],
        errors: [
          {
            code: 'adapter_error',
            message: 'source rate-limited the request (HTTP 429); the run failed and is not reported as an empty result',
          },
        ],
      })
    }
    if (outcome.status < 200 || outcome.status >= 300) {
      const excerpt = outcome.body.slice(0, 200)
      return executedResult({
        ...base,
        results: [],
        errors: [
          {
            code: 'adapter_error',
            message: `source returned HTTP ${outcome.status}${excerpt === '' ? '' : `: ${excerpt}`}`,
          },
        ],
      })
    }

    const parsed = parseUsaSpendingBody(outcome.body, {
      sourceId: USA_SPENDING_SOURCE_ID,
      observedAt: request.requestedAt,
      queryTerm: (request.keyword ?? '').trim() || request.queryTerms[0] || null,
    })
    return executedResult({
      ...base,
      results: parsed.results,
      errors: parsed.errors,
      warnings: [...base.warnings, ...parsed.warnings],
    })
  }

  const init = Object.freeze({
    method: 'POST' as const,
    headers: Object.freeze({ 'content-type': 'application/json' }),
    body: '',
  })

  return {
    sourceId: USA_SPENDING_SOURCE_ID,
    adapterType: USA_SPENDING_ADAPTER_TYPE,

    async retrieve(request: DiscoveryRequest): Promise<void> {
      if (request.sourceId !== USA_SPENDING_SOURCE_ID) return
      const definition = registry.get(USA_SPENDING_SOURCE_ID)
      if (definition === undefined || definition.accessState !== 'AVAILABLE') return
      const planResult = buildUsaSpendingQueryPlan(request)
      if (!planResult.ok) return

      const body = buildUsaSpendingSearchBody(planResult.plan)
      let outcome: TransportOutcome
      try {
        const answer = await options.transport(USA_SPENDING_SEARCH_ENDPOINT, { ...init, body })
        outcome = { kind: 'response', status: answer.status, body: answer.body }
      } catch (error) {
        outcome = failureOutcomeFrom(error)
      }
      stored = { runId: request.runId, outcome }
    },

    discover(request: DiscoveryRequest): AdapterResult {
      if (request.sourceId !== USA_SPENDING_SOURCE_ID) {
        return blockedResult({
          request,
          reason: 'adapter serves USAspending only',
          errors: [
            {
              code: 'adapter_not_available',
              message: `adapter for ${USA_SPENDING_SOURCE_ID} cannot serve request for ${request.sourceId}`,
            },
          ],
        })
      }

      const definition = registry.get(USA_SPENDING_SOURCE_ID)
      if (definition === undefined) {
        return blockedResult({
          request,
          reason: 'source is not registered',
          errors: [{ code: 'unknown_source', message: `no registered source with sourceId ${USA_SPENDING_SOURCE_ID}` }],
        })
      }
      if (definition.accessState !== 'AVAILABLE') {
        return blockedResult({
          request,
          sourceName: definition.name,
          accessState: definition.accessState,
          adapterType: USA_SPENDING_ADAPTER_TYPE,
          reason: `source access state ${definition.accessState} is not AVAILABLE`,
          errors: [
            {
              code: 'source_blocked',
              message: `source ${USA_SPENDING_SOURCE_ID} has access state ${definition.accessState}; unauthorized sources are never queried`,
            },
          ],
        })
      }

      const planResult = buildUsaSpendingQueryPlan(request)
      if (!planResult.ok) {
        return executedResult({
          request,
          sourceName: definition.name,
          adapterType: USA_SPENDING_ADAPTER_TYPE,
          accessState: definition.accessState,
          results: [],
          errors: [{ code: 'invalid_request', message: planResult.message }],
          warnings: planResult.warnings,
        })
      }

      if (stored !== null && stored.runId === request.runId) {
        const prefetched = stored
        stored = null
        return interpret(request, definition.name, planResult.plan, prefetched.outcome)
      }

      const body = buildUsaSpendingSearchBody(planResult.plan)
      let answer: UsaSpendingTransportResponse | Promise<UsaSpendingTransportResponse>
      try {
        answer = options.transport(USA_SPENDING_SEARCH_ENDPOINT, { ...init, body })
      } catch (error) {
        return interpret(request, definition.name, planResult.plan, failureOutcomeFrom(error))
      }
      if (isThenable(answer)) {
        void answer.then(undefined, () => undefined)
        return interpret(request, definition.name, planResult.plan, {
          kind: 'failure',
          message:
            'transport answered asynchronously: await adapter.retrieve(request) before running discovery against this source',
        })
      }
      return interpret(request, definition.name, planResult.plan, { kind: 'response', status: answer.status, body: answer.body })
    },
  }
}