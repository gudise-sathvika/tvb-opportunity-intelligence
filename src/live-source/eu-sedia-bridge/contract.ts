/**
 * Shared contract between the browser control panel and the Phase 21C EU
 * Funding & Tenders Portal (SEDIA) bridge (same-origin live grant search).
 *
 * Dependency-free contract module (types + endpoint constant) mirroring the TED,
 * USAspending, and Grants.gov bridge contracts. See `handler.ts` for the one
 * real read-only search and `plugin.ts` for the Vite middleware.
 */

export const EU_SEDIA_BRIDGE_SEARCH_PATH = '/__tvb/eu/search'

export interface EuSediaBridgeSearchRequest {
  runId: string
  companyId: string
  /** Free-text query term; blank runs a broad search of requested EU grant/funding calls. */
  keyword: string
  /** Source result limit (1–100) forwarded as `pageSize`. */
  limit: number
  requestedAt: string
}

export interface EuSediaBridgeError {
  readonly code: string
  readonly message: string
}

export type EuSediaBridgeSearchResponse =
  | { readonly ok: true; readonly status: number; readonly body: string }
  | {
      readonly ok: false
      readonly status: number
      readonly body: string | null
      readonly errors: readonly EuSediaBridgeError[]
    }
