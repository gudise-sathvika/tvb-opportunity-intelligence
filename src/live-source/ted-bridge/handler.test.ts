/**
 * Phase 4 ted-bridge handler — unit tests (fully offline).
 *
 * The handler performs exactly one POST per request through an injected
 * transport; a fake transport captures the URL/body and returns a recorded
 * TED response, so these tests verify the handler's validation and the single
 * source call without any network.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { TED_SEARCH_ENDPOINT } from '../../automation/ted-adapter'
import type { TedTransportResponse } from '../../automation/ted-adapter'
import { TED_SEARCH_RESPONSE_RECORDING } from '../../automation/ted-fixture'
import { handleTedBridge } from './handler'
import type { TedBridgeSearchRequest } from './contract'

const REQUEST: TedBridgeSearchRequest = {
  runId: 'RUN-T-0001',
  companyId: 'Aavo',
  keyword: 'solar energy',
  publishedSince: '20260801',
  limit: 5,
  requestedAt: '2026-10-09T00:00:00.000Z',
}

function fakeTransport(capture: { calls: { url: string; body: string }[] }, answer: TedTransportResponse = { status: 200, body: TED_SEARCH_RESPONSE_RECORDING }) {
  return (url: string, init: { method: 'POST'; headers: Readonly<Record<string, string>>; body: string }) => {
    capture.calls.push({ url, body: init.body })
    return Promise.resolve(answer)
  }
}

test('a valid request performs exactly one POST to the official TED endpoint', async () => {
  const capture = { calls: [] as { url: string; body: string }[] }
  const result = await handleTedBridge(REQUEST, { transport: fakeTransport(capture) })

  assert.equal(result.httpStatus, 200)
  assert.ok(result.body.ok)
  if (result.body.ok) {
    assert.equal(result.body.status, 200)
    assert.equal(result.body.body, TED_SEARCH_RESPONSE_RECORDING)
  }

  assert.equal(capture.calls.length, 1)
  assert.equal(capture.calls[0].url, TED_SEARCH_ENDPOINT)
  const payload = JSON.parse(capture.calls[0].body) as { query: string; page: number; limit: number; fields: string[] }
  assert.equal(payload.query, 'notice-title~"solar energy" AND publication-date>=20260801')
  assert.equal(payload.page, 1)
  assert.equal(payload.limit, 5)
  assert.ok(Array.isArray(payload.fields) && payload.fields.length > 0)
})

test('missing required fields are refused honestly', async () => {
  const result = await handleTedBridge(null)
  assert.equal(result.httpStatus, 400)
  assert.ok(!result.body.ok)
  if (!result.body.ok) {
    assert.equal(result.body.errors[0].code, 'malformed_request')
  }
})

test('an empty keyword cannot build a search', async () => {
  const result = await handleTedBridge({ ...REQUEST, keyword: '   ' })
  assert.equal(result.httpStatus, 400)
  assert.ok(!result.body.ok)
  if (!result.body.ok) {
    assert.match(result.body.errors[0].message, /keyword is required/)
  }
})

test('a malformed publishedSince is rejected by the real query planner', async () => {
  const result = await handleTedBridge({ ...REQUEST, publishedSince: 'not-a-date' })
  assert.equal(result.httpStatus, 400)
  assert.ok(!result.body.ok)
  if (!result.body.ok) {
    assert.match(result.body.errors[0].message, /publishedSince/)
  }
})

test('a transport rejection is a 502 bridge failure, never an empty success', async () => {
  const result = await handleTedBridge(REQUEST, {
    transport: () => Promise.reject(new Error('source unreachable')),
  })
  assert.equal(result.httpStatus, 502)
  assert.ok(!result.body.ok)
  if (!result.body.ok) {
    assert.equal(result.body.errors[0].code, 'source_failure')
    assert.match(result.body.errors[0].message, /source unreachable/)
  }
})

test('a non-2xx source status is forwarded with its real status inside the body', async () => {
  const result = await handleTedBridge(REQUEST, {
    transport: fakeTransport({ calls: [] }, { status: 429, body: 'rate limited' }),
  })
  assert.equal(result.httpStatus, 429)
  assert.ok(result.body.ok)
  if (result.body.ok) {
    assert.equal(result.body.status, 429)
  }
})