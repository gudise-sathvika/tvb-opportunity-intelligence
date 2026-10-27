/**
 * UK Contracts Finder source adapter.
 *
 * Mirrors the UK Find a Tender adapter but uses the Contracts Finder OCDS
 * release-package endpoint.
 */

import type { DiscoveryRequest } from './request'
import type { AccessState, ExecutionError, RawResult } from './types'
import type { SourceAdapter } from './adapter'
export const CONTRACTS_FINDER_SOURCE_ID = 'SU-CF-001'
export const CONTRACTS_FINDER_ADAPTER_TYPE = 'contractsfinder'

export const CONTRACTS_FINDER_SEARCH_ENDPOINT =
  'https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search'

export const CONTRACTS_FINDER_SOURCE_NAME = 'UK Contracts Finder — Official UK Procurement Notices'

export interface ContractsFinderQueryPlan {
  readonly limit: number
  readonly warnings: readonly string[]
}

type QueryPlanResult =
  | { readonly ok: true; readonly plan: ContractsFinderQueryPlan }
  | { readonly ok: false; readonly message: string; readonly warnings: readonly string[] }

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100

export function buildContractsFinderQueryPlan(request: DiscoveryRequest): QueryPlanResult {
  const warnings: string[] = []
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

export function buildContractsFinderSearchUrl(plan: ContractsFinderQueryPlan): string {
  const params = new URLSearchParams({ limit: String(plan.limit) })
  return `${CONTRACTS_FINDER_SEARCH_ENDPOINT}?${params.toString()}`
}

export interface ContractsFinderParseContext {
  readonly sourceId: string
  readonly observedAt: string
  readonly queryTerm: string | null
}

export interface ContractsFinderParseOutcome {
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
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text)
  return match !== null ? match[1] : text
}

export function parseContractsFinderBody(body: string, context: ContractsFinderParseContext): ContractsFinderParseOutcome {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return { results: [], errors: [{ code: 'adapter_error', message: 'source response was not valid JSON' }], warnings: [] }
  }
  if (!isRecord(payload) || !Array.isArray(payload['releases'])) {
    return { results: [], errors: [{ code: 'adapter_error', message: 'source response has an unexpected shape (no releases array)' }], warnings: [] }
  }

  const releases = payload['releases'] as unknown[]
  const results: RawResult[] = []
  const errors: ExecutionError[] = []
  const warnings: string[] = []

  releases.forEach((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      errors.push({ code: 'item_error', message: 'release entry is not an object', itemIndex: index })
      return
    }
    const tender = isRecord(entry['tender']) ? entry['tender'] : null
    const title = tender !== null ? pickLocalized(tender['title']) : null
    if (title === null) {
      errors.push({ code: 'item_error', message: 'release entry has no title', itemIndex: index })
      return
    }
    const ocid = firstString(entry['ocid'])
    const id = firstString(entry['id'])
    const sourceRecordId = id ?? ocid
    if (sourceRecordId === null) {
      errors.push({ code: 'item_error', message: 'release entry has no id or ocid', itemIndex: index })
      return
    }
    const buyer = isRecord(entry['buyer']) ? entry['buyer'] : null
    const buyerName = buyer !== null ? pickLocalized(buyer['name']) : null
    const tenderPeriod = tender !== null && isRecord(tender['tenderPeriod']) ? tender['tenderPeriod'] : null
    const deadline = tenderPeriod !== null ? dateText(tenderPeriod['endDate']) : null
    const publicationDate = dateText(entry['date'])
    const status = tender !== null ? firstString(tender['status']) : null
    const sourceUrl = `https://www.contractsfinder.service.gov.uk/Notice/${sourceRecordId}`

    results.push({
      sourceRecordId,
      sourceUrl,
      title,
      description: tender !== null ? pickLocalized(tender['description']) : null,
      publicationDate,
      deadline,
      issuingOrganization: buyerName,
      country: 'UK',
      rawType: tender !== null ? firstString(tender['procurementMethod']) : null,
      sourceStatus: status,
      rawPayload: JSON.stringify(entry),
      rawProvenance: {
        sourceId: context.sourceId,
        sourceUrl,
        sourceRecordId,
        observedAt: context.observedAt,
        queryTerm: context.queryTerm,
      },
    })
  })

  return { results, errors, warnings }
}

export interface ContractsFinderTransportResponse {
  readonly status: number
  readonly body: string
}

export type ContractsFinderTransport = (
  url: string,
  init: { readonly method: 'GET'; readonly headers: Readonly<Record<string, string>> },
) => ContractsFinderTransportResponse | Promise<ContractsFinderTransportResponse>

export interface ContractsFinderAdapterOptions {
  readonly transport: ContractsFinderTransport
  readonly registry?: {
    get(sourceId: string): { name: string; accessState: AccessState } | undefined
  }
}

export interface ContractsFinderAdapter extends SourceAdapter {
  retrieve(request: DiscoveryRequest): Promise<void>
}

// Minimal adapter shell; full integration is not wired into the UI in this phase.
export function createContractsFinderAdapter(_options: ContractsFinderAdapterOptions): ContractsFinderAdapter {
  return {
    sourceId: 'SU-CF-001',
    adapterType: 'contractsfinder',
    discover: () => ({ status: 'SUCCESS', sourceId: 'SU-CF-001', adapterType: 'contractsfinder', runId: null, domain: null, accessState: 'AVAILABLE', requestedAt: null, observedAt: new Date().toISOString(), blockedReason: null, results: [], errors: [], warnings: [], provenance: { runId: null, companyId: null, discoveryProfileId: null, sourceId: 'SU-CF-001', sourceName: CONTRACTS_FINDER_SOURCE_NAME, sourceUrl: null, adapterType: 'contractsfinder', domain: null, accessState: 'AVAILABLE', requestedAt: null, observedAt: new Date().toISOString() } }),
    retrieve: async () => {},
  }
}