/**
 * Phase V USAspending bridge handler tests — offline, driven by the genuine
 * recorded response. No test touches the live internet or writes to the vault.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { UsaSpendingTransport } from '../../automation/usaspending-adapter'
import { USA_SPENDING_RECORDING_OBSERVED_AT, USA_SPENDING_SEARCH_RESPONSE_RECORDING } from '../../automation/usaspending-fixture'
import { handleUsaSpendingBridge } from './handler'

function okTransport(): UsaSpendingTransport {
  return () => ({ status: 200, body: USA_SPENDING_SEARCH_RESPONSE_RECORDING })
}

function request(): Parameters<typeof handleUsaSpendingBridge>[0] {
  return {
    runId: 'RUN-F-0001',
    companyId: 'COM-001',
    keyword: 'solar energy',
    publishedSince: '20251009',
    limit: 10,
    requestedAt: USA_SPENDING_RECORDING_OBSERVED_AT,
  }
}

test('a valid request performs one read-only search and returns the raw source body', async () => {
  const result = await handleUsaSpendingBridge(request(), { transport: okTransport() })
  assert.equal(result.httpStatus, 200)
  assert.equal(result.body.ok, true)
  if (result.body.ok) {
    assert.equal(result.body.status, 200)
    assert.equal(result.body.body, USA_SPENDING_SEARCH_RESPONSE_RECORDING)
  }
})

test('the forwarded body carries a bounded time_period with both start_date and end_date', async () => {
  const calls: Array<{ url: string; body: string }> = []
  const result = await handleUsaSpendingBridge(request(), {
    transport: (url, init) => {
      calls.push({ url, body: init.body })
      return { status: 200, body: USA_SPENDING_SEARCH_RESPONSE_RECORDING }
    },
  })
  assert.equal(result.httpStatus, 200)
  assert.equal(calls.length, 1)
  const body = JSON.parse(calls[0].body) as {
    filters: { time_period?: Array<{ start_date: string; end_date: string }> }
  }
  assert.deepEqual(body.filters.time_period, [{ start_date: '2025-10-09', end_date: '2026-10-09' }])
})

test('a source error status is surfaced with the raw status, never as an empty success', async () => {
  const result = await handleUsaSpendingBridge(request(), {
    transport: () => ({ status: 403, body: '{"message":"Missing Authentication Token"}' }),
  })
  assert.equal(result.httpStatus, 403)
  // The bridge relays the source's raw status/body unchanged; the adapter turns
  // a refused 403 into the RESTRICTED BLOCKED envelope (covered in the adapter
  // tests) rather than an invented empty success.
  assert.equal(result.body.ok, true)
  if (result.body.ok) {
    assert.equal(result.body.status, 403)
  }
})

test('malformed and blank requests are rejected with explicit errors', async () => {
  const malformed = await handleUsaSpendingBridge(null, { transport: okTransport() })
  assert.equal(malformed.httpStatus, 400)
  assert.equal(malformed.body.ok, false)

  const blank = await handleUsaSpendingBridge(
    { runId: 'RUN-F-0001', companyId: 'COM-001', keyword: '', publishedSince: '', limit: 10, requestedAt: USA_SPENDING_RECORDING_OBSERVED_AT },
    { transport: okTransport() },
  )
  assert.equal(blank.httpStatus, 400)
  if (!blank.body.ok) {
    assert.equal(blank.body.errors[0].code, 'invalid_request')
  }
})