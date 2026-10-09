/**
 * Phase 14 — minimal Node.js production host (request listener).
 *
 * Serves the built Vite SPA from `dist/` (with a safe SPA fallback) and mounts
 * ONLY the two read-only live bridges:
 *
 *   POST /__tvb/ted/search
 *   POST /__tvb/usaspending/search
 *
 * It does NOT mount the Vault-write bridge and does not import any Vault-writer
 * module, so the host has no filesystem-write capability. Unknown `/__tvb/*`
 * paths return 404 and are NEVER forwarded upstream.
 *
 * All inbound controls (method / Content-Type / bounded body / JSON validation
 * / response timeout / structured error envelope) are delegated to the shared
 * `dispatchBridgeRequest` boundary, so the host and the Vite dev server share
 * exactly one code path. On top of that the host adds a browser-origin policy
 * (rejecting disallowed origins; NOT authentication) and a bounded per-client
 * rate limit. Request bodies, headers, and credentials are never logged.
 */

import { createReadStream, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

import { BRIDGE_JSON_CONTENT_TYPE, dispatchBridgeRequest } from '../src/live-source/http-boundary'
import type { JsonBridgeHandler } from '../src/live-source/http-boundary'
import { ConcurrencyGate } from './concurrency'
import { FixedWindowRateLimiter } from './rate-limit'
import { HostLifecycle } from './lifecycle'

const BRIDGE_PREFIX = '/__tvb/'

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
}

export interface AppOptions {
  readonly distDir: string
  /** Path (no query) → handler. Only these paths are mounted. */
  readonly bridges: Readonly<Record<string, JsonBridgeHandler>>
  readonly allowedOrigins?: readonly string[]
  readonly rateLimit?: { readonly windowMs: number; readonly max: number; readonly maxKeys: number }
  readonly maxBodyBytes?: number
  readonly timeoutMs?: number
  /** Bounded, queue-free maximum of concurrent bridge requests. Defaults to 4. */
  readonly maxConcurrent?: number
  /** Shared readiness state; defaults to a fresh, always-ready lifecycle. */
  readonly lifecycle?: HostLifecycle
  /** Shared concurrency gate; defaults to one sized by `maxConcurrent`. */
  readonly gate?: ConcurrencyGate
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function json(res: ServerResponse, httpStatus: number, body: unknown): void {
  res.statusCode = httpStatus
  res.setHeader('Content-Type', BRIDGE_JSON_CONTENT_TYPE)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}

type OriginDecision = 'none' | 'same-origin' | 'allowlisted' | 'denied'

function originDecision(req: IncomingMessage, allowed: ReadonlySet<string>): OriginDecision {
  const origin = headerValue(req, 'origin')
  if (origin === undefined || origin.trim() === '') return 'none'
  const lower = origin.toLowerCase()
  const host = headerValue(req, 'host')?.toLowerCase()
  if (host !== undefined && (lower === `http://${host}` || lower === `https://${host}`)) return 'same-origin'
  return allowed.has(lower) ? 'allowlisted' : 'denied'
}

function safeResolve(distDir: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const resolved = path.resolve(distDir, '.' + path.posix.normalize(decoded))
  const root = path.resolve(distDir)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function serveFile(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  const extension = path.extname(filePath).toLowerCase()
  res.statusCode = 200
  res.setHeader('Content-Type', CONTENT_TYPES[extension] ?? 'application/octet-stream')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

export function createRequestListener(options: AppOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const limiter = new FixedWindowRateLimiter(
    options.rateLimit ?? { windowMs: 60_000, max: 30, maxKeys: 5_000 },
  )
  const gate = options.gate ?? new ConcurrencyGate(options.maxConcurrent ?? 4)
  const lifecycle = options.lifecycle ?? new HostLifecycle()
  const allowed = new Set((options.allowedOrigins ?? []).map((origin) => origin.toLowerCase()))
  const routes = options.bridges
  const indexHtml = path.join(options.distDir, 'index.html')

  /**
   * Minimal operations endpoints. They never touch the bridges, the network,
   * the filesystem, or configuration: the body carries only `{ status }`.
   */
  function handleHealth(req: IncomingMessage, res: ServerResponse, urlPath: string): boolean {
    const isLive = urlPath === '/health/live'
    const isReady = urlPath === '/health/ready'
    if (!isLive && !isReady && !urlPath.startsWith('/health/')) return false
    if (!isLive && !isReady) {
      json(res, 404, { ok: false, error: { code: 'not_found', message: 'unknown health endpoint' } })
      return true
    }
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.setHeader('Allow', 'GET')
      res.end()
      return true
    }
    if (isLive) {
      json(res, 200, { status: 'live' })
      return true
    }
    const ready = lifecycle.isReady()
    json(res, ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready' })
    return true
  }

  async function handleBridge(req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<void> {
    res.setHeader('X-Content-Type-Options', 'nosniff')

    if (!Object.prototype.hasOwnProperty.call(routes, urlPath)) {
      json(res, 404, { ok: false, error: { code: 'not_found', message: 'unknown bridge endpoint' } })
      return
    }

    const decision = originDecision(req, allowed)
    if (decision === 'denied') {
      json(res, 403, { ok: false, error: { code: 'origin_not_allowed', message: 'request origin is not allowed' } })
      return
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      if (decision === 'allowlisted') {
        const origin = headerValue(req, 'origin')
        if (origin !== undefined) {
          res.setHeader('Access-Control-Allow-Origin', origin)
          res.setHeader('Vary', 'Origin')
        }
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      }
      res.end()
      return
    }

    const key = req.socket.remoteAddress ?? 'unknown'
    const limit = limiter.check(key)
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000)))
      json(res, 429, { ok: false, error: { code: 'rate_limited', message: 'too many requests' } })
      return
    }

    if (decision === 'allowlisted') {
      const origin = headerValue(req, 'origin')
      if (origin !== undefined) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Vary', 'Origin')
      }
    }

    if (!gate.tryAcquire()) {
      res.setHeader('Retry-After', '1')
      json(res, 503, { ok: false, error: { code: 'server_busy', message: 'too many concurrent bridge requests' } })
      return
    }

    try {
      const result = await dispatchBridgeRequest(req, {
        routes,
        maxBodyBytes: options.maxBodyBytes,
        timeoutMs: options.timeoutMs,
      })
      if (result === null) {
        json(res, 404, { ok: false, error: { code: 'not_found', message: 'unknown bridge endpoint' } })
        return
      }
      json(res, result.httpStatus, result.body)
    } finally {
      gate.release()
    }
  }

  function handleStatic(req: IncomingMessage, res: ServerResponse, urlPath: string): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.setHeader('Allow', 'GET, HEAD')
      res.end()
      return
    }

    const target = safeResolve(options.distDir, urlPath)
    if (target !== null && isFile(target)) {
      serveFile(req, res, target)
      return
    }

    const hasExtension = path.extname(urlPath) !== ''
    if (!hasExtension && isFile(indexHtml)) {
      serveFile(req, res, indexHtml)
      return
    }

    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Not found')
  }

  return (req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0] ?? '/'
    void (async () => {
      if (handleHealth(req, res, urlPath)) return
      if (urlPath === BRIDGE_PREFIX.slice(0, -1) || urlPath.startsWith(BRIDGE_PREFIX)) {
        await handleBridge(req, res, urlPath)
        return
      }
      handleStatic(req, res, urlPath)
    })().catch(() => {
      if (!res.headersSent) json(res, 500, { ok: false, error: { code: 'server_error', message: 'internal error' } })
      else res.end()
    })
  }
}
