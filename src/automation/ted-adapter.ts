/**
 * TED (Tenders Electronic Daily) source adapter — Phase U first real source.
 *
 * TED is the official EU public procurement publication, served through its
 * official open JSON search API (no login, no credentials, no access controls
 * bypassed). Retrieval is one read-only search request per discovery run.
 *
 * Boundary design: this module is pure. It builds the source query, maps a
 * response body to raw results, and shapes envelope results — the HTTP round
 * trip happens in an injected `TedTransport` (the live implementation lives in
 * `src/live-source/`, outside the side-effect-free automation framework). The
 * adapter holds no network, filesystem, clock, or vault primitive and imports
 * only sibling automation modules, exactly like every other adapter-layer
 * module.
 *
 * Two-phase live retrieval: the existing `SourceAdapter` contract is
 * synchronous, so a live (asynchronous) run is `await adapter.retrieve(request)`
 * first — which performs and stores the round trip — and then the ordinary
 * synchronous discovery run parses the stored response. Tests inject a
 * synchronous transport and call `discover()` directly, with no prefetch step.
 * A synchronous `discover()` invoked while an asynchronous transport is still
 * unanswering fails honestly with instructions instead of inventing results.
 *
 * The adapter ONLY retrieves source information. It never classifies, never
 * creates vault records, matches, procurement matches, or bids, never writes
 * files, and never makes approval decisions. Missing source fields stay
 * missing (`null`); nothing is invented.
 *
 * Filter honesty (Phase U brief):
 *  - `keyword` → supported: forwarded to the source as a title search;
 *  - `domain` → enforced by the access gate through source applicability;
 *  - `sector`, `location`, `exclusions` → NOT supported by this source as
 *    free-text filters; the adapter does not pretend to apply them and emits
 *    an explicit warning for each one that was set;
 *  - optional `adapterConfig.publishedSince` (YYYYMMDD) and
 *    `adapterConfig.limit` (1–100) are forwarded to fields the source
 *    actually supports.
 *
 * Error honesty: a failed request stays FAILED (or BLOCKED when the source
 * refuses access) — it is never converted into SUCCESS with zero results.
 * A genuine empty search is SUCCESS because the access gate already proved
 * the source AVAILABLE.
 */

import type { DiscoveryRequest } from './request'
import type { AdapterResult, ExecutionError, RawResult } from './types'
import type { SourceAdapter } from './adapter'
import { blockedResult, executedResult } from './adapter'
import type { SourceRegistry } from './registry'
import { DEFAULT_SOURCE_REGISTRY, TED_ADAPTER_TYPE, TED_SOURCE_ID } from './registry'

/** The official TED search endpoint (POST, JSON, no authentication). */
export const TED_SEARCH_ENDPOINT = 'https://api.ted.europa.eu/v3/notices/search'

/** Canonical detail-URL prefix, observed in the source's own `links.html` map. */
export const TED_NOTICE_DETAIL_PREFIX = 'https://ted.europa.eu/en/notice/-/detail/'

/** One HTTP round trip. May answer synchronously (tests) or asynchronously (live). */
export interface TedTransportResponse {
  readonly status: number
  readonly body: string
}

export type TedTransport = (
  url: string,
  init: {
    readonly method: 'POST'
    readonly headers: Readonly<Record<string, string>>
    readonly body: string
  },
) => TedTransportResponse | Promise<TedTransportResponse>

export interface TedAdapterOptions {
  readonly transport: TedTransport
  readonly registry?: SourceRegistry
}

/** A SourceAdapter plus the asynchronous prefetch step for live retrieval. */
export interface TedAdapter extends SourceAdapter {
  /**
   * Performs the live round trip and stores the response for the next
   * synchronous `discover()` of the same run. Never rejects: transport
   * failures are stored and reported by `discover()` as FAILED, so callers
   * can await this unconditionally after the access gate passes.
   */
  retrieve(request: DiscoveryRequest): Promise<void>
}

export const OUTPUT_FIELDS: readonly string[] = [
  'publication-number',
  'notice-title',
  'publication-date',
  'organisation-name-buyer',
  'organisation-country-buyer',
  'deadline',
  'description-glo',
  'notice-type',
  'contract-nature',
  'classification-cpv',
]

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100
const PUBLISHED_SINCE_PATTERN = /^20[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$/
const DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})/

export function buildTedSearchBody(plan: TedQueryPlan): string {
  return JSON.stringify({ query: plan.query, page: 1, limit: plan.limit, fields: OUTPUT_FIELDS })
}

interface TedQueryPlan {
  readonly query: string
  readonly limit: number
  readonly warnings: readonly string[]
}

type QueryPlanResult =
  | { readonly ok: true; readonly plan: TedQueryPlan }
  | { readonly ok: false; readonly message: string; readonly warnings: readonly string[] }

/**
 * Builds the expert-query string from the request's supported filters.
 * The keyword (or, when absent, the first query term) becomes a quoted title
 * search; `publishedSince` narrows by the source's publication-date field.
 * Characters that would break the source's query grammar are removed, with a
 * warning, rather than producing a guaranteed query error.
 */
export function buildTedQueryPlan(request: DiscoveryRequest): QueryPlanResult {
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

  const keyword = (request.keyword ?? '').trim()
  const term = keyword !== '' ? keyword : (request.queryTerms[0] ?? '').trim()
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

  const rawSince = config['publishedSince']
  if (rawSince !== undefined) {
    if (typeof rawSince !== 'string' || !PUBLISHED_SINCE_PATTERN.test(rawSince)) {
      return { ok: false, message: 'adapterConfig.publishedSince must be a YYYYMMDD date string', warnings }
    }
  }

  let query = `notice-title~"${sanitized}"`
  if (typeof rawSince === 'string') query = `${query} AND publication-date>=${rawSince}`

  return { ok: true, plan: { query, limit, warnings } }
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export interface TedParseContext {
  readonly sourceId: string
  readonly observedAt: string
  readonly queryTerm: string | null
}

export interface TedParseOutcome {
  readonly results: readonly RawResult[]
  readonly errors: readonly ExecutionError[]
  readonly warnings: readonly string[]
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

/** Picks the English value, then multilingual, then the first sorted key. */
function pickLocalized(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const map = value as Record<string, unknown>
  const keys = Object.keys(map)
  for (const language of ['eng', 'mul']) {
    const key = keys.find((candidate) => candidate.toLowerCase() === language)
    if (key !== undefined) {
      const found = firstString(map[key])
      if (found !== null) return found
    }
  }
  for (const key of [...keys].sort()) {
    const found = firstString(map[key])
    if (found !== null) return found
  }
  return null
}

function dateText(value: unknown): string | null {
  const text = firstString(value)
  if (text === null) return null
  const match = DATE_PREFIX_PATTERN.exec(text)
  return match !== null ? match[1] : text
}

function detailUrlFor(notice: Record<string, unknown>, publicationNumber: string | null): string | null {
  const links = notice['links']
  if (links !== null && typeof links === 'object' && !Array.isArray(links)) {
    const url = pickLocalized((links as Record<string, unknown>)['html'])
    if (url !== null) return url
  }
  if (publicationNumber !== null) return `${TED_NOTICE_DETAIL_PREFIX}${publicationNumber}`
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Parses a TED search response body into raw results. One item error per
 * unusable entry (missing title or unidentifiable notice); everything else is
 * preserved exactly as the source published it.
 */
export function parseTedSearchBody(body: string, context: TedParseContext): TedParseOutcome {
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
  if (!isRecord(payload) || !Array.isArray(payload['notices'])) {
    return {
      results: [],
      errors: [{ code: 'adapter_error', message: 'source response has an unexpected shape (no notices array)' }],
      warnings: [],
    }
  }

  const notices = payload['notices']
  const totalNoticeCount = typeof payload['totalNoticeCount'] === 'number' ? payload['totalNoticeCount'] : 0
  const timedOut = payload['timedOut'] === true
  const warnings: string[] = []
  if (timedOut && notices.length === 0 && totalNoticeCount > 0) {
    return {
      results: [],
      errors: [
        {
          code: 'adapter_error',
          message: `source response was truncated by a source-side timeout: ${totalNoticeCount} result(s) matched but none were returned`,
        },
      ],
      warnings: [],
    }
  }
  if (timedOut) {
    warnings.push('source reported a timed-out (incomplete) response; returned results may be partial')
  }

  const results: RawResult[] = []
  const errors: ExecutionError[] = []
  notices.forEach((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      errors.push({ code: 'item_error', message: 'notice entry is not an object', itemIndex: index })
      return
    }
    const title = pickLocalized(entry['notice-title'])
    if (title === null) {
      errors.push({ code: 'item_error', message: 'notice entry has no title', itemIndex: index })
      return
    }
    const publicationNumber = firstString(entry['publication-number'])
    const sourceUrl = detailUrlFor(entry, publicationNumber)
    if (sourceUrl === null) {
      errors.push({
        code: 'item_error',
        message: 'notice entry has neither a detail link nor a publication number',
        itemIndex: index,
      })
      return
    }
    results.push({
      sourceRecordId: publicationNumber,
      sourceUrl,
      title,
      description: pickLocalized(entry['description-glo']),
      publicationDate: dateText(entry['publication-date']),
      deadline: dateText(entry['deadline']),
      issuingOrganization: pickLocalized(entry['organisation-name-buyer']),
      country: firstString(entry['organisation-country-buyer']),
      rawType: firstString(entry['notice-type']),
      rawPayload: JSON.stringify(entry),
      rawProvenance: {
        sourceId: context.sourceId,
        sourceUrl,
        sourceRecordId: publicationNumber,
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

function isThenable(value: TedTransportResponse | Promise<TedTransportResponse>): value is Promise<TedTransportResponse> {
  return typeof (value as Promise<TedTransportResponse>).then === 'function'
}

function failureOutcomeFrom(error: unknown): TransportOutcome {
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'failure', message: `source request failed: ${message}` }
}

/**
 * Creates the TED adapter bound to one injected transport. Direct-call guards
 * mirror the GlobalTenders adapter: wrong source, unregistered source, and a
 * non-AVAILABLE access state all return the standard BLOCKED envelope without
 * touching the transport.
 */
export function createTedAdapter(options: TedAdapterOptions): TedAdapter {
  const registry = options.registry ?? DEFAULT_SOURCE_REGISTRY
  let stored: StoredRetrieval | null = null

  function interpret(
    request: DiscoveryRequest,
    sourceName: string,
    plan: TedQueryPlan,
    outcome: TransportOutcome,
  ): AdapterResult {
    const base = {
      request,
      sourceName,
      adapterType: TED_ADAPTER_TYPE,
      accessState: 'AVAILABLE' as const,
      warnings: plan.warnings,
    }

    if (outcome.kind === 'failure') {
      return executedResult({ ...base, results: [], errors: [{ code: 'adapter_error', message: outcome.message }] })
    }
    if (outcome.status === 401 || outcome.status === 403) {
      return blockedResult({
        request,
        sourceName,
        accessState: 'RESTRICTED',
        adapterType: TED_ADAPTER_TYPE,
        reason: `source refused access (HTTP ${outcome.status})`,
        errors: [
          {
            code: 'source_blocked',
            message: `source ${TED_SOURCE_ID} refused the request (HTTP ${outcome.status}); access restrictions are reported, never bypassed`,
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

    const parsed = parseTedSearchBody(outcome.body, {
      sourceId: TED_SOURCE_ID,
      observedAt: request.requestedAt,
      queryTerm: (request.keyword ?? '').trim() || request.queryTerms[0] || null,
    })
    return executedResult({ ...base, results: parsed.results, errors: parsed.errors, warnings: [...plan.warnings, ...parsed.warnings] })
  }

  const init = Object.freeze({
    method: 'POST' as const,
    headers: Object.freeze({ 'content-type': 'application/json' }),
    body: '',
  })

  function requestBodyFor(plan: TedQueryPlan): string {
    return buildTedSearchBody(plan)
  }

  return {
    sourceId: TED_SOURCE_ID,
    adapterType: TED_ADAPTER_TYPE,

    async retrieve(request: DiscoveryRequest): Promise<void> {
      // Validation mirrors discover(); a retrieve for the wrong source or a
      // blocked source stores nothing, so the subsequent discover() reports
      // through its own guards (and the access gate never lets this run).
      if (request.sourceId !== TED_SOURCE_ID) return
      const definition = registry.get(TED_SOURCE_ID)
      if (definition === undefined || definition.accessState !== 'AVAILABLE') return
      const planResult = buildTedQueryPlan(request)
      if (!planResult.ok) return

      const body = requestBodyFor(planResult.plan)
      let outcome: TransportOutcome
      try {
        const answer = await options.transport(TED_SEARCH_ENDPOINT, { ...init, body })
        outcome = { kind: 'response', status: answer.status, body: answer.body }
      } catch (error) {
        outcome = failureOutcomeFrom(error)
      }
      stored = { runId: request.runId, outcome }
    },

    discover(request: DiscoveryRequest): AdapterResult {
      if (request.sourceId !== TED_SOURCE_ID) {
        return blockedResult({
          request,
          reason: 'adapter serves TED only',
          errors: [
            {
              code: 'adapter_not_available',
              message: `adapter for ${TED_SOURCE_ID} cannot serve request for ${request.sourceId}`,
            },
          ],
        })
      }

      const definition = registry.get(TED_SOURCE_ID)
      if (definition === undefined) {
        return blockedResult({
          request,
          reason: 'source is not registered',
          errors: [{ code: 'unknown_source', message: `no registered source with sourceId ${TED_SOURCE_ID}` }],
        })
      }
      if (definition.accessState !== 'AVAILABLE') {
        return blockedResult({
          request,
          sourceName: definition.name,
          accessState: definition.accessState,
          adapterType: TED_ADAPTER_TYPE,
          reason: `source access state ${definition.accessState} is not AVAILABLE`,
          errors: [
            {
              code: 'source_blocked',
              message: `source ${TED_SOURCE_ID} has access state ${definition.accessState}; unauthorized sources are never queried`,
            },
          ],
        })
      }

      const planResult = buildTedQueryPlan(request)
      if (!planResult.ok) {
        return executedResult({
          request,
          sourceName: definition.name,
          adapterType: TED_ADAPTER_TYPE,
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

      const body = requestBodyFor(planResult.plan)
      let answer: TedTransportResponse | Promise<TedTransportResponse>
      try {
        answer = options.transport(TED_SEARCH_ENDPOINT, { ...init, body })
      } catch (error) {
        return interpret(request, definition.name, planResult.plan, failureOutcomeFrom(error))
      }
      if (isThenable(answer)) {
        // An asynchronous transport cannot be awaited by the synchronous
        // SourceAdapter contract; keep the pending promise from surfacing as
        // an unhandled rejection and fail with instructions instead.
        void answer.then(undefined, () => undefined)
        return interpret(request, definition.name, planResult.plan, {
          kind: 'failure',
          message:
            'transport answered asynchronously: await adapter.retrieve(request) before running discovery against this source',
        })
      }
      return interpret(request, definition.name, planResult.plan, {
        kind: 'response',
        status: answer.status,
        body: answer.body,
      })
    },
  }
}
