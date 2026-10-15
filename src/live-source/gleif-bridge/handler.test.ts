/**
 * Phase 06 gleif-bridge handler — unit tests (fully offline).
 *
 * The handler performs exactly one GET per request through an injected fetch;
 * a fake fetch captures the URL and returns a recorded GLEIF response, so
 * these tests verify validation and the single source call without network.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GLEIF_API_HOST } from '../../automation/gleif-company-discovery'
import { handleGleifBridge } from './handler'
import type { GleifBridgeSearchRequest } from './contract'

const REQUEST: GleifBridgeSearchRequest = {
  runId: 'RUN-LIVE-MATCH',
  companyId: 'RUN',
  query: 'General Electric',
  limit: 5,
  requestedAt: '2026-10-09T00:00:00.000Z',
}

const GLEIF_RECORDING = JSON.stringify({
  data: [
    {
      id: '3C7474T6CDKPR9K6YT90',
      attributes: {
        lei: '3C7474T6CDKPR9K6YT90',
        entity: {
          legalName: { name: 'GENERAL ELECTRIC COMPANY' },
          legalAddress: { country: 'US' },
          status: 'ACTIVE',
        },
        registration: { status: 'ISSUED' },
      },
    },
  ],
})

function fakeFetch(capture: { calls: { url: string }[] }, status = 200, body: string = GLEIF_RECORDING) {
  return (async (url: string) => {
    capture.calls.push({ url: url as string })
    return { status, text: async () => body }
  }) as unknown as typeof globalThis.fetch
}

test('a valid request performs exactly one GET against the official LEI endpoint', async () => {
  const capture = { calls: [] as { url: string }[] }
  const result = await handleGleifBridge(REQUEST, { fetchImpl: fakeFetch(capture) })

  assert.equal(result.httpStatus, 200)
  assert.ok(result.body.ok)
  if (result.body.ok) {
    assert.equal(result.body.status, 200)
    assert.equal(result.body.body, GLEIF_RECORDING)
  }

  assert.equal(capture.calls.length, 1)
  const url = new URL(capture.calls[0].url)
  assert.equal(url.host, GLEIF_API_HOST)
  assert.equal(url.pathname, '/api/v1/lei-records')
  assert.equal(url.searchParams.get('filter[entity.legalName]'), 'General Electric')
  assert.equal(url.searchParams.get('page[size]'), '5')
})

test('a blank legal-name query is refused honestly', async () => {
  const capture = { calls: [] as { url: string }[] }
  const result = await handleGleifBridge({ ...REQUEST, query: '   ' }, { fetchImpl: fakeFetch(capture) })
  assert.equal(result.httpStatus, 400)
  assert.ok(!result.body.ok)
  assert.equal(capture.calls.length, 0)
})

test('missing required fields are refused honestly', async () => {
  const result = await handleGleifBridge(null)
  assert.equal(result.httpStatus, 400)
  assert.ok(!result.body.ok)
})

test('a source failure is reported, never converted to an empty success', async () => {
  const failing = (async () => {
    throw new Error('socket hang up')
  }) as unknown as typeof globalThis.fetch
  const result = await handleGleifBridge(REQUEST, { fetchImpl: failing })
  assert.equal(result.httpStatus, 502)
  assert.ok(!result.body.ok)
  if (!result.body.ok) {
    assert.equal(result.body.errors[0].code, 'source_failure')
  }
})
