/**
 * Phase Render-readiness: production host route registration tests.
 *
 * Spins the REAL production server factory (`createProductionServer`) on an
 * ephemeral loopback port and proves every read-only bridge family is mounted:
 * invalid (but well-formed) bodies reach their handlers and come back with the
 * handlers' own 400 validation envelopes — so no assertion depends on any live
 * source, and no network call is ever made. Also proves the Vault
 * preview/write routes are NOT mounted here and unknown paths 404.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { createProductionServer } from './serve'
import type { HostConfig } from './config'

const BRIDGE_PATHS = [
  '/__tvb/ted/search',
  '/__tvb/usaspending/search',
  '/__tvb/grantsgov/search',
  '/__tvb/eu/search',
  '/__tvb/fts/search',
  '/__tvb/gleif/search',
  '/__tvb/sec/enrich',
] as const

function makeConfig(distDir: string): HostConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    distDir,
    allowedOrigins: [],
    rateLimit: { windowMs: 60_000, max: 1000, maxKeys: 1000 },
    maxBodyBytes: 1_000_000,
    requestTimeoutMs: 10_000,
    maxConcurrent: 4,
    drainMs: 100,
  }
}

async function withProductionHost(run: (origin: string) => Promise<void>): Promise<void> {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvb-prod-dist-'))
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><html><body>tvb</body></html>')
  const { server } = createProductionServer(makeConfig(distDir))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${address.port}`
  try {
    await run(origin)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => (server as unknown as { close: (cb: () => void) => void }).close(() => resolve()))
    fs.rmSync(distDir, { recursive: true, force: true })
  }
}

test('all seven read-only bridge families are mounted on the production host', async () => {
  await withProductionHost(async (origin) => {
    for (const bridgePath of BRIDGE_PATHS) {
      const response = await fetch(`${origin}${bridgePath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      assert.equal(response.status, 400, `${bridgePath} must reach its handler (validation 400), not 404`)
      const body = (await response.json()) as { ok: boolean; errors: { code: string }[] }
      assert.equal(body.ok, false)
      assert.ok(body.errors.length > 0, `${bridgePath} must return the handler validation envelope`)
    }
  })
})

test('vault preview/write routes are NOT mounted on the production host', async () => {
  await withProductionHost(async (origin) => {
    for (const vaultPath of ['/__tvb/vault/preview', '/__tvb/vault/write']) {
      const response = await fetch(`${origin}${vaultPath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      assert.equal(response.status, 404, `${vaultPath} must not exist on the read-only host`)
    }
  })
})
