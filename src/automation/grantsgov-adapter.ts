/**
 * Grants.gov source adapter — Phase 19A funding-opportunity foundation.
 *
 * Grants.gov is the official U.S. federal grants portal. Its public search API
 * (`POST https://api.grants.gov/v1/api/search2`) returns *funding
 * opportunity* records — posted/forecasted solicitations that a company can
 * apply to — which is the capability the funding domain was missing (see
 * `qa/funding-discovery-audit.md`). The endpoint is documented as requiring NO
 * authentication and NO API key, so this adapter introduces no credentials and
 * bypasses no access control.
 *
 * Boundary design mirrors the TED and USAspending adapters exactly: this module
 * is pure. It builds the source query, maps a response body to raw results, and
 * shapes the envelope — the HTTP round trip happens in an injected
 * `GrantsGovTransport` (the live implementation belongs in `src/live-source/`,
 * which is intentionally NOT added in this phase). The adapter holds no
 * network, filesystem, clock, or vault primitive.
 *
 * Honesty rules:
 *  - official fields are mapped as the source publishes them; missing fields
 *    stay `null` (no invented titles, dates, URLs, agencies, or amounts);
 *  - `oppStatus` is normalized to a known status or `unknown` — an unrecognized
 *    or malformed status NEVER defaults to `posted`/open;
 *  - the adapter records status and dates but computes NO "is currently open"
 *    verdict; future-close-date validation and eligibility gating are a later
 *    phase;
 *  - failed requests stay FAILED; refused access becomes BLOCKED (never
 *    bypassed); a genuine empty search is SUCCESS because the access gate
 *    already proved the source AVAILABLE.
 */

import type { DiscoveryRequest } from './request'
import type { AccessState, AdapterResult, ExecutionError, RawResult } from './types'
import type { SourceAdapter } from './adapter'
import { blockedResult, executedResult } from './adapter'
import { GRANTS_GOV_ADAPTER_TYPE, GRANTS_GOV_SOURCE_ID } from './registry'

/* ------------------------------------------------------------------ */
/* Source identity and endpoints                                       */
/* ------------------------------------------------------------------ */

export { GRANTS_GOV_ADAPTER_TYPE, GRANTS_GOV_SOURCE_ID }

/** Official Grants.gov opportunity search endpoint (POST, JSON, no auth). */
export const GRANTS_GOV_SEARCH_ENDPOINT = 'https://api.grants.gov/v1/api/search2'

/** Canonical official opportunity detail page prefix (`.../search-results-detail/<id>`). */
export const GRANTS_GOV_OPPORTUNITY_PREFIX = 'https://www.grants.gov/search-results-detail/'

/** Default source name used when the caller supplies no registry definition. */
export const GRANTS_GOV_SOURCE_NAME = 'Grants.gov — Official US Federal Funding Opportunities'

/* ------------------------------------------------------------------ */
/* Status vocabulary                                                   */
/* ------------------------------------------------------------------ */

export const GRANTS_GOV_STATUSES = ['posted', 'forecasted', 'closed', 'archived'] as const
export type GrantsGovStatus = (typeof GRANTS_GOV_STATUSES)[number]
export type GrantsGovNormalizedStatus = GrantsGovStatus | 'unknown'

/**
 * Normalizes a source `oppStatus` value. Anything not exactly one of the four
 * known statuses (wrong case, blank, missing, an array, a number) is `unknown`.
 * `unknown` is deliberate: it must never be read as "open".
 */
export function normalizeGrantsGovStatus(value: unknown): GrantsGovNormalizedStatus {
  if (typeof value !== 'string') return 'unknown'
  const normalized = value.trim().toLowerCase()
  return (GRANTS_GOV_STATUSES as readonly string[]).includes(normalized)
    ? (normalized as GrantsGovStatus)
    : 'unknown'
}

/* ------------------------------------------------------------------ */
/* Query plan                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_ROWS = 10
const MAX_ROWS = 100
/** Default status filter: OPEN, currently-posted opportunities. */
const DEFAULT_STATUSES: readonly GrantsGovStatus[] = ['posted']

export interface GrantsGovQueryPlan {
  readonly keyword: string
  readonly rows: number
  readonly startRecordNum: number
  readonly statuses: readonly GrantsGovStatus[]
  readonly warnings: readonly string[]
}

type QueryPlanResult =
  | { readonly ok: true; readonly plan: GrantsGovQueryPlan }
  | { readonly ok: false; readonly message: string; readonly warnings: readonly string[] }

function parseStatusFilter(raw: unknown, warnings: string[]): readonly GrantsGovStatus[] | null {
  const tokens = Array.isArray(raw)
    ? raw.map((item) => String(item))
    : String(raw).split('|')
  const statuses: GrantsGovStatus[] = []
  const unknownTokens: string[] = []
  for (const token of tokens) {
    const normalized = token.trim().toLowerCase()
    if (normalized === '') continue
    if ((GRANTS_GOV_STATUSES as readonly string[]).includes(normalized)) {
      if (!statuses.includes(normalized as GrantsGovStatus)) statuses.push(normalized as GrantsGovStatus)
    } else {
      unknownTokens.push(token.trim())
    }
  }
  if (unknownTokens.length > 0) {
    warnings.push(`oppStatuses dropped unrecognized value(s): ${unknownTokens.join(', ')}`)
  }
  return statuses.length > 0 ? statuses : null
}

export function buildGrantsGovQueryPlan(request: DiscoveryRequest): QueryPlanResult {
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

  const config = request.adapterConfig ?? {}
  const broad = config['broadSearch'] === true

  const keywordRaw = (request.keyword ?? '').trim()
  const term = keywordRaw !== '' ? keywordRaw : (request.queryTerms[0] ?? '').trim()
  if (term === '' && !broad) {
    return { ok: false, message: 'search term is empty; no query can be built for this source', warnings }
  }
  const keyword = broad ? '' : term
  if (broad) warnings.push('broad search: no keyword supplied, searching all posted opportunities')

  const rawRows = config['rows'] ?? config['limit']
  let rows = DEFAULT_ROWS
  if (typeof rawRows === 'number' && Number.isFinite(rawRows)) {
    const clamped = Math.min(MAX_ROWS, Math.max(1, Math.floor(rawRows)))
    if (clamped !== rawRows) warnings.push(`rows adjusted to ${clamped} (allowed range 1–${MAX_ROWS})`)
    rows = clamped
  }

  const rawStart = config['startRecordNum']
  let startRecordNum = 0
  if (typeof rawStart === 'number' && Number.isFinite(rawStart) && rawStart > 0) {
    startRecordNum = Math.floor(rawStart)
  }

  let statuses: readonly GrantsGovStatus[] = DEFAULT_STATUSES
  const rawStatuses = config['oppStatuses']
  if (rawStatuses !== undefined && rawStatuses !== '') {
    const parsed = parseStatusFilter(rawStatuses, warnings)
    if (parsed === null) {
      return {
        ok: false,
        message: 'adapterConfig.oppStatuses contains no recognized status; refusing to query with an empty status filter',
        warnings,
      }
    }
    statuses = parsed
  }
  warnings.push(`search restricted to source status(es): ${statuses.join('|')} (closed/archived are not requested)`)

  return { ok: true, plan: { keyword, rows, startRecordNum, statuses, warnings } }
}

/**
 * Builds the official no-auth request body: `rows`, `oppStatuses`, optional
 * `keyword` (omitted for a broad search), and optional `startRecordNum`
 * pagination offset.
 */
export function buildGrantsGovSearchBody(plan: GrantsGovQueryPlan): string {
  const body: Record<string, unknown> = {
    rows: plan.rows,
    oppStatuses: plan.statuses.join('|'),
  }
  if (plan.keyword !== '') body.keyword = plan.keyword
  if (plan.startRecordNum > 0) body.startRecordNum = plan.startRecordNum
  return JSON.stringify(body)
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export interface GrantsGovParseContext {
  readonly sourceId: string
  readonly observedAt: string
  readonly queryTerm: string | null
}

export interface GrantsGovParseOutcome {
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

/**
 * Normalizes a Grants.gov date to ISO `YYYY-MM-DD`. The source publishes
 * `MM/DD/YYYY` (observed live, Phase 20C) but may also publish ISO; an
 * unrecognized value returns null rather than a guessed date.
 */
export function normalizeGrantsGovDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
  if (iso !== null) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed)
  if (us !== null) {
    const month = us[1].padStart(2, '0')
    const day = us[2].padStart(2, '0')
    return `${us[3]}-${month}-${day}`
  }
  return null
}

function opportunityUrlFor(id: string): string {
  return `${GRANTS_GOV_OPPORTUNITY_PREFIX}${id}`
}

/**
 * Parses a Grants.gov `search2` response body into raw results. Each entry
 * needs an official `id` (for the stable record id and the canonical detail
 * URL); entries missing it are reported as item errors and dropped rather than
 * given a fabricated identity. Unknown/malformed `oppStatus` values are
 * preserved as `unknown` with a warning — never coerced to `posted`.
 */
export function parseGrantsGovBody(body: string, context: GrantsGovParseContext): GrantsGovParseOutcome {
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
  if (!isRecord(payload) || !isRecord(payload['data']) || !Array.isArray(payload['data']['oppHits'])) {
    return {
      results: [],
      errors: [{ code: 'adapter_error', message: 'source response has an unexpected shape (no data.oppHits array)' }],
      warnings: [],
    }
  }

  const warnings: string[] = []
  const errors: ExecutionError[] = []

  // The source reports its own failures via a non-zero errorcode; honor it.
  const errorcode = payload['errorcode']
  if (typeof errorcode === 'number' && errorcode !== 0) {
    const msg = firstString(payload['msg']) ?? `source reported errorcode ${errorcode}`
    return { results: [], errors: [{ code: 'adapter_error', message: msg }], warnings: [] }
  }

  const data = payload['data'] as Record<string, unknown>
  const errorMsgs = data['errorMsgs']
  if (Array.isArray(errorMsgs)) {
    for (const message of errorMsgs) {
      const text = firstString(message)
      if (text !== null) warnings.push(text)
    }
  }
  if (typeof data['hitCount'] === 'number') {
    warnings.push(`source reported ${data['hitCount']} matching opportunity record(s)`)
  }

  const results: RawResult[] = []
  const entries = data['oppHits'] as unknown[]
  entries.forEach((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      errors.push({ code: 'item_error', message: 'opportunity entry is not an object', itemIndex: index })
      return
    }
    const id = firstString(entry['id'])
    if (id === null) {
      errors.push({ code: 'item_error', message: 'opportunity entry is missing its official id', itemIndex: index })
      return
    }
    const title = firstString(entry['title'])
    const number = firstString(entry['number'])
    const displayTitle = title ?? number
    if (displayTitle === null) {
      errors.push({ code: 'item_error', message: 'opportunity entry has no title or number', itemIndex: index })
      return
    }
    const sourceUrl = opportunityUrlFor(id)
    const status = normalizeGrantsGovStatus(entry['oppStatus'])
    if (status === 'unknown') {
      warnings.push(
        `opportunity ${id} has an unrecognized status ${JSON.stringify(entry['oppStatus'] ?? null)}; recorded as unknown`,
      )
    }
    results.push({
      sourceRecordId: id,
      sourceUrl,
      title: displayTitle,
      description: number,
      publicationDate: normalizeGrantsGovDate(entry['openDate']),
      deadline: normalizeGrantsGovDate(entry['closeDate']),
      issuingOrganization: firstString(entry['agency']) ?? firstString(entry['agencyName']) ?? firstString(entry['agencyCode']),
      country: 'US',
      rawType: 'grant_opportunity',
      sourceStatus: status,
      rawPayload: JSON.stringify(entry),
      rawProvenance: {
        sourceId: context.sourceId,
        sourceUrl,
        sourceRecordId: id,
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

export interface GrantsGovTransportResponse {
  readonly status: number
  readonly body: string
}

export type GrantsGovTransport = (
  url: string,
  init: {
    readonly method: 'POST'
    readonly headers: Readonly<Record<string, string>>
    readonly body: string
  },
) => GrantsGovTransportResponse | Promise<GrantsGovTransportResponse>

export interface GrantsGovSourceIdentity {
  readonly name: string
  readonly accessState: AccessState
}

export interface GrantsGovAdapterOptions {
  readonly transport: GrantsGovTransport
  /**
   * Optional registry lookup. When omitted (this foundation phase ships before
   * the registry entry), the adapter uses GRANTS_GOV_SOURCE_NAME and treats the
   * source as AVAILABLE. When supplied, a missing entry or non-AVAILABLE state
   * is BLOCKED.
   */
  readonly registry?: {
    get(sourceId: string): { name: string; accessState: AccessState } | undefined
  }
}

export interface GrantsGovAdapter extends SourceAdapter {
  retrieve(request: DiscoveryRequest): Promise<void>
}

type TransportOutcome =
  | { readonly kind: 'response'; readonly status: number; readonly body: string }
  | { readonly kind: 'failure'; readonly message: string }

interface StoredRetrieval {
  readonly runId: string
  readonly outcome: TransportOutcome
}

function isThenable(
  value: GrantsGovTransportResponse | Promise<GrantsGovTransportResponse>,
): value is Promise<GrantsGovTransportResponse> {
  return typeof (value as Promise<GrantsGovTransportResponse>).then === 'function'
}

function failureOutcomeFrom(error: unknown): TransportOutcome {
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'failure', message: `source request failed: ${message}` }
}

export function createGrantsGovAdapter(options: GrantsGovAdapterOptions): GrantsGovAdapter {
  let stored: StoredRetrieval | null = null

  function resolveIdentity(): GrantsGovSourceIdentity | null {
    if (options.registry === undefined) {
      return { name: GRANTS_GOV_SOURCE_NAME, accessState: 'AVAILABLE' }
    }
    const definition = options.registry.get(GRANTS_GOV_SOURCE_ID)
    if (definition === undefined) return null
    return { name: definition.name, accessState: definition.accessState }
  }

  function interpret(
    request: DiscoveryRequest,
    identity: GrantsGovSourceIdentity,
    plan: GrantsGovQueryPlan,
    outcome: TransportOutcome,
  ): AdapterResult {
    const base = {
      request,
      sourceName: identity.name,
      adapterType: GRANTS_GOV_ADAPTER_TYPE,
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
        adapterType: GRANTS_GOV_ADAPTER_TYPE,
        reason: `source refused access (HTTP ${outcome.status})`,
        errors: [
          {
            code: 'source_blocked',
            message: `source ${GRANTS_GOV_SOURCE_ID} refused the request (HTTP ${outcome.status}); access restrictions are reported, never bypassed`,
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

    const parsed = parseGrantsGovBody(outcome.body, {
      sourceId: GRANTS_GOV_SOURCE_ID,
      observedAt: request.requestedAt,
      queryTerm: plan.keyword !== '' ? plan.keyword : null,
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
    sourceId: GRANTS_GOV_SOURCE_ID,
    adapterType: GRANTS_GOV_ADAPTER_TYPE,

    async retrieve(request: DiscoveryRequest): Promise<void> {
      if (request.sourceId !== GRANTS_GOV_SOURCE_ID) return
      const identity = resolveIdentity()
      if (identity === null || identity.accessState !== 'AVAILABLE') return
      const planResult = buildGrantsGovQueryPlan(request)
      if (!planResult.ok) return

      const body = buildGrantsGovSearchBody(planResult.plan)
      let outcome: TransportOutcome
      try {
        const answer = await options.transport(GRANTS_GOV_SEARCH_ENDPOINT, { ...init, body })
        outcome = { kind: 'response', status: answer.status, body: answer.body }
      } catch (error) {
        outcome = failureOutcomeFrom(error)
      }
      stored = { runId: request.runId, outcome }
    },

    discover(request: DiscoveryRequest): AdapterResult {
      if (request.sourceId !== GRANTS_GOV_SOURCE_ID) {
        return blockedResult({
          request,
          reason: 'adapter serves Grants.gov only',
          errors: [
            {
              code: 'adapter_not_available',
              message: `adapter for ${GRANTS_GOV_SOURCE_ID} cannot serve request for ${request.sourceId}`,
            },
          ],
        })
      }

      const identity = resolveIdentity()
      if (identity === null) {
        return blockedResult({
          request,
          reason: 'source is not registered',
          errors: [{ code: 'unknown_source', message: `no registered source with sourceId ${GRANTS_GOV_SOURCE_ID}` }],
        })
      }
      if (identity.accessState !== 'AVAILABLE') {
        return blockedResult({
          request,
          sourceName: identity.name,
          accessState: identity.accessState,
          adapterType: GRANTS_GOV_ADAPTER_TYPE,
          reason: `source access state ${identity.accessState} is not AVAILABLE`,
          errors: [
            {
              code: 'source_blocked',
              message: `source ${GRANTS_GOV_SOURCE_ID} has access state ${identity.accessState}; unauthorized sources are never queried`,
            },
          ],
        })
      }

      const planResult = buildGrantsGovQueryPlan(request)
      if (!planResult.ok) {
        return executedResult({
          request,
          sourceName: identity.name,
          adapterType: GRANTS_GOV_ADAPTER_TYPE,
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

      const body = buildGrantsGovSearchBody(planResult.plan)
      let answer: GrantsGovTransportResponse | Promise<GrantsGovTransportResponse>
      try {
        answer = options.transport(GRANTS_GOV_SEARCH_ENDPOINT, { ...init, body })
      } catch (error) {
        return interpret(request, identity, planResult.plan, failureOutcomeFrom(error))
      }
      if (isThenable(answer)) {
        void answer.then(undefined, () => undefined)
        return interpret(request, identity, planResult.plan, {
          kind: 'failure',
          message:
            'transport answered asynchronously: await adapter.retrieve(request) before running discovery against this source',
        })
      }
      return interpret(request, identity, planResult.plan, {
        kind: 'response',
        status: answer.status,
        body: answer.body,
      })
    },
  }
}
