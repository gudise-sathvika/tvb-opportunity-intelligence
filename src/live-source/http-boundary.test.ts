import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BRIDGE_MAX_BODY_BYTES,
  clampSearchLimit,
  dispatchBridgeRequest,
  type BridgeRequest,
} from './http-boundary'

interface FakeInit {
  method?: string
  url?: string
  contentType?: string | null
  body?: string
  contentLength?: number
}

function fakeRequest(init: FakeInit = {}): BridgeRequest {
  const headers: Record<string, string | undefined> = {}
  const contentType = init.contentType === undefined ? 'application/json' : init.contentType
  if (contentType !== null) headers['content-type'] = contentType
  if (init.contentLength !== undefined) headers['content-length'] = String(init.contentLength)
  const body = init.body ?? ''
  return {
    method: init.method ?? 'POST',
    url: init.url ?? '/x',
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== '') yield body
    },
  }
}

const ROUTES = { '/x': async (value: unknown) => ({ httpStatus: 200, body: { ok: true, received: value } }) }

test('valid request reaches the handler and its response is preserved', async () => {
  const result = await dispatchBridgeRequest(
    fakeRequest({ url: '/x?ignored=1', body: JSON.stringify({ keyword: 'solar' }) }),
    { routes: ROUTES },
  )
  assert.deepEqual(result, { httpStatus: 200, body: { ok: true, received: { keyword: 'solar' } } })
})

test('an unmatched path returns null so the caller can continue', async () => {
  const result = await dispatchBridgeRequest(fakeRequest({ url: '/nope' }), { routes: ROUTES })
  assert.equal(result, null)
})

test('a non-POST method is rejected with 405', async () => {
  const result = await dispatchBridgeRequest(fakeRequest({ method: 'GET' }), { routes: ROUTES })
  assert.equal(result?.httpStatus, 405)
  assert.deepEqual(result?.body, { ok: false, error: { code: 'method_not_allowed', message: 'expected POST' } })
})

test('an unsupported Content-Type is rejected with 415', async () => {
  const result = await dispatchBridgeRequest(fakeRequest({ contentType: 'text/plain' }), { routes: ROUTES })
  assert.equal(result?.httpStatus, 415)
})

test('a missing Content-Type is rejected with 415', async () => {
  const result = await dispatchBridgeRequest(fakeRequest({ contentType: null }), { routes: ROUTES })
  assert.equal(result?.httpStatus, 415)
})

test('malformed JSON is rejected with 400 and never reaches the handler', async () => {
  let called = false
  const result = await dispatchBridgeRequest(fakeRequest({ body: '{not json' }), {
    routes: { '/x': async () => (called = true, { httpStatus: 200, body: {} }) },
  })
  assert.equal(result?.httpStatus, 400)
  assert.deepEqual(result?.body, { ok: false, error: { code: 'malformed_json', message: 'request body is not valid JSON' } })
  assert.equal(called, false)
})

test('an empty body is treated as an empty object', async () => {
  const result = await dispatchBridgeRequest(fakeRequest({ body: '' }), { routes: ROUTES })
  assert.deepEqual(result, { httpStatus: 200, body: { ok: true, received: {} } })
})

test('an oversized body is rejected with 413 before the handler runs', async () => {
  let called = false
  const result = await dispatchBridgeRequest(
    fakeRequest({ body: 'x'.repeat(BRIDGE_MAX_BODY_BYTES + 1) }),
    { routes: { '/x': async () => (called = true, { httpStatus: 200, body: {} }) } },
  )
  assert.equal(result?.httpStatus, 413)
  assert.equal(called, false)
})

test('a declared Content-Length over the cap is rejected with 413 without reading', async () => {
  const result = await dispatchBridgeRequest(
    fakeRequest({ body: 'x', contentLength: BRIDGE_MAX_BODY_BYTES + 1 }),
    { routes: ROUTES },
  )
  assert.equal(result?.httpStatus, 413)
})

test('a handler exception yields 500 bridge_failure', async () => {
  const result = await dispatchBridgeRequest(fakeRequest(), {
    routes: { '/x': async () => { throw new Error('boom') } },
  })
  assert.equal(result?.httpStatus, 500)
  assert.deepEqual(result?.body, { ok: false, error: { code: 'bridge_failure', message: 'boom' } })
})

test('an upstream failure status is propagated unchanged, never a success', async () => {
  const result = await dispatchBridgeRequest(fakeRequest(), {
    routes: { '/x': async () => ({ httpStatus: 502, body: { ok: false, status: 502, errors: [{ code: 'source_failure', message: 'upstream refused' }] } }) },
  })
  assert.equal(result?.httpStatus, 502)
  assert.deepEqual(result?.body, { ok: false, status: 502, errors: [{ code: 'source_failure', message: 'upstream refused' }] })
})

test('a handler that does not resolve within the timeout yields 504', async () => {
  const result = await dispatchBridgeRequest(fakeRequest(), {
    routes: { '/x': () => new Promise<{ httpStatus: number; body: unknown }>(() => {}) },
    timeoutMs: 25,
  })
  assert.equal(result?.httpStatus, 504)
  assert.equal((result?.body as { error: { code: string } }).error.code, 'bridge_timeout')
})

test('clampSearchLimit keeps valid limits and clamps out-of-range values to 1–100', () => {
  assert.equal(clampSearchLimit(5, 10), 5)
  assert.equal(clampSearchLimit(10, 10), 10)
  assert.equal(clampSearchLimit(0, 10), 1)
  assert.equal(clampSearchLimit(-4, 10), 1)
  assert.equal(clampSearchLimit(500, 10), 100)
  assert.equal(clampSearchLimit(7.9, 10), 7)
  assert.equal(clampSearchLimit(undefined, 10), 10)
  assert.equal(clampSearchLimit(Number.NaN, 10), 10)
  assert.equal(clampSearchLimit('20', 10), 10)
})
