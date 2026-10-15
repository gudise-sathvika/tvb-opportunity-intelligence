/**
 * Shared contract between the browser and the Phase 06 GLEIF bridge
 * (same-origin live company search).
 *
 * This module is the ONLY slice of the bridge the browser app may import: it
 * is dependency-free (types plus one endpoint constant) and contains no
 * filesystem, network, or node code. The Node side lives in `handler.ts`
 * (one real read-only GLEIF LEI search) and `plugin.ts` (HTTP middleware on
 * the Vite dev and preview servers); the browser reaches it with a plain
 * `fetch` to this same-origin endpoint (api.gleif.org sends no CORS headers,
 * so a direct browser call is impossible by design).
 *
 * Safety invariants encoded here:
 *  - the request body carries only discovery parameters; the endpoint and the
 *    source are fixed server-side (`api.gleif.org/api/v1/lei-records`), so a
 *    browser can never redirect the server toward another host;
 *  - the bridge performs ONE read-only GET and returns the raw status + body
 *    unchanged; interpreting the response (ACTIVE/ISSUED admission, identity,
 *    canonicalization) is the GLEIF adapter's job;
 *  - a handler-side failure is reported with explicit `errors` and is never
 *    converted into an empty successful search.
 */

export const GLEIF_BRIDGE_SEARCH_PATH = '/__tvb/gleif/search'

export interface GleifBridgeSearchRequest {
  runId: string
  companyId: string
  /** Legal-name search text (GLEIF `filter[entity.legalName]`). */
  query: string
  /** Page size (1–100); the adapter clamps out-of-range values. */
  limit: number
  requestedAt: string
}

export interface GleifBridgeError {
  readonly code: string
  readonly message: string
}

export type GleifBridgeSearchResponse =
  | { readonly ok: true; readonly status: number; readonly body: string }
  | {
      readonly ok: false
      readonly status: number
      readonly body: string | null
      readonly errors: readonly GleifBridgeError[]
    }
