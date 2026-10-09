/**
 * DiscoveryRequest contract (Architecture §8 / Phase B brief §4).
 *
 * A request carries everything needed to reproduce a discovery request: run and
 * request identity, company and profile identity, the source, the domain, the
 * exact query terms, exclusions, the requested-at timestamp, and the adapter
 * configuration/reference. Requests are created deeply frozen and are immutable
 * during adapter execution.
 */

import type { DiscoveryDomain } from './types'
import { DISCOVERY_DOMAINS } from './types'

export interface DiscoveryRequest {
  runId: string
  companyId: string
  discoveryProfileId: string
  sourceId: string
  domain: DiscoveryDomain
  queryTerms: readonly string[]
  exclusions: readonly string[]
  requestedAt: string
  adapterConfig?: Readonly<Record<string, unknown>>
  /**
   * Optional Phase H discovery filters. The control panel records the founder's
   * sector/keyword/location selection on every request so the workflow can be
   * demonstrated; fixture adapters receive but do not act on them. All three
   * are plain strings, carried through validation unchanged and frozen with
   * the rest of the request. An empty keyword means no keyword filter.
   */
  sector?: string
  keyword?: string
  location?: string
}

export const REQUIRED_DISCOVERY_REQUEST_FIELDS: readonly (keyof DiscoveryRequest)[] = [
  'runId',
  'companyId',
  'discoveryProfileId',
  'sourceId',
  'domain',
  'queryTerms',
  'requestedAt',
]

export type DiscoveryRequestValidation =
  | { ok: true; request: DiscoveryRequest }
  | { ok: false; errors: readonly string[] }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
  const object = value as Record<string, unknown>
  for (const key of Object.keys(object)) {
    const child = object[key]
    if (child !== null && typeof child === 'object') deepFreeze(child)
  }
  return Object.freeze(object) as T
}

/**
 * Validates a request without mutating it. Missing required information yields
 * a list of field-level errors rather than a guess.
 */
export function validateDiscoveryRequest(value: unknown): DiscoveryRequestValidation {
  const errors: string[] = []

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['request must be an object'] }
  }
  const record = value as Record<string, unknown>

  for (const field of REQUIRED_DISCOVERY_REQUEST_FIELDS) {
    if (field === 'queryTerms') {
      if (!Array.isArray(record[field]) || (record[field] as unknown[]).length === 0) {
        errors.push(`missing required field: ${field}`)
      } else if (!(record[field] as unknown[]).every(isNonEmptyString)) {
        errors.push(`field queryTerms must be a non-empty array of non-empty strings`)
      }
      continue
    }
    if (!isNonEmptyString(record[field])) {
      errors.push(`missing required field: ${field}`)
    }
  }

  if (isNonEmptyString(record.domain) && !(DISCOVERY_DOMAINS as readonly string[]).includes(record.domain)) {
    errors.push(`invalid domain: ${String(record.domain)}`)
  }
  if (record.exclusions !== undefined) {
    if (!Array.isArray(record.exclusions) || !(record.exclusions as unknown[]).every(isNonEmptyString)) {
      errors.push('field exclusions must be an array of strings')
    }
  }
  if (record.adapterConfig !== undefined) {
    if (record.adapterConfig === null || typeof record.adapterConfig !== 'object') {
      errors.push('field adapterConfig must be an object')
    }
  }
  for (const field of ['sector', 'keyword', 'location'] as const) {
    if (record[field] !== undefined && typeof record[field] !== 'string') {
      errors.push(`field ${field} must be a string`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  const request: DiscoveryRequest = {
    runId: String(record.runId),
    companyId: String(record.companyId),
    discoveryProfileId: String(record.discoveryProfileId),
    sourceId: String(record.sourceId),
    domain: record.domain as DiscoveryDomain,
    queryTerms: [...(record.queryTerms as string[])],
    exclusions: [...((record.exclusions as string[] | undefined) ?? [])],
    requestedAt: String(record.requestedAt),
    ...(record.adapterConfig !== undefined ? { adapterConfig: { ...(record.adapterConfig as Record<string, unknown>) } } : {}),
    ...(record.sector !== undefined ? { sector: String(record.sector) } : {}),
    ...(record.keyword !== undefined ? { keyword: String(record.keyword) } : {}),
    ...(record.location !== undefined ? { location: String(record.location) } : {}),
  }
  return { ok: true, request: deepFreeze(request) }
}

/**
 * Builds a valid, deeply frozen request. Validation failures throw, so a caller
 * can never construct a request missing required information.
 */
export function createDiscoveryRequest(input: DiscoveryRequest): DiscoveryRequest {
  const result = validateDiscoveryRequest(input)
  if (!result.ok) {
    throw new Error(`invalid DiscoveryRequest: ${result.errors.join('; ')}`)
  }
  return result.request
}