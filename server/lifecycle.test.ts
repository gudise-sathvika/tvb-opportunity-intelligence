import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { test } from 'node:test'

import { TED_BRIDGE_SEARCH_PATH } from '../src/live-source/ted-bridge/contract'
import { createRequestListener } from './app'
import type { AppOptions } from './app'
import { ConcurrencyGate } from './concurrency'
import { createShutdownController, HostLifecycle } from './lifecycle'

const VALID_BODY = JSON.stringify({
  runId: 'r',
  companyId: 'c',
  keyword: 'solar',
  publishedAt: '2026-10-09T00:00:00Z',
  requestedAt: '2026-10-09T00:00:00Z',
})

interface Harness {
  readonly origin: string
  readonly server: Server
  readonly lifecycle: HostLifecycle
  readonly gate: ConcurrencyGate
  readonly logs: string[]
  readonly exits: number[]
  shutdown(signal?: NodeJS.Signals): Promise<{ drained: boolean; forced: boolean; inFlightAtStart: number }>
  close(): Promise<void>
}

async function startHarness(bridges: AppOptions['bridges'], drainMs: number, timeoutMs = 30_000): Promise<Harness> {
  const lifecycle = new HostLifecycle()
  const gate = new ConcurrencyGate(2)
  const listener = createRequestListener({ distDir: '.__no_static__', bridges, lifecycle, gate, timeoutMs })
  const server = createServer(listener)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const logs: string[] = []
  const exits: number[] = []
  const shutdown = createShutdownController({
    server,
    lifecycle,
    gate,
    drainMs,
    pollMs: 5,
    log: (message) => logs.push(message),
    onExit: (code) => exits.push(code),
  })
  return {
    origin: `http://127.0.0.1:${port}`,
    server,
    lifecycle,
    gate,
    logs,
    exits,
    shutdown,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function post(origin: string): Promise<Response> {
  return fetch(`${origin}${TED_BRIDGE_SEARCH_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: VALID_BODY,
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test('drains an in-flight request within the bound, then stops accepting work', async () => {
  let started = false
  let release: (() => void) | undefined
  const bridges: AppOptions['bridges'] = {
    [TED_BRIDGE_SEARCH_PATH]: () => {
      started = true
      return new Promise((resolve) => {
        release = () => resolve({ httpStatus: 200, body: { ok: true } })
      })
    },
  }
  const harness = await startHarness(bridges, 2_000, 5_000)
  try {
    const pending = post(harness.origin)
    await waitFor(() => started)

    const shutdownPromise = harness.shutdown('SIGTERM')
    assert.equal(harness.lifecycle.isReady(), false)
    assert.equal(harness.lifecycle.isShuttingDown(), true)
    await waitFor(() => harness.server.listening === false)

    release?.()
    const evidence = await shutdownPromise
    assert.deepEqual(evidence, { drained: true, forced: false, inFlightAtStart: 1 })
    assert.equal((await pending).status, 200, 'the in-flight request must complete during drain')
    assert.equal(harness.gate.inFlight, 0, 'the concurrency slot must be released')
    assert.deepEqual(harness.exits, [0], 'exit must run exactly once')

    await assert.rejects(post(harness.origin), 'new work must be refused after shutdown')
  } finally {
    harness.server.closeAllConnections()
    await harness.close()
  }
})

test('enforces the drain deadline, then forces remaining connections closed', async () => {
  const bridges: AppOptions['bridges'] = {
    [TED_BRIDGE_SEARCH_PATH]: () => new Promise<{ httpStatus: number; body: unknown }>(() => {}),
  }
  const harness = await startHarness(bridges, 100, 500)
  const controller = new AbortController()
  try {
    const started = Date.now()
    void fetch(`${harness.origin}${TED_BRIDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: VALID_BODY,
      signal: controller.signal,
    }).catch(() => {})
    await waitFor(() => harness.gate.inFlight === 1)

    const evidence = await harness.shutdown('SIGTERM')
    const elapsed = Date.now() - started
    assert.equal(evidence.drained, false)
    assert.equal(evidence.forced, true)
    assert.equal(evidence.inFlightAtStart, 1)
    assert.ok(elapsed < 3_000, `shutdown must not hang (took ${elapsed}ms)`)
    assert.deepEqual(harness.exits, [0])
  } finally {
    controller.abort()
    harness.server.closeAllConnections()
    await harness.close()
  }
})

test('repeated shutdown signals do not start a competing shutdown', async () => {
  const bridges: AppOptions['bridges'] = {
    [TED_BRIDGE_SEARCH_PATH]: () => ({ httpStatus: 200, body: { ok: true } }),
  }
  const harness = await startHarness(bridges, 1_000)
  try {
    const first = harness.shutdown('SIGTERM')
    const second = harness.shutdown('SIGINT')
    const [a, b] = await Promise.all([first, second])
    assert.equal(a, b, 'both signals must share one shutdown result')
    assert.equal(harness.logs.filter((line) => line.includes('already in progress')).length, 1)
    assert.deepEqual(harness.exits, [0], 'exit must run only once')
  } finally {
    harness.server.closeAllConnections()
    await harness.close()
  }
})
