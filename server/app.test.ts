import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { handleTedBridge } from '../src/live-source/ted-bridge/handler'
import { TED_BRIDGE_SEARCH_PATH } from '../src/live-source/ted-bridge/contract'
import type { TedBridgeSearchRequest } from '../src/live-source/ted-bridge/contract'
import { handleUsaSpendingBridge } from '../src/live-source/usaspending-bridge/handler'
import { USA_BRIDGE_SEARCH_PATH } from '../src/live-source/usaspending-bridge/contract'
import type { UsaSpendingBridgeSearchRequest } from '../src/live-source/usaspending-bridge/contract'
import { createRequestListener } from './app'
import type { AppOptions } from './app'
import { HostLifecycle } from './lifecycle'

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url))
const INDEX_MARKER = '<div id="root">TVB-SPA</div>'

function makeDist(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvb-host-dist-'))
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><body>${INDEX_MARKER}</body></html>`)
  fs.mkdirSync(path.join(dir, 'assets'))
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log("app")')
  fs.writeFileSync(path.join(dir, 'robots.txt'), 'User-agent: *')
  return dir
}

const DIST = makeDist()

const VALID_BODY = JSON.stringify({
  runId: 'run-1',
  companyId: 'C-1',
  keyword: 'solar',
  publishedSince: '20240101',
  limit: 5,
  requestedAt: '2026-10-09T00:00:00Z',
})

const JSON_HEADERS = { 'content-type': 'application/json' }

function realBridges(): AppOptions['bridges'] {
  return {
    [TED_BRIDGE_SEARCH_PATH]: (value) =>
      handleTedBridge(value as TedBridgeSearchRequest | null, {
        transport: async () => ({ status: 200, body: 'TED-RAW' }),
      }),
    [USA_BRIDGE_SEARCH_PATH]: (value) =>
      handleUsaSpendingBridge(value as UsaSpendingBridgeSearchRequest | null, {
        transport: async () => ({ status: 200, body: 'USA-RAW' }),
      }),
  }
}

interface Running {
  readonly origin: string
  close(): Promise<void>
}

async function withServer(options: AppOptions, run: (server: Running) => Promise<void>): Promise<void> {
  const httpServer: Server = createServer(createRequestListener(options))
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', () => resolve())
  })
  const address = httpServer.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const origin = `http://127.0.0.1:${port}`
  try {
    await run({ origin, close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())) })
  } finally {
    httpServer.closeAllConnections()
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  }
}

function baseOptions(overrides: Partial<AppOptions> = {}): AppOptions {
  return { distDir: DIST, bridges: realBridges(), ...overrides }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test('serves the built index.html at the root and static assets with correct types', async () => {
  await withServer(baseOptions(), async ({ origin }) => {
    const root = await fetch(`${origin}/`)
    assert.equal(root.status, 200)
    assert.match(root.headers.get('content-type') ?? '', /text\/html/)
    assert.match(await root.text(), new RegExp(INDEX_MARKER))

    const asset = await fetch(`${origin}/assets/app.js`)
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get('content-type') ?? '', /text\/javascript/)
    assert.equal(await asset.text(), 'console.log("app")')
  })
})

test('falls back to index.html for unknown SPA routes but 404s missing assets', async () => {
  await withServer(baseOptions(), async ({ origin }) => {
    const spa = await fetch(`${origin}/company/189`)
    assert.equal(spa.status, 200)
    assert.match(await spa.text(), new RegExp(INDEX_MARKER))

    const missing = await fetch(`${origin}/assets/does-not-exist.js`)
    assert.equal(missing.status, 404)
  })
})

test('never escapes the dist directory when serving static files', async () => {
  await withServer(baseOptions(), async ({ origin }) => {
    const traversal = await fetch(`${origin}/..%2f..%2fpackage.json`)
    assert.equal(traversal.status, 404)
  })
})

test('routes valid TED and USAspending requests through the real handlers (mocked transport)', async () => {
  await withServer(baseOptions(), async ({ origin }) => {
    const ted = await fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin },
      body: VALID_BODY,
    })
    assert.equal(ted.status, 200)
    assert.deepEqual(await ted.json(), { ok: true, status: 200, body: 'TED-RAW' })

    const usa = await fetch(`${origin}${USA_BRIDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin },
      body: VALID_BODY,
    })
    assert.equal(usa.status, 200)
    assert.deepEqual(await usa.json(), { ok: true, status: 200, body: 'USA-RAW' })
  })
})

test('propagates the handler validation envelope for an invalid bridge request', async () => {
  await withServer(baseOptions(), async ({ origin }) => {
    const response = await fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin },
      body: JSON.stringify({ keyword: 'solar' }),
    })
    assert.equal(response.status, 400)
    const body = (await response.json()) as { ok: boolean; errors: { code: string }[] }
    assert.equal(body.ok, false)
    assert.equal(body.errors[0]?.code, 'invalid_request')
  })
})

test('rejects unsupported methods and unknown bridge endpoints without forwarding', async () => {
  let handlerCalls = 0
  const bridges: AppOptions['bridges'] = {
    [TED_BRIDGE_SEARCH_PATH]: () => {
      handlerCalls += 1
      return { httpStatus: 200, body: { ok: true } }
    },
  }
  await withServer(baseOptions({ bridges }), async ({ origin }) => {
    const method = await fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, { headers: { origin } })
    assert.equal(method.status, 405)
    assert.equal((await method.json() as { error: { code: string } }).error.code, 'method_not_allowed')

    const unknown = await fetch(`${origin}/__tvb/vault/write`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin },
      body: '{}',
    })
    assert.equal(unknown.status, 404)
    assert.equal((await unknown.json() as { error: { code: string } }).error.code, 'not_found')

    const unknownTed = await fetch(`${origin}/__tvb/ted/other`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin },
      body: '{}',
    })
    assert.equal(unknownTed.status, 404)
    assert.equal(handlerCalls, 0, 'no handler may run for unknown or wrong-method requests')
  })
})

test('rejects disallowed browser origins and allows same-origin or allowlisted ones', async () => {
  await withServer(baseOptions({ allowedOrigins: ['https://trusted.example'] }), async ({ origin }) => {
    const denied = await fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin: 'https://evil.example' },
      body: VALID_BODY,
    })
    assert.equal(denied.status, 403)
    assert.equal((await denied.json() as { error: { code: string } }).error.code, 'origin_not_allowed')

    const sameOrigin = await fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin },
      body: VALID_BODY,
    })
    assert.equal(sameOrigin.status, 200)

    const allowlisted = await fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin: 'https://trusted.example' },
      body: VALID_BODY,
    })
    assert.equal(allowlisted.status, 200)
    assert.equal(allowlisted.headers.get('access-control-allow-origin'), 'https://trusted.example')

    const preflight = await fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
      method: 'OPTIONS',
      headers: { origin: 'https://trusted.example' },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS')
  })
})

test('enforces a bounded per-client rate limit on the bridges only', async () => {
  await withServer(baseOptions({ rateLimit: { windowMs: 60_000, max: 2, maxKeys: 10 } }), async ({ origin }) => {
    const send = () =>
      fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, origin },
        body: VALID_BODY,
      })
    assert.equal((await send()).status, 200)
    assert.equal((await send()).status, 200)
    const limited = await send()
    assert.equal(limited.status, 429)
    assert.equal((await limited.json() as { error: { code: string } }).error.code, 'rate_limited')
    assert.ok(limited.headers.get('retry-after'))

    const staticResponse = await fetch(`${origin}/`)
    assert.equal(staticResponse.status, 200, 'static assets must not be rate limited')
  })
})

test('rejects malformed and oversized bridge bodies with the shared envelope', async () => {
  await withServer(baseOptions({ maxBodyBytes: 128 }), async ({ origin }) => {
    const malformed = await fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin },
      body: '{not json',
    })
    assert.equal(malformed.status, 400)
    assert.equal((await malformed.json() as { error: { code: string } }).error.code, 'malformed_json')

    const oversized = await fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin },
      body: 'x'.repeat(256),
    })
    assert.equal(oversized.status, 413)
    assert.equal((await oversized.json() as { error: { code: string } }).error.code, 'payload_too_large')
  })
})

test('returns 504 when a bridge handler exceeds the configured timeout', async () => {
  const bridges: AppOptions['bridges'] = {
    [TED_BRIDGE_SEARCH_PATH]: () => new Promise<{ httpStatus: number; body: unknown }>(() => {}),
  }
  await withServer(baseOptions({ bridges, timeoutMs: 30 }), async ({ origin }) => {
    const response = await fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin },
      body: VALID_BODY,
    })
    assert.equal(response.status, 504)
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'bridge_timeout')
  })
})

test('enforces configured concurrency and rejects excess work with a structured 503', async () => {
  let releaseFirst: (() => void) | undefined
  let started = 0
  const bridges: AppOptions['bridges'] = {
    [TED_BRIDGE_SEARCH_PATH]: () => {
      started += 1
      if (started === 1) {
        return new Promise<{ httpStatus: number; body: unknown }>((resolve) => {
          releaseFirst = () => resolve({ httpStatus: 200, body: { ok: true } })
        })
      }
      return { httpStatus: 200, body: { ok: true } }
    },
  }
  await withServer(baseOptions({ bridges, maxConcurrent: 1 }), async ({ origin }) => {
    const first = fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin },
      body: VALID_BODY,
    })
    await waitFor(() => started === 1)

    const second = await fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin },
      body: VALID_BODY,
    })
    assert.equal(second.status, 503)
    assert.equal((await second.json() as { error: { code: string } }).error.code, 'server_busy')

    releaseFirst?.()
    assert.equal((await first).status, 200)

    const third = await fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin },
      body: VALID_BODY,
    })
    assert.equal(third.status, 200, 'a freed slot must admit the next request')
    assert.equal(started, 2)
  })
})

test('releases the concurrency slot after a timeout and after a handler failure', async () => {
  let calls = 0
  const bridges: AppOptions['bridges'] = {
    [TED_BRIDGE_SEARCH_PATH]: () => {
      calls += 1
      if (calls === 1) return new Promise<{ httpStatus: number; body: unknown }>(() => {})
      if (calls === 2) throw new Error('boom')
      return { httpStatus: 200, body: { ok: true } }
    },
  }
  await withServer(baseOptions({ bridges, maxConcurrent: 1, timeoutMs: 250 }), async ({ origin }) => {
    const send = () =>
      fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, origin },
        body: VALID_BODY,
      })

    assert.equal((await send()).status, 504)
    assert.equal((await send()).status, 500)
    assert.equal((await send()).status, 200)
  })
})

test('liveness and readiness endpoints are upstream-free and leak no configuration', async () => {
  let calls = 0
  const bridges: AppOptions['bridges'] = {
    [TED_BRIDGE_SEARCH_PATH]: () => {
      calls += 1
      return { httpStatus: 200, body: { ok: true } }
    },
    [USA_BRIDGE_SEARCH_PATH]: () => {
      calls += 1
      return { httpStatus: 200, body: { ok: true } }
    },
  }
  await withServer(baseOptions({ bridges, distDir: DIST }), async ({ origin }) => {
    const live = await fetch(`${origin}/health/live`)
    assert.equal(live.status, 200)
    const liveBody = (await live.json()) as Record<string, unknown>
    assert.deepEqual(Object.keys(liveBody), ['status'])
    assert.equal(liveBody['status'], 'live')

    const ready = await fetch(`${origin}/health/ready`)
    assert.equal(ready.status, 200)
    assert.deepEqual(await ready.json(), { status: 'ready' })

    assert.equal(calls, 0, 'health endpoints must not call any bridge/upstream')

    const unknown = await fetch(`${origin}/health/other`)
    assert.equal(unknown.status, 404)
    assert.match(unknown.headers.get('content-type') ?? '', /application\/json/)

    const wrongMethod = await fetch(`${origin}/health/live`, { method: 'POST' })
    assert.equal(wrongMethod.status, 405)
  })
})

test('readiness reports not_ready once shutdown has begun', async () => {
  const lifecycle = new HostLifecycle()
  await withServer(baseOptions({ lifecycle }), async ({ origin }) => {
    const before = await fetch(`${origin}/health/ready`)
    assert.equal(before.status, 200)
    assert.deepEqual(await before.json(), { status: 'ready' })

    lifecycle.markNotReady()
    const after = await fetch(`${origin}/health/ready`)
    assert.equal(after.status, 503)
    assert.deepEqual(await after.json(), { status: 'not_ready' })
  })
})

test('the Vault-write bridge is neither registered nor importable from the host source', async () => {
  await withServer(baseOptions(), async ({ origin }) => {
    for (const endpoint of ['/__tvb/vault/write', '/__tvb/vault/preview']) {
      const response = await fetch(`${origin}${endpoint}`, {
        method: 'POST',
        headers: { ...JSON_HEADERS, origin },
        body: '{}',
      })
      assert.equal(response.status, 404, `${endpoint} must not be mounted`)
    }
  })

  for (const file of ['app.ts', 'serve.ts', 'config.ts', 'rate-limit.ts']) {
    const source = fs.readFileSync(path.join(SERVER_DIR, file), 'utf8')
    const specifiers = [
      ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g),
    ].map((match) => match[1] ?? '')
    assert.ok(
      specifiers.every((specifier) => !/vault-(bridge|writer)/.test(specifier)),
      `${file} must not import the vault bridge or writer (found: ${specifiers.join(', ')})`,
    )
    assert.ok(!source.includes('handleVaultBridge'), `${file} must not reference the vault handler`)
  }
})
