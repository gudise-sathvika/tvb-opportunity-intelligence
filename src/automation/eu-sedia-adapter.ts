/**
 * EU Funding & Tenders Portal (SEDIA) source adapter — Phase 21C.
 *
 * The EU Funding & Tenders Portal exposes its official public search through
 * the European Commission `search-api` SEDIA collection. Phases 21A/21B
 * verified the endpoint and pinned its classification contract by direct
 * bounded read-only requests:
 *
 *   POST https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=<q>
 *        multipart/form-data; parts: `query` (application/json), `languages` (["en"]),
 *        `displayLanguage` (en)
 *
 * This adapter is pure: it builds the multipart query, maps a response body to
 * raw results, and shapes the envelope. The HTTP round trip happens in an
 * injected `EuSediaTransport` (the live implementation lives in
 * `src/live-source/`). No network, filesystem, clock, or vault primitive here.
 *
 * Classification is keyed on DATASOURCE + `type`, NEVER on `type` alone
 * (Phase 21B): `type` is database-scoped and the FAQ collection reuses the same
 * field. `SEDIA_FAQ` documents are excluded; a record with an unrecognized
 * database/type stays UNKNOWN rather than being guessed. EU tenders (`type 0`)
 * are classified but deliberately NOT requested this phase.
 *
 * Honesty: missing source values stay `null`; an unrecognized status becomes
 * `unknown` (never read as open); no "is currently open" verdict is computed
 * here — that gate is a separate rule (`eu-sedia-gate.ts`).
 */

import type { DiscoveryRequest } from './request'
import type { AccessState, AdapterResult, ExecutionError, RawResult } from './types'
import type { SourceAdapter } from './adapter'
import { blockedResult, executedResult } from './adapter'
import { EU_SEDIA_ADAPTER_TYPE, EU_SEDIA_SOURCE_ID } from './registry'

export { EU_SEDIA_ADAPTER_TYPE, EU_SEDIA_SOURCE_ID }

/** Official EU Funding & Tenders Portal search endpoint (POST multipart, no login). */
export const EU_SEDIA_SEARCH_ENDPOINT = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search'

/** Public, documented, read-only API key for the SEDIA collection. */
export const EU_SEDIA_API_KEY = 'SEDIA'

/** Official EU portal referer/origin sent by the portal itself. */
export const EU_SEDIA_REFERER = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/'
export const EU_SEDIA_ORIGIN = 'https://ec.europa.eu'

export const EU_SEDIA_SOURCE_NAME = 'EU Funding & Tenders Portal — EU Grants & Cascade Funding (official, public)'

/* ------------------------------------------------------------------ */
/* Classification contract (Phase 21B)                                 */
/* ------------------------------------------------------------------ */

/** SEDIA `type` codes verified in Phase 21B (database SEDIA). */
export const EU_SEDIA_TYPE_CODES = {
  TENDER: '0',
  GRANT_TOPIC: '1',
  EXTERNAL_ACTION_GRANT: '2',
  CASCADE_FUNDING_CALL: '8',
} as const

export type EuSediaRecordType =
  | 'TENDER'
  | 'GRANT_TOPIC'
  | 'EXTERNAL_ACTION_GRANT'
  | 'CASCADE_FUNDING_CALL'

/** Record types this phase requests (tenders excluded — contract not fully verified). */
export const EU_SEDIA_REQUESTED_TYPES: readonly string[] = [
  EU_SEDIA_TYPE_CODES.GRANT_TOPIC,
  EU_SEDIA_TYPE_CODES.EXTERNAL_ACTION_GRANT,
  EU_SEDIA_TYPE_CODES.CASCADE_FUNDING_CALL,
]

/** The FAQ collection reuses `type`; it is excluded, never classified. */
export const EU_SEDIA_FAQ_DATASOURCE = 'SEDIA_FAQ'

export type EuSediaClassification = EuSediaRecordType | 'FAQ_DOCUMENT' | null

/**
 * Classifies a SEDIA record from its DATASOURCE and `type` code. Keying on
 * DATASOURCE prevents the FAQ collection (which shares `type`) from ever being
 * read as a solicitation; a non-SEDIA database or an unknown code is `null`
 * (UNKNOWN), never guessed.
 */
export function classifyEuSediaRecord(datasource: string | null, typeCode: string | null): EuSediaClassification {
  const source = (datasource ?? '').trim().toUpperCase()
  if (source === EU_SEDIA_FAQ_DATASOURCE) return 'FAQ_DOCUMENT'
  // Phase 21B: SEDIA_PRD_CENTRICITY is a centroid duplicate of the SEDIA database.
  if (source !== 'SEDIA' && source !== 'SEDIA_PRD_CENTRICITY') return null
  const code = (typeCode ?? '').trim()
  switch (code) {
    case EU_SEDIA_TYPE_CODES.TENDER:
      return 'TENDER'
    case EU_SEDIA_TYPE_CODES.GRANT_TOPIC:
      return 'GRANT_TOPIC'
    case EU_SEDIA_TYPE_CODES.EXTERNAL_ACTION_GRANT:
      return 'EXTERNAL_ACTION_GRANT'
    case EU_SEDIA_TYPE_CODES.CASCADE_FUNDING_CALL:
      return 'CASCADE_FUNDING_CALL'
    default:
      return null
  }
}

/** SEDIA `status` codes verified in Phase 21B. */
export const EU_SEDIA_STATUS_CODES = {
  FORTHCOMING: '31094501',
  OPEN: '31094502',
  CLOSED: '31094503',
} as const

export type EuSediaNormalizedStatus = 'forthcoming' | 'open' | 'closed' | 'unknown'

/** Normalizes a source status code to a known lifecycle value or `unknown`. */
export function normalizeEuSediaStatus(value: unknown): EuSediaNormalizedStatus {
  const raw = typeof value === 'string' ? value.trim() : ''
  switch (raw) {
    case EU_SEDIA_STATUS_CODES.FORTHCOMING:
      return 'forthcoming'
    case EU_SEDIA_STATUS_CODES.OPEN:
      return 'open'
    case EU_SEDIA_STATUS_CODES.CLOSED:
      return 'closed'
    default:
      return 'unknown'
  }
}

/** Official detail-page prefix for topic/call records built from `reference`. */
export const EU_SEDIA_TOPIC_DETAILS_PREFIX =
  'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/'

/* ------------------------------------------------------------------ */
/* Query plan                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_ROWS = 10
const MAX_ROWS = 100
const DEFAULT_STATUSES: readonly string[] = [EU_SEDIA_STATUS_CODES.FORTHCOMING, EU_SEDIA_STATUS_CODES.OPEN]

export interface EuSediaQueryPlan {
  readonly text: string
  readonly rows: number
  readonly types: readonly string[]
  readonly statuses: readonly string[]
  readonly excludeDatasources: readonly string[]
  readonly warnings: readonly string[]
}

type QueryPlanResult =
  | { readonly ok: true; readonly plan: EuSediaQueryPlan }
  | { readonly ok: false; readonly message: string; readonly warnings: readonly string[] }

function parseStringList(raw: unknown, warnings: string[], label: string): readonly string[] {
  const tokens = Array.isArray(raw) ? raw.map((item) => String(item)) : String(raw).split('|')
  const values: string[] = []
  for (const token of tokens) {
    const trimmed = token.trim()
    if (trimmed === '') continue
    if (!values.includes(trimmed)) values.push(trimmed)
  }
  if (values.length === 0) warnings.push(`${label} filter was empty and is ignored`)
  return values
}

export function buildEuSediaQueryPlan(request: DiscoveryRequest): QueryPlanResult {
  const warnings: string[] = []
  if (request.sector !== undefined && request.sector !== '' && request.sector !== 'all') {
    warnings.push(`sector filter "${request.sector}" was not applied: this source has no supported sector mapping`)
  }
  if (request.location !== undefined && request.location !== '' && request.location !== 'all') {
    warnings.push(
      `location filter "${request.location}" was not applied: this source covers EU-wide funding, not a free-text location`,
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
  const text = broad || term === '*' ? '*' : term
  if (broad || term === '*') warnings.push('broad search: no keyword supplied, searching all requested EU grant/funding calls')

  const rawRows = config['rows'] ?? config['limit']
  let rows = DEFAULT_ROWS
  if (typeof rawRows === 'number' && Number.isFinite(rawRows)) {
    const clamped = Math.min(MAX_ROWS, Math.max(1, Math.floor(rawRows)))
    if (clamped !== rawRows) warnings.push(`rows adjusted to ${clamped} (allowed range 1–${MAX_ROWS})`)
    rows = clamped
  }

  let types: readonly string[] = EU_SEDIA_REQUESTED_TYPES
  const rawTypes = config['types']
  if (rawTypes !== undefined && rawTypes !== '') {
    const parsed = parseStringList(rawTypes, warnings, 'type')
    if (parsed.length > 0) types = parsed
  }

  let statuses: readonly string[] = DEFAULT_STATUSES
  const rawStatuses = config['statuses']
  if (rawStatuses !== undefined && rawStatuses !== '') {
    const parsed = parseStringList(rawStatuses, warnings, 'status')
    if (parsed.length > 0) statuses = parsed
  }
  warnings.push(`search restricted to SEDIA type(s): ${types.join('|')} and status(es): ${statuses.join('|')}`)

  return {
    ok: true,
    plan: { text, rows, types, statuses, excludeDatasources: [EU_SEDIA_FAQ_DATASOURCE], warnings },
  }
}

/** The `query` JSON part sent to SEDIA (ES bool query). */
export function buildEuSediaQuery(plan: EuSediaQueryPlan): Record<string, unknown> {
  const must: unknown[] = []
  if (plan.types.length > 0) must.push({ terms: { type: [...plan.types] } })
  if (plan.statuses.length > 0) must.push({ terms: { status: [...plan.statuses] } })
  const mustNot: unknown[] = []
  if (plan.excludeDatasources.length > 0) mustNot.push({ terms: { DATASOURCE: [...plan.excludeDatasources] } })
  return { bool: { must, must_not: mustNot } }
}

export const EU_SEDIA_MULTIPART_BOUNDARY = '----TVBEuSediaBoundary21C'

/**
 * Builds the multipart/form-data body with exactly the three parts the portal
 * sends: `query` (JSON), `languages` (JSON), `displayLanguage` (text).
 */
export function buildEuSediaSearchBody(plan: EuSediaQueryPlan): string {
  const queryJson = JSON.stringify(buildEuSediaQuery(plan))
  const b = EU_SEDIA_MULTIPART_BOUNDARY
  return (
    `--${b}\r\n` +
    `Content-Disposition: form-data; name="query"\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${queryJson}\r\n` +
    `--${b}\r\n` +
    `Content-Disposition: form-data; name="languages"\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `["en"]\r\n` +
    `--${b}\r\n` +
    `Content-Disposition: form-data; name="displayLanguage"\r\n` +
    `Content-Type: text/plain\r\n\r\n` +
    `en\r\n` +
    `--${b}--\r\n`
  )
}

/** The multipart Content-Type header matching `buildEuSediaSearchBody`. */
export const EU_SEDIA_CONTENT_TYPE = `multipart/form-data; boundary=${EU_SEDIA_MULTIPART_BOUNDARY}`

/** Full request URL with the public apiKey and query parameters. */
export function buildEuSediaSearchUrl(plan: EuSediaQueryPlan): string {
  const params = new URLSearchParams({
    apiKey: EU_SEDIA_API_KEY,
    text: plan.text,
    pageSize: String(plan.rows),
    pageNumber: '1',
  })
  return `${EU_SEDIA_SEARCH_ENDPOINT}?${params.toString()}`
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export interface EuSediaParseContext {
  readonly sourceId: string
  readonly observedAt: string
  readonly queryTerm: string | null
}

export interface EuSediaParseOutcome {
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

const EU_SEDIA_NUMERIC_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

/**
 * Normalizes a SEDIA date to ISO `YYYY-MM-DD`. Accepts a full ISO datetime
 * (`2026-01-01T00:00:00Z`), a bare ISO date, or `DD/MM/YYYY`; anything else is
 * `null` rather than a guessed date.
 */
export function normalizeEuSediaDate(value: unknown): string | null {
  const raw = firstString(value)
  if (raw === null) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (iso !== null) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = EU_SEDIA_NUMERIC_DATE.exec(raw)
  if (dmy !== null) {
    const day = dmy[1].padStart(2, '0')
    const month = dmy[2].padStart(2, '0')
    return `${dmy[3]}-${month}-${day}`
  }
  return null
}

/**
 * Parses a SEDIA `search` response body into raw results. Each record needs a
 * stable `reference`; FAQ documents are excluded, unknown databases/types stay
 * UNKNOWN, and duplicate references are collapsed to the first occurrence.
 */
export function parseEuSediaBody(body: string, context: EuSediaParseContext): EuSediaParseOutcome {
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
  const errors: ExecutionError[] = []
  if (typeof payload['totalResults'] === 'number') {
    warnings.push(`source reported ${payload['totalResults']} matching record(s)`)
  }

  const seen = new Set<string>()
  const results: RawResult[] = []
  let faqExcluded = 0
  const entries = payload['results'] as unknown[]
  entries.forEach((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      errors.push({ code: 'item_error', message: 'result entry is not an object', itemIndex: index })
      return
    }
    const reference = firstString(entry['reference'])
    if (reference === null) {
      errors.push({ code: 'item_error', message: 'result entry is missing its reference', itemIndex: index })
      return
    }
    if (seen.has(reference)) {
      warnings.push(`duplicate reference ${reference} collapsed to the first occurrence`)
      return
    }
    seen.add(reference)

    const metadata = isRecord(entry['metadata']) ? entry['metadata'] : {}
    const datasource = firstString(metadata['DATASOURCE'])
    const typeCode = firstString(metadata['type'])
    const recordType = classifyEuSediaRecord(datasource, typeCode)
    if (recordType === 'FAQ_DOCUMENT') {
      faqExcluded += 1
      return
    }

    const status = normalizeEuSediaStatus(firstString(metadata['status']))
    if (status === 'unknown' && firstString(metadata['status']) !== null) {
      warnings.push(`record ${reference} has an unrecognized status ${JSON.stringify(firstString(metadata['status']))}; recorded as unknown`)
    }
    if (recordType === null) {
      warnings.push(`record ${reference} has an unrecognized database/type (${JSON.stringify(datasource)}/${JSON.stringify(typeCode)}); recorded as UNKNOWN`)
    }
    if (recordType === 'TENDER') {
      warnings.push(`record ${reference} classifies as an EU tender; this phase does not request or present tenders`)
    }

    const title = firstString(metadata['title']) ?? firstString(metadata['callIdentifier']) ?? reference
    const callIdentifier = firstString(metadata['callIdentifier'])
    const url = firstString(entry['url']) ?? ''
    const deadline = normalizeEuSediaDate(metadata['deadlineDate'])
    const publicationDate = normalizeEuSediaDate(metadata['es_SortDate'])

    results.push({
      sourceRecordId: reference,
      sourceUrl: url,
      title,
      description: callIdentifier,
      publicationDate,
      deadline,
      issuingOrganization: null,
      country: 'EU',
      rawType: recordType,
      sourceStatus: status,
      rawPayload: JSON.stringify(metadata),
      rawProvenance: {
        sourceId: context.sourceId,
        sourceUrl: url,
        sourceRecordId: reference,
        observedAt: context.observedAt,
        queryTerm: context.queryTerm,
      },
    })
  })

  if (faqExcluded > 0) warnings.push(`${faqExcluded} FAQ document(s) were excluded`)

  return { results, errors, warnings }
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

export interface EuSediaTransportResponse {
  readonly status: number
  readonly body: string
}

export type EuSediaTransport = (
  url: string,
  init: {
    readonly method: 'POST'
    readonly headers: Readonly<Record<string, string>>
    readonly body: string
  },
) => EuSediaTransportResponse | Promise<EuSediaTransportResponse>

export interface EuSediaSourceIdentity {
  readonly name: string
  readonly accessState: AccessState
}

export interface EuSediaAdapterOptions {
  readonly transport: EuSediaTransport
  readonly registry?: {
    get(sourceId: string): { name: string; accessState: AccessState } | undefined
  }
}

export interface EuSediaAdapter extends SourceAdapter {
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
  value: EuSediaTransportResponse | Promise<EuSediaTransportResponse>,
): value is Promise<EuSediaTransportResponse> {
  return typeof (value as Promise<EuSediaTransportResponse>).then === 'function'
}

function failureOutcomeFrom(error: unknown): TransportOutcome {
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'failure', message: `source request failed: ${message}` }
}

export function createEuSediaAdapter(options: EuSediaAdapterOptions): EuSediaAdapter {
  let stored: StoredRetrieval | null = null

  function resolveIdentity(): EuSediaSourceIdentity | null {
    if (options.registry === undefined) {
      return { name: EU_SEDIA_SOURCE_NAME, accessState: 'AVAILABLE' }
    }
    const definition = options.registry.get(EU_SEDIA_SOURCE_ID)
    if (definition === undefined) return null
    return { name: definition.name, accessState: definition.accessState }
  }

  function interpret(
    request: DiscoveryRequest,
    identity: EuSediaSourceIdentity,
    plan: EuSediaQueryPlan,
    outcome: TransportOutcome,
  ): AdapterResult {
    const base = {
      request,
      sourceName: identity.name,
      adapterType: EU_SEDIA_ADAPTER_TYPE,
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
        adapterType: EU_SEDIA_ADAPTER_TYPE,
        reason: `source refused access (HTTP ${outcome.status})`,
        errors: [
          {
            code: 'source_blocked',
            message: `source ${EU_SEDIA_SOURCE_ID} refused the request (HTTP ${outcome.status}); access restrictions are reported, never bypassed`,
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

    const parsed = parseEuSediaBody(outcome.body, {
      sourceId: EU_SEDIA_SOURCE_ID,
      observedAt: request.requestedAt,
      queryTerm: plan.text === '*' ? null : plan.text,
    })
    return executedResult({
      ...base,
      results: parsed.results,
      errors: parsed.errors,
      warnings: [...base.warnings, ...parsed.warnings],
    })
  }

  return {
    sourceId: EU_SEDIA_SOURCE_ID,
    adapterType: EU_SEDIA_ADAPTER_TYPE,

    async retrieve(request: DiscoveryRequest): Promise<void> {
      if (request.sourceId !== EU_SEDIA_SOURCE_ID) return
      const identity = resolveIdentity()
      if (identity === null || identity.accessState !== 'AVAILABLE') return
      const planResult = buildEuSediaQueryPlan(request)
      if (!planResult.ok) return

      const body = buildEuSediaSearchBody(planResult.plan)
      let outcome: TransportOutcome
      try {
        const answer = await options.transport(buildEuSediaSearchUrl(planResult.plan), {
          method: 'POST',
          headers: { 'content-type': EU_SEDIA_CONTENT_TYPE },
          body,
        })
        outcome = { kind: 'response', status: answer.status, body: answer.body }
      } catch (error) {
        outcome = failureOutcomeFrom(error)
      }
      stored = { runId: request.runId, outcome }
    },

    discover(request: DiscoveryRequest): AdapterResult {
      if (request.sourceId !== EU_SEDIA_SOURCE_ID) {
        return blockedResult({
          request,
          reason: 'adapter serves the EU Funding & Tenders Portal only',
          errors: [
            {
              code: 'adapter_not_available',
              message: `adapter for ${EU_SEDIA_SOURCE_ID} cannot serve request for ${request.sourceId}`,
            },
          ],
        })
      }

      const identity = resolveIdentity()
      if (identity === null) {
        return blockedResult({
          request,
          reason: 'source is not registered',
          errors: [{ code: 'unknown_source', message: `no registered source with sourceId ${EU_SEDIA_SOURCE_ID}` }],
        })
      }
      if (identity.accessState !== 'AVAILABLE') {
        return blockedResult({
          request,
          sourceName: identity.name,
          accessState: identity.accessState,
          adapterType: EU_SEDIA_ADAPTER_TYPE,
          reason: `source access state ${identity.accessState} is not AVAILABLE`,
          errors: [
            {
              code: 'source_blocked',
              message: `source ${EU_SEDIA_SOURCE_ID} has access state ${identity.accessState}; unauthorized sources are never queried`,
            },
          ],
        })
      }

      const planResult = buildEuSediaQueryPlan(request)
      if (!planResult.ok) {
        return executedResult({
          request,
          sourceName: identity.name,
          adapterType: EU_SEDIA_ADAPTER_TYPE,
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

      const body = buildEuSediaSearchBody(planResult.plan)
      let answer: EuSediaTransportResponse | Promise<EuSediaTransportResponse>
      try {
        answer = options.transport(buildEuSediaSearchUrl(planResult.plan), {
          method: 'POST',
          headers: { 'content-type': EU_SEDIA_CONTENT_TYPE },
          body,
        })
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
