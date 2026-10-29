/**
 * Contract between browser discovery controls and the Indian Innovation Grants Bridge.
 *
 * Covers non-dilutive government grants from MeitY, iDEX, Startup India, and DST:
 *   POST /__tvb/india-grants/search
 */

export const INDIA_GRANTS_BRIDGE_SEARCH_PATH = '/__tvb/india-grants/search'

export interface IndiaGrantsBridgeSearchRequest {
  readonly runId: string
  readonly companyId: string
  readonly keyword: string
  readonly limit?: number
  readonly requestedAt?: string
}

export interface IndiaGrantOpportunity {
  readonly grantId: string
  readonly title: string
  readonly agency: string
  readonly programName: string
  readonly description: string
  readonly grantAmountInr: string
  readonly deadline: string
  readonly eligibleEntityTypes: readonly string[]
  readonly sectorFocus: readonly string[]
  readonly applicationUrl: string
  readonly status: 'Open' | 'Upcoming' | 'Rolling'
  readonly state?: string
}

export interface IndiaGrantsBridgeError {
  readonly code: string
  readonly message: string
}

export type IndiaGrantsBridgeSearchResponse =
  | { readonly ok: true; readonly status: number; readonly body: string }
  | {
      readonly ok: false
      readonly status: number
      readonly body: string | null
      readonly errors: readonly IndiaGrantsBridgeError[]
    }

