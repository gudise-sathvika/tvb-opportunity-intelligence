/**
 * Shared contract between the browser control panel and the Phase 19B
 * Grants.gov bridge (same-origin live funding-opportunity search).
 *
 * Dependency-free contract module (types + endpoint constant) mirroring the
 * Phase 4 TED and Phase V USAspending bridge contracts. The Node side lives in
 * `handler.ts` (one real read-only Grants.gov search) and `plugin.ts` (HTTP
 * middleware on the Vite dev and preview servers); the browser reaches it with
 * a plain `fetch` to this same-origin endpoint.
 *
 * Safety invariants: the request body carries only discovery parameters and
 * the source/endpoint are fixed server-side; the bridge performs ONE read-only,
 * unauthenticated POST and returns the raw status + body unchanged (the adapter
 * in the browser normalizes status and provenance); a handler-side failure is
 * reported with explicit `errors`, never converted into an empty success.
 */

export const GRANTS_GOV_BRIDGE_SEARCH_PATH = '/__tvb/grantsgov/search'

export interface GrantsGovBridgeSearchRequest {
  runId: string
  companyId: string
  keyword: string
  /** Pipe- or array-form source status filter (posted|forecasted|closed|archived); blank uses the adapter default (posted|forecasted). */
  oppStatuses: string
  /** Source result limit (1–100) forwarded as `rows`. */
  limit: number
  requestedAt: string
}

export interface GrantsGovBridgeError {
  readonly code: string
  readonly message: string
}

export type GrantsGovBridgeSearchResponse =
  | { readonly ok: true; readonly status: number; readonly body: string }
  | {
      readonly ok: false
      readonly status: number
      readonly body: string | null
      readonly errors: readonly GrantsGovBridgeError[]
    }
