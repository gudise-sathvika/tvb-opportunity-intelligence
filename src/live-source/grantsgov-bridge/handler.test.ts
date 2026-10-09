/**
 * Phase 19B Grants.gov bridge handler tests — fully offline. No test touches the
 * live internet or writes to the vault; every transport is a local stub. The
 * fixture body is constructed from the official `search2` schema (no live
 * capture).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { GrantsGovTransport } from '../../automation/grantsgov-adapter'
import { GRANTS_GOV_SEARCH_ENDPOINT } from '../../automation/grantsgov-adapter'
import type { GrantsGovBridgeSearchRequest } from './contract'
import { handleGrantsGovBridge } from './handler'

const VALID_BODY = JSON.stringify({
  errorcode: 0,
  msg: 'Success',
  data: {
    hitCount: 1,
    oppHits: [
      {
        id: '123456',
        number: 'EPA-2026-001',
        title: 'Clean Water Infrastructure Grant',
        agencyCode: 'EPA',
        agencyName: 'Environmental Protection Agency',
        openDate: '2026-01-01',
        closeDate: '2026-03-01',
        oppStatus: 'posted',
        docType: 'synopsis',
        alnist: ['66.458'],
      },
    ],
    errorMsgs: [],
  },
})

function request(): GrantsGovBridgeSearchRequest {
  return {
    runId: 'RUN-F-0002',
    companyId: 'COM-001',
    keyword: 'clean water',
    oppStatuses: '',
    limit: 10,
    requestedAt: '2026-01-15T00:00:00.000Z',
  }
}

test('a valid request performs one read-only search and returns the raw source body', async () => {
  const calls: Array<{ url: string; method: string; body: string }> = []
  const result = await handleGrantsGovBridge(request(), {
    transport: (url, init) => {
      calls.push({ url, method: init.method, body: init.body })
      return { status: 200, body: VALID_BODY }
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, GRANTS_GOV_SEARCH_ENDPOINT)
  assert.equal(calls[0].method, 'POST')
  assert.equal(result.httpStatus, 200)
  assert.equal(result.body.ok, true)
  if (result.body.ok) {
    assert.equal(result.body.status, 200)
    assert.equal(result.body.body, VALID_BODY)
  }
})

test('the forwarded body carries keyword, rows, and the default status filter', async () => {
  const calls: string[] = []
  await handleGrantsGovBridge(request(), {
    transport: (_url, init) => {
      calls.push(init.body)
      return { status: 200, body: VALID_BODY }
    },
  })
  assert.equal(calls.length, 1)
  const body = JSON.parse(calls[0]) as { rows: number; keyword: string; oppStatuses: string }
  assert.equal(body.rows, 10)
  assert.equal(body.keyword, 'clean water')
  assert.equal(body.oppStatuses, 'posted')
})

test('a blank keyword performs a broad posted search with no keyword and no company substitution', async () => {
  const calls: string[] = []
  const result = await handleGrantsGovBridge({ ...request(), keyword: '' }, {
    transport: (_url, init) => {
      calls.push(init.body)
      return { status: 200, body: VALID_BODY }
    },
  })
  assert.equal(result.httpStatus, 200)
  assert.equal(calls.length, 1)
  const body = JSON.parse(calls[0]) as Record<string, unknown>
  assert.equal('keyword' in body, false)
  assert.equal(body.oppStatuses, 'posted')
})

test('an explicit oppStatuses filter overrides the default', async () => {
  const calls: string[] = []
  await handleGrantsGovBridge({ ...request(), oppStatuses: 'forecasted' }, {
    transport: (_url, init) => {
      calls.push(init.body)
      return { status: 200, body: VALID_BODY }
    },
  })
  const body = JSON.parse(calls[0]) as { oppStatuses: string }
  assert.equal(body.oppStatuses, 'forecasted')
})

test('an empty source result set is relayed as a successful response, not a failure', async () => {
  const empty = JSON.stringify({ errorcode: 0, msg: 'Success', data: { hitCount: 0, oppHits: [], errorMsgs: [] } })
  const result = await handleGrantsGovBridge(request(), { transport: () => ({ status: 200, body: empty }) })
  assert.equal(result.httpStatus, 200)
  assert.equal(result.body.ok, true)
  if (result.body.ok) assert.equal(result.body.body, empty)
})

test('the raw source status is preserved in the returned body (no re-mapping)', async () => {
  const body = JSON.stringify({ errorcode: 0, msg: 'Success', data: { hitCount: 1, oppHits: [
    { id: '9', title: 'Forecast', oppStatus: 'forecasted' },
  ], errorMsgs: [] } })
  const result = await handleGrantsGovBridge(request(), { transport: () => ({ status: 200, body }) })
  assert.equal(result.body.ok, true)
  if (result.body.ok) assert.equal(result.body.body, body)
})

test('malformed and missing-field requests are rejected with explicit errors and no upstream call', async () => {
  let calls = 0
  const transport: GrantsGovTransport = () => {
    calls += 1
    return { status: 200, body: VALID_BODY }
  }

  const malformed = await handleGrantsGovBridge(null, { transport })
  assert.equal(malformed.httpStatus, 400)
  assert.equal(malformed.body.ok, false)
  if (!malformed.body.ok) assert.equal(malformed.body.errors[0].code, 'malformed_request')

  const missing = await handleGrantsGovBridge({ ...request(), runId: '' }, { transport })
  assert.equal(missing.httpStatus, 400)

  assert.equal(calls, 0, 'invalid requests must never reach the source')
})

test('an unusable status filter is rejected before any upstream call', async () => {
  let calls = 0
  const result = await handleGrantsGovBridge({ ...request(), oppStatuses: 'nonsense|garbage' }, {
    transport: () => {
      calls += 1
      return { status: 200, body: VALID_BODY }
    },
  })
  assert.equal(result.httpStatus, 400)
  if (!result.body.ok) assert.equal(result.body.errors[0].code, 'invalid_request')
  assert.equal(calls, 0)
})

test('an upstream transport failure is reported as a 502 source_failure, never an empty success', async () => {
  const result = await handleGrantsGovBridge(request(), {
    transport: () => {
      throw new Error('socket hang up')
    },
  })
  assert.equal(result.httpStatus, 502)
  assert.equal(result.body.ok, false)
  if (!result.body.ok) {
    assert.equal(result.body.errors[0].code, 'source_failure')
    assert.ok(result.body.errors[0].message.includes('socket hang up'))
  }
})

test('a non-2xx source status is surfaced with the raw status and body unchanged', async () => {
  const upstream = '{"errorcode":99,"msg":"service unavailable"}'
  const result = await handleGrantsGovBridge(request(), { transport: () => ({ status: 503, body: upstream }) })
  assert.equal(result.httpStatus, 503)
  assert.equal(result.body.ok, true)
  if (result.body.ok) {
    assert.equal(result.body.status, 503)
    assert.equal(result.body.body, upstream)
  }
})
