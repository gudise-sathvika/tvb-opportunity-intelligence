/**
 * Shared contract between the browser and the Phase 08 SEC bridge
 * (same-origin company enrichment).
 *
 * This module is the ONLY slice of the bridge the browser app may import: it
 * is dependency-free (types plus endpoint constants) and contains no
 * filesystem, network, or node code. The Node side lives in `handler.ts` (at
 * most two bounded read-only GETs against the official public SEC EDGAR
 * files) and `plugin.ts` (HTTP middleware on the Vite dev and preview
 * servers); the browser reaches it with a plain `fetch` to this same-origin
 * endpoint.
 *
 * Safety invariants encoded here:
 *  - the request body carries only a legal name; hosts and paths are fixed
 *    server-side, so a browser can never redirect the server toward another
 *    host;
 *  - ticker-file matching and submissions mapping happen downstream in the
 *    pure `company-enrichment` module — the bridge returns raw bodies only;
 *  - a handler-side failure is reported with explicit `errors` and is never
 *    converted into an empty successful enrichment.
 */

export const SEC_BRIDGE_ENRICH_PATH = '/__tvb/sec/enrich'

export interface SecBridgeEnrichRequest {
  runId: string
  companyId: string
  /** Company legal name to resolve against the EDGAR ticker file. */
  legalName: string
  requestedAt: string
}

export interface SecBridgeError {
  readonly code: string
  readonly message: string
}

/** Raw ticker-file body plus, when a filer resolved, the raw submissions body. */
export interface SecBridgeEnrichBodies {
  readonly tickers: string
  readonly submissions: string | null
  readonly resolvedCik: string | null
}

export type SecBridgeEnrichResponse =
  | { readonly ok: true; readonly status: number; readonly body: SecBridgeEnrichBodies }
  | {
      readonly ok: false
      readonly status: number
      readonly body: null
      readonly errors: readonly SecBridgeError[]
    }
