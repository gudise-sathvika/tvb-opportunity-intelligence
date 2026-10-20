import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runTargetCompanyGrantsGovDiscovery } from './live-discovery'
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