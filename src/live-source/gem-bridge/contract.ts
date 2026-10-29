/**
 * Contract between browser discovery controls and the GeM / CPPP India Procurement bridge.
 *
 * Covers Indian central/state government and public sector IT procurement:
 *   POST /__tvb/gem/search
 */

export const GEM_BRIDGE_SEARCH_PATH = '/__tvb/gem/search'

export interface GemBridgeSearchRequest {
  readonly runId: string
  readonly companyId: string
  readonly keyword: string
  readonly limit?: number
  readonly requestedAt?: string
}

export interface GemNotice {
  readonly tenderId: string
  readonly title: string
  readonly ministry: string
  readonly organization: string
  readonly department: string
  readonly description: string
  readonly valueInr: string
  readonly deadline: string
  readonly state: string
  readonly status: 'Active' | 'Under Evaluation' | 'Awarded'
  readonly portalUrl: string
  readonly categories: readonly string[]
  readonly requirements: readonly string[]
}

export interface GemBridgeError {
  readonly code: string
  readonly message: string
}

export type GemBridgeSearchResponse =
  | { readonly ok: true; readonly status: number; readonly body: string }
  | {
      readonly ok: false
      readonly status: number
      readonly body: string | null
      readonly errors: readonly GemBridgeError[]
    }

