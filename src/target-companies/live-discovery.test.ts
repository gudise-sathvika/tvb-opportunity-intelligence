import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  runTargetCompanyDiscovery,
  runTargetCompanyGrantsGovDiscovery,
} from './live-discovery'
import type { GrantsGovBridgeSearchResponse } from '../live-source/grantsgov-bridge/contract'

test('target-company Grants.gov discovery invokes queries and recommendations', async () => {
  const requester = async (_term: string): Promise<GrantsGovBridgeSearchResponse> => {
    const body = JSON.stringify({
      data: {
        oppHits: [
          {
            id: '123',
            title: 'AI Infrastructure Grant',
            number: 'AI-1',
            oppStatus: 'posted',
            openDate: '01/01/2026',
            closeDate: '12/31/2026',
            agency: 'Test Agency',
          },
        ],
      },
    })

    test('target-company discovery preserves a successful source when another source reports an error', async () => {
      const result = await runTargetCompanyDiscovery(
        { companyId: 'C1', name: 'ContextQA', sector: 'AI Infrastructure', country: 'US' },
        async () => ({
          ok: false,
          status: 503,
          body: null,
          errors: [{ code: 'unavailable', message: 'Source unavailable' }],
        }),
        async () => ({
          ok: true,
          status: 200,
          body: JSON.stringify({ apiVersion: '1.0', totalResults: 0, results: [] }),
        }),
      )

      assert.ok(result.sourceResults.find((source) => source.source === 'grantsgov')?.errors.length)
      assert.deepEqual(result.sourceResults.find((source) => source.source === 'eu-sedia')?.errors, [])
      assert.equal(result.records.length, 0)
    })

    test('a rejected source request is returned as a source-specific error, not thrown', async () => {
      const result = await runTargetCompanyGrantsGovDiscovery(
        { companyId: 'C1', name: 'ContextQA', sector: 'AI Infrastructure', country: 'US' },
        async () => {
          throw new Error('offline test failure')
        },
      )

      assert.ok(result.queries.length > 0)
      assert.ok(result.errors.length > 0)
      assert.ok(result.errors.every((message) => message.includes('Grants.gov request failed')))
      assert.equal(result.records.length, 0)
    })
    return { ok: true, status: 200, body }
  }

  const result = await runTargetCompanyGrantsGovDiscovery(
    { companyId: 'C1', name: 'ContextQA', sector: 'AI Infrastructure', country: 'US' },
    requester,
  )

  assert.ok(result.queries.length > 0)
  assert.equal(result.records.length, 1)
  assert.equal(result.recommendations.length, 1)
  assert.equal(result.recommendations[0].outcome, 'potentially_relevant')
})