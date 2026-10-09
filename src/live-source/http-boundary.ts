/**
 * Shared, host-independent HTTP boundary for the `/__tvb/*` bridges.
 *
 * This module centralizes the responsibilities every bridge duplicated:
 * route + method validation, JSON Content-Type validation, a bounded
 * request-body read, malformed-JSON handling, a request-scoped response
 * timeout, and one consistent structured error envelope.
 *
 * It has NO Vite, `node:http`, filesystem, or Vault dependency: a request is
 * described structurally, so the same function serves the Vite dev/preview
 * middleware today and a Node `http` server later. It never performs a network
 * call itself and never converts a handler failure into a success.
 */

/** Conservative cap on a bridge request body. Requests carry only parameters. */
export const BRIDGE_MAX_BODY_BYTES = 64 * 1024

/** Default response timeout. Longer than the 20 s outbound transport timeout. */
export const BRIDGE_REQUEST_TIMEOUT_MS = 30_000

export const BRIDGE_JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

/** The minimal shape of an incoming request the boundary needs. */
export interface BridgeRequest extends AsyncIterable<string | Uint8Array> {
  readonly method?: string
  readonly url?: string
  readonly headers: Record<string, string | string[] | undefined>
}

/** A route handler: receives the parsed JSON value, returns status + body. */
export type JsonBridgeHandler = (
  value: unknown,
) => { readonly httpStatus: number; readonly body: unknown } | Promise<{ readonly httpStatus: number; readonly body: unknown }>

export interface DispatchConfig {
  /** Path (no query string) → handler. Unmatched paths return `null`. */
  readonly routes: Readonly<Record<string, JsonBridgeHandler>>
  readonly maxBodyBytes?: number
  readonly timeoutMs?: number
}

export interface DispatchResult {
  readonly httpStatus: number
  readonly body: unknown
}

class BodyTooLargeError extends Error {}
class TimeoutError extends Error {}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) {
      const value = headers[key]
      return Array.isArray(value) ? value[0] : value
    }
  }
  return undefined
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false
  return value.split(';')[0]!.trim().toLowerCase() === 'application/json'
}

function errorResult(httpStatus: number, code: string, message: string): DispatchResult {
  return { httpStatus, body: { ok: false, error: { code, message } } }
}

/** Reads the body up to `maxBytes`, rejecting (413) instead of accumulating unbounded. */
async function readBounded(request: BridgeRequest, maxBytes: number): Promise<string> {
  const declared = Number(headerValue(request.headers, 'content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError()

  const decoder = new TextDecoder('utf-8')
  let total = 0
  let text = ''
  for await (const chunk of request as AsyncIterable<string | Uint8Array>) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk
    total += bytes.byteLength
    if (total > maxBytes) throw new BodyTooLargeError()
    text += typeof chunk === 'string' ? chunk : decoder.decode(bytes, { stream: true })
  }
  text += decoder.decode()
  return text
}

/** Resolves with the handler result, or rejects with `TimeoutError` after `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Validates and dispatches one bridge request.
 *
 * Returns `null` when no route matches the path (the caller should call
 * `next()`); otherwise a structured result the caller writes verbatim.
 */
export async function dispatchBridgeRequest(
  request: BridgeRequest,
  config: DispatchConfig,
): Promise<DispatchResult | null> {
  const path = (request.url ?? '').split('?')[0] ?? ''
  const handler = config.routes[path]
  if (handler === undefined) return null

  if (request.method !== 'POST') {
    return errorResult(405, 'method_not_allowed', 'expected POST')
  }

  if (!isJsonContentType(headerValue(request.headers, 'content-type'))) {
    return errorResult(415, 'unsupported_media_type', 'Content-Type must be application/json')
  }

  const maxBodyBytes = config.maxBodyBytes ?? BRIDGE_MAX_BODY_BYTES
  let raw: string
  try {
    raw = await readBounded(request, maxBodyBytes)
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResult(413, 'payload_too_large', `request body must be at most ${maxBodyBytes} bytes`)
    }
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.trim() === '' ? '{}' : raw)
  } catch {
    return errorResult(400, 'malformed_json', 'request body is not valid JSON')
  }

  const timeoutMs = config.timeoutMs ?? BRIDGE_REQUEST_TIMEOUT_MS
  try {
    const result = await withTimeout(Promise.resolve(handler(parsed)), timeoutMs)
    return { httpStatus: result.httpStatus, body: result.body }
  } catch (error) {
    if (error instanceof TimeoutError) {
      return errorResult(504, 'bridge_timeout', 'the bridge handler did not respond in time')
    }
    return errorResult(500, 'bridge_failure', error instanceof Error ? error.message : String(error))
  }
}

/**
 * Clamps a search `limit` to the contract range 1–100. A non-finite or
 * non-numeric value falls back to `fallback`; valid integers pass through.
 */
export function clampSearchLimit(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(100, Math.max(1, numeric))
}
