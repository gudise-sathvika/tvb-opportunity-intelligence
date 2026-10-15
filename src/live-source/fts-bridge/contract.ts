/**
 * Shared contract between the browser control panel and the Phase 03A FTS
 * bridge (same-origin live search).
 *
 * This module is the ONLY slice of the bridge the browser app may import: it
 * is dependency-free (types plus one endpoint constant) and contains no
 * filesystem, network, or node code. The Node side lives in `handler.ts`
 * (one real read-only Find a Tender search) and `plugin.ts` (HTTP middleware
 * on the Vite dev and preview servers); the browser reaches it with a plain
 * `fetch` to this same-origin endpoint (the source sends no CORS headers, so a
 * direct browser call is impossible by design).
 *
 * Safety invariants encoded here:
 *  - the request body carries only discovery parameters; the endpoint and the
 *    source are fixed server-side (`FTS_SEARCH_ENDPOINT`), so a browser can
 *    never redirect the server toward another host;
 *  - the bridge performs ONE read-only GET and returns the raw status + body
 *    unchanged; interpreting the response is the adapter's job, so the
 *    browser must never re-run the live request;
 *  - a handler-side failure is reported with explicit `errors` and is never
 *    converted into an empty successful search.
 */

export const FTS_BRIDGE_SEARCH_PATH = '/__tvb/fts/search'

export interface FtsBridgeSearchRequest {
  runId: string
  companyId: string
  /** Source result limit (1–100); the adapter clamps out-of-range values. */
  limit: number
  requestedAt: string
}

export interface FtsBridgeError {
  readonly code: string
  readonly message: string
}

export type FtsBridgeSearchResponse =
  | { readonly ok: true; readonly status: number; readonly body: string }
  | {
      readonly ok: false
      readonly status: number
      readonly body: string | null
      readonly errors: readonly FtsBridgeError[]
    }
