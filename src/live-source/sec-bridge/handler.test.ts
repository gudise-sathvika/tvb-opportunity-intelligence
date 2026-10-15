/**
 * Phase 08 sec-bridge handler — unit tests (fully offline).
 *
 * A fake fetch routes by URL and returns recorded EDGAR bodies, verifying the
 * bounded two-step retrieval (ticker file, then one filer submissions file)
 * without any network.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { handleSecEnrichBridge } from './handler'

const BASE = {
  runId: 'RUN-LIVE-MATCH',
  companyId: 'RUN',
  legalName: 'GENERAL ELECTRIC COMPANY',
  requestedAt: '2026-10-09T00:00:00.000Z',
}

const TICKERS_BODY = JSON.stringify({ 0: { cik_str: 40545, ticker: 'GE', title: 'GENERAL ELECTRIC CO' } })
const SUB_BODY = JSON.stringify({ cik: '0000040545', sicDescription: 'Electronic equipment' })

function fakeFetch(capture: { calls: string[] }) {
  return (async (url: string) => {
    capture.calls.push(url as string)
    if (String(url).includes('company_tickers.json')) return { status: 200, text: async () => TICKERS_BODY }
    if (String(url).includes('CIK0000040545.json')) return { status: 200, text: async () => SUB_BODY }
    return { status: 404, text: async () => 'not found' }
  }) as unknown as typeof globalThis.fetch
}

test('a legal-name request fetches only the ticker file', async () => {
  const capture = { calls: [] as string[] }
  const result = await handleSecEnrichBridge(BASE, { fetchImpl: fakeFetch(capture) })
  assert.equal(result.httpStatus, 200)
  assert.ok(result.body.ok)
  if (result.body.ok) {
    assert.ok(result.body.body.tickers.includes('GENERAL ELECTRIC CO'))
    assert.equal(result.body.body.submissions, null)
    assert.equal(result.body.body.resolvedCik, null)
  }
  assert.equal(capture.calls.length, 1)
  assert.ok(capture.calls[0].includes('company_tickers.json'))
  assert.ok(!capture.calls.some((url) => url.includes('submissions')))
})

test('a resolved CIK fetches exactly one submissions document', async () => {
  const capture = { calls: [] as string[] }
  const result = await handleSecEnrichBridge({ ...BASE, cik: 'CIK0000040545' }, { fetchImpl: fakeFetch(capture) })
  assert.equal(result.httpStatus, 200)
  assert.ok(result.body.ok)
  if (result.body.ok) {
    assert.equal(result.body.body.resolvedCik, 'CIK0000040545')
    assert.ok((result.body.body.submissions ?? '').includes('Electronic equipment'))
  }
  assert.equal(capture.calls.length, 1)
  assert.ok(capture.calls[0].includes('data.sec.gov/submissions/CIK0000040545.json'))
})

test('missing identity is refused and failures stay failures', async () => {
  const blank = await handleSecEnrichBridge({ ...BASE, legalName: '   ' })
  assert.equal(blank.httpStatus, 400)
  const failing = (async () => {
    throw new Error('socket hang up')
  }) as unknown as typeof globalThis.fetch
  const result = await handleSecEnrichBridge(BASE, { fetchImpl: failing })
  assert.equal(result.httpStatus, 502)
  assert.ok(!result.body.ok)
})
