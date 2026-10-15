/**
 * Phase 03A fts-bridge handler — unit tests (fully offline).
 *
 * The handler performs exactly one GET per request through an injected
 * transport; a fake transport captures the URL and returns a recorded FTS
 * response, so these tests verify the handler's validation and the single
 * source call without any network.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { FTS_SEARCH_ENDPOINT } from '../../automation/fts-adapter'
import type { FtsTransportResponse } from '../../automation/fts-adapter'
import { handleFtsBridge } from './handler'
import type { FtsBridgeSearchRequest } from './contract'

const REQUEST: FtsBridgeSearchRequest = {
  runId: 'RUN-T-0001',
  companyId: 'RUN',
  limit: 5,
  requestedAt: '2026-10-09T00:00:00.000Z',
}

const FTS_RECORDING = JSON.stringify({
  uri: 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=5',
  publishedDate: '2026-10-09T00:00:00+01:00',
  releases: [
    {
      ocid: 'ocds-h6vhtk-TEST01',
      id: '000001-2026',
      date: '2026-10-09T00:00:00+01:00',
      tender: {
        id: 'T-1',
        title: 'Testable Test Services Lot',
        description: 'A recorded test tender.',
        status: 'active',
        tenderPeriod: { endDate: '2026-12-31T12:00:00Z' },
        procurementMethod: 'open',
      },
      buyer: { name: 'Test Buyer' },
    },
  ],
})

function fakeTransport(capture: { calls: { url: string }[] }, answer: FtsTransportResponse = { status: 200, body: FTS_RECORDING }) {
  return (url: string, _init: { method: 'GET'; headers: Readonly<Record<string, string>>; body?: string }) => {
    capture.calls.push({ url })
    return Promise.resolve(answer)
  }
}

test('a valid request performs exactly one GET to the official FTS endpoint', async () => {
  const capture = { calls: [] as { url: string }[] }
  const result = await handleFtsBridge(REQUEST, { transport: fakeTransport(capture) })

  assert.equal(result.httpStatus, 200)
  assert.ok(result.body.ok)
  if (result.body.ok) {
    assert.equal(result.body.status, 200)
    assert.equal(result.body.body, FTS_RECORDING)
  }

  assert.equal(capture.calls.length, 1)
  assert.ok(capture.calls[0].url.startsWith(FTS_SEARCH_ENDPOINT))
  assert.ok(capture.calls[0].url.includes('limit=5'))
})

test('missing required fields are refused honestly', async () => {
  const result = await handleFtsBridge(null)
  assert.equal(result.httpStatus, 400)
  assert.ok(!result.body.ok)
  if (!result.body.ok) {
    assert.equal(result.body.errors[0].code, 'malformed_request')
  }
})

test('a source failure is reported, never converted to an empty success', async () => {
  const result = await handleFtsBridge(REQUEST, {
    transport: () => Promise.reject(new Error('socket hang up')),
  })
  assert.equal(result.httpStatus, 502)
  assert.ok(!result.body.ok)
  if (!result.body.ok) {
    assert.equal(result.body.errors[0].code, 'source_failure')
  }
})
