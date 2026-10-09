/**
 * Phase 21C EU SEDIA bridge handler — offline unit tests.
 *
 * The handler's live POST is replaced by an injected transport, so no network is
 * touched. Verifies URL/body/headers, broad-vs-keyword behavior, and that
 * failures are explicit errors, never empty successes.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { handleEuSediaBridge } from './handler'
import type { EuSediaTransport } from '../../automation/eu-sedia-adapter'

const REQUESTED_AT = '2026-10-09T00:00:00.000Z'

const BODY = JSON.stringify({
  apiVersion: '1.0',
  totalResults: 1,
  results: [
    {
      reference: 'HORIZON-1',
      url: 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/HORIZON-1',
      metadata: {
        DATASOURCE: ['SEDIA'],
        type: ['1'],
        status: ['31094502'],
        title: ['AI grant topic'],
        deadlineDate: ['2026-12-01T17:00:00.000+01:00'],
      },
    },
  ],
})

function capturingTransport(captured: { url?: string; init?: any }): EuSediaTransport {
  return (url, init) => {
    captured.url = url
    captured.init = init
    return { status: 200, body: BODY }
  }
}

test('broad bridge request builds one SEDIA POST with the three multipart parts and browser headers', async () => {
  const captured: { url?: string; init?: any } = {}
  const result = await handleEuSediaBridge(
    { runId: 'RUN-EU-0001', companyId: 'RUN', keyword: '', limit: 5, requestedAt: REQUESTED_AT },
    { transport: capturingTransport(captured) },
  )

  assert.equal(result.httpStatus, 200)
  assert.equal(result.body.ok, true)
  assert.equal(captured.url?.includes('apiKey=SEDIA'), true)
  assert.equal(captured.url?.includes('text=*'), true)
  assert.equal(captured.url?.includes('pageSize=5'), true)

  const headers = captured.init?.headers ?? {}
  assert.equal(headers['content-type']?.startsWith('multipart/form-data; boundary='), true)
  assert.equal(headers.origin, 'https://ec.europa.eu')
  assert.equal(typeof headers.referer, 'string')

  const body: string = captured.init?.body ?? ''
  assert.equal(body.includes('name="query"'), true)
  assert.equal(body.includes('name="languages"'), true)
  assert.equal(body.includes('name="displayLanguage"'), true)
})

test('a keyword request sends the keyword as the text term', async () => {
  const captured: { url?: string; init?: any } = {}
  await handleEuSediaBridge(
    { runId: 'RUN-EU-0002', companyId: 'RUN', keyword: 'artificial intelligence', limit: 5, requestedAt: REQUESTED_AT },
    { transport: capturingTransport(captured) },
  )
  assert.equal(captured.url?.includes('text=artificial+intelligence'), true)
})

test('a missing runId is a 400, never a search', async () => {
  let called = false
  const transport: EuSediaTransport = () => {
    called = true
    return { status: 200, body: BODY }
  }
  const result = await handleEuSediaBridge(
    { runId: '', companyId: 'RUN', keyword: 'ai', limit: 5, requestedAt: REQUESTED_AT },
    { transport },
  )
  assert.equal(result.httpStatus, 400)
  assert.equal(called, false)
  assert.equal(result.body.ok, false)
})

test('a transport failure is a 502 error, never an empty success', async () => {
  const result = await handleEuSediaBridge(
    { runId: 'RUN-EU-0003', companyId: 'RUN', keyword: 'ai', limit: 5, requestedAt: REQUESTED_AT },
    {
      transport: () => {
        throw new Error('source unreachable')
      },
    },
  )
  assert.equal(result.httpStatus, 502)
  assert.equal(result.body.ok, false)
  if (!result.body.ok) {
    assert.equal(result.body.errors[0]?.code, 'source_failure')
  }
})
