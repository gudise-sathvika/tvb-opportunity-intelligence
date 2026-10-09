/**
 * Shared contract between the browser control panel and the Phase V
 * USAspending bridge (same-origin live funding search).
 *
 * Dependency-free contract module (types + endpoint constant) mirroring the
 * Phase 4 TED bridge contract. The Node side lives in `handler.ts` (one real
 * read-only USAspending search) and `plugin.ts` (HTTP middleware on the Vite
 * dev and preview servers); the browser reaches it with a plain `fetch` to
 * this same-origin endpoint.
 *
 * Safety invariants: the request body carries only discovery parameters and
 * the source/endpoint are fixed server-side; the bridge performs ONE read-only
 * POST and returns the raw status + body unchanged; a handler-side failure is
 * reported with explicit `errors`, never converted into an empty success.
 */

export const USA_BRIDGE_SEARCH_PATH = '/__tvb/usaspending/search'

export interface UsaSpendingBridgeSearchRequest {
  runId: string
  companyId: string
  keyword: string
  /** YYYYMMDD lower bound forwarded to the source time_period.start_date; the end_date is derived server-side from requestedAt (the source requires both). */
  publishedSince: string
  /** Source result limit (1–100) forwarded as page size. */
  limit: number
  requestedAt: string
}

export interface UsaSpendingBridgeError {
  readonly code: string
  readonly message: string
}

export type UsaSpendingBridgeSearchResponse =
  | { readonly ok: true; readonly status: number; readonly body: string }
  | {
      readonly ok: false
      readonly status: number
      readonly body: string | null
      readonly errors: readonly UsaSpendingBridgeError[]
    }