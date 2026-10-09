/**
 * Shared contract between the browser control panel and the Phase 4 TED
 * bridge (same-origin live search).
 *
 * This module is the ONLY slice of the bridge the browser app may import: it
 * is dependency-free (types plus one endpoint constant) and contains no
 * filesystem, network, or node code. The Node side lives in `handler.ts`
 * (one real read-only TED search) and `plugin.ts` (HTTP middleware on the
 * Vite dev and preview servers); the browser reaches it with a plain `fetch`
 * to this same-origin endpoint.
 *
 * Safety invariants encoded here:
 *  - the request body carries only discovery parameters; the endpoint and the
 *    source are fixed server-side (`TED_SEARCH_ENDPOINT`), so a browser can
 *    never redirect the server toward another host;
 *  - the bridge performs ONE read-only POST and returns the raw status + body
 *    unchanged; interpreting the response is the adapter's job, so the
 *    browser must never re-run the live request;
 *  - a handler-side failure is reported with explicit `errors` and is never
 *    converted into an empty successful search.
 */

export const TED_BRIDGE_SEARCH_PATH = '/__tvb/ted/search'

export interface TedBridgeSearchRequest {
  runId: string
  companyId: string
  keyword: string
  /** YYYYMMDD lower bound on the source's publication-date field. */
  publishedSince: string
  /** Source result limit (1–100); the source clamps out-of-range values. */
  limit: number
  requestedAt: string
}

export interface TedBridgeError {
  readonly code: string
  readonly message: string
}

export type TedBridgeSearchResponse =
  | { readonly ok: true; readonly status: number; readonly body: string }
  | {
      readonly ok: false
      readonly status: number
      readonly body: string | null
      readonly errors: readonly TedBridgeError[]
    }