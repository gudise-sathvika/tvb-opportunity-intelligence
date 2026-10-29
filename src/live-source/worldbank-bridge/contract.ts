/**
 * Contract between browser discovery controls and the World Bank & MDB Procurement Bridge.
 *
 * Covers multilateral international development contracts open to Indian and global tech firms:
 *   POST /__tvb/worldbank/search
 */

export const WORLDBANK_BRIDGE_SEARCH_PATH = '/__tvb/worldbank/search'

export interface WorldBankBridgeSearchRequest {
  readonly runId: string
  readonly companyId: string
  readonly keyword: string
  readonly limit?: number
  readonly requestedAt?: string
}

export interface WorldBankNotice {
  readonly noticeId: string
  readonly projectTitle: string
  readonly country: string
  readonly sector: string
  readonly description: string
  readonly deadline: string
  readonly noticeType: string
  readonly noticeUrl: string
  readonly eligibleNationalities: string
}

export interface WorldBankBridgeError {
  readonly code: string
  readonly message: string
}

export type WorldBankBridgeSearchResponse =
  | { readonly ok: true; readonly status: number; readonly body: string }
  | {
      readonly ok: false
      readonly status: number
      readonly body: string | null
      readonly errors: readonly WorldBankBridgeError[]
    }

