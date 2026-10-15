/**
 * Phase 08 SEC bridge — Node-side request handler.
 *
 * This module sits on the Vite dev and preview servers (`plugin.ts`) and is
 * the ONE place SEC EDGAR enrichment retrieval executes: the browser only
 * talks to this same-origin endpoint. Per request it performs at most two
 * bounded read-only GETs against the official public EDGAR files —
 * `www.sec.gov/files/company_tickers.json`, then (only the matched filer)
 * `data.sec.gov/submissions/{CIK}.json` — with an identifying User-Agent and
 * a hard timeout, respecting the SEC fair-access rules (no bulk, no
 * concurrency, no key, no bypass). It never writes anything and never guesses:
 * ticker matching and submissions mapping happen downstream in the pure
 * `company-enrichment` module from the raw bodies returned here verbatim.
 *
 * Honesty: any handler-side failure returns explicit `errors` and is NEVER
 * converted into an empty successful enrichment.
 */

import type { SecBridgeEnrichBodies, SecBridgeError, SecBridgeEnrichRequest, SecBridgeEnrichResponse } from './contract'

export const SEC_BRIDGE_DEFAULT_TIMEOUT_MS = 25_000
const SEC_USER_AGENT = 'TVB-Opportunity-Intelligence/1.0 (research use; bounded public-filings lookup)'
const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'
const SEC_SUBMISSIONS_URL = (cik: string): string => `https://data.sec.gov/submissions/${cik}.json`

export interface SecBridgeResult {
  readonly httpStatus: number
  readonly body: SecBridgeEnrichResponse
}

function okBody(bodies: SecBridgeEnrichBodies): SecBridgeEnrichResponse {
  return { ok: true, status: 200, body: bodies }
}

function failureBody(status: number, errors: readonly SecBridgeError[]): SecBridgeEnrichResponse {
  return { ok: false, status, body: null, errors }
}

function reject(status: number, errors: readonly SecBridgeError[]): SecBridgeResult {
  return { httpStatus: status, body: failureBody(status, errors) }
}

export interface SecBridgeHandleOptions {
  /** Injectable fetch for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

async function getText(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  const answer = await fetchImpl(url, {
    headers: { 'User-Agent': SEC_USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  return { status: answer.status, body: await answer.text() }
}

/**
 * Handles one same-origin SEC enrichment request. Returns the raw ticker-file
 * body and, when the caller resolves a filer downstream, nothing else — CIK
 * resolution stays in the pure enrichment module, so this handler fetches the
 * submissions document only when the request already names a CIK.
 */
export async function handleSecEnrichBridge(
  value: (SecBridgeEnrichRequest & { cik?: string }) | null,
  options: SecBridgeHandleOptions = {},
): Promise<SecBridgeResult> {
  if (value === null || typeof value !== 'object') {
    return reject(400, [{ code: 'malformed_request', message: 'request body must be an object' }])
  }
  const fields = value as unknown as Record<string, unknown>
  const runId = typeof fields.runId === 'string' ? fields.runId.trim() : ''
  const companyId = typeof fields.companyId === 'string' ? fields.companyId.trim() : ''
  const requestedAt = typeof fields.requestedAt === 'string' ? fields.requestedAt.trim() : ''
  if (runId === '' || companyId === '' || requestedAt === '') {
    return reject(400, [{ code: 'invalid_request', message: 'runId, companyId, and requestedAt are required non-empty strings' }])
  }
  const legalName = typeof fields.legalName === 'string' ? fields.legalName.trim() : ''
  const cik = typeof fields.cik === 'string' && /^CIK\d{10}$/.test(fields.cik.trim()) ? fields.cik.trim() : null
  if (legalName === '' && cik === null) {
    return reject(400, [{ code: 'invalid_request', message: 'a legal name (or a resolved CIK) is required for SEC enrichment' }])
  }

  const timeoutMs = options.timeoutMs ?? SEC_BRIDGE_DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  try {
    if (cik !== null) {
      const submissions = await getText(fetchImpl, SEC_SUBMISSIONS_URL(cik), timeoutMs)
      if (submissions.status < 200 || submissions.status >= 300) {
        return reject(submissions.status, [{ code: 'source_failure', message: `SEC submissions lookup returned HTTP ${submissions.status}` }])
      }
      // Ticker file echoed for evidence completeness is unnecessary here; the
      // caller already resolved the CIK from it in a previous call.
      return { httpStatus: 200, body: okBody({ tickers: '', submissions: submissions.body, resolvedCik: cik }) }
    }
    const tickers = await getText(fetchImpl, SEC_TICKERS_URL, timeoutMs)
    if (tickers.status < 200 || tickers.status >= 300) {
      return reject(tickers.status, [{ code: 'source_failure', message: `SEC ticker file returned HTTP ${tickers.status}` }])
    }
    return { httpStatus: 200, body: okBody({ tickers: tickers.body, submissions: null, resolvedCik: null }) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return reject(502, [{ code: 'source_failure', message: `SEC enrichment lookup failed: ${message}` }])
  }
}
