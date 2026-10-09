/**
 * Fixture adapter — the ONE deterministic mock adapter for framework testing
 * (Phase B brief §11).
 *
 * It never touches the network. It returns small hard-coded fixture listings
 * through the same SourceAdapter interface as a real adapter will. Behavior is a
 * pure function of the request (including its `adapterConfig`), so the same
 * request always yields the same outcome:
 *
 *   scenario: undefined | 'ok'     → SUCCESS with fixture results
 *   scenario: 'partial'            → PARTIAL (results plus one per-item error)
 *   scenario: 'failure'            → FAILED (no results, an adapter error)
 *   scenario: 'empty'              → SUCCESS with zero results (legal only
 *                                    because the gate proved the source AVAILABLE)
 *
 * The fixture creates no vault record, no Match, and no Bid.
 */

import type { DiscoveryRequest } from './request'
import type { AdapterResult, ExecutionError, RawResult, DiscoveryDomain } from './types'
import type { SourceAdapter } from './adapter'
import { executedResult } from './adapter'
import { DEFAULT_SOURCE_REGISTRY } from './registry'
import { FIXTURE_ADAPTER_TYPE } from './registry'

export type FixtureScenario = 'partial' | 'failure' | 'empty'

export interface FixtureAdapterConfig {
  scenario?: FixtureScenario
}

const observedAt = '2026-10-07T00:00:00.000Z'

// Procurement-domain fixture listings (RFB-like). Fictional and non-resolvable.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function procurementFixtures(queryTerm: string, sourceId: string): RawResult[] {
  return [
    {
      sourceRecordId: 'FX-P-1001',
      sourceUrl: 'https://fixture.invalid/tenders/FX-P-1001',
      title: 'Fixture Framework Agreement for Construction Services',
      description:
        'A deterministic local fixture listing. This text is not a real tender and cannot be fetched.',
      publicationDate: '2026-09-01',
      deadline: '2026-11-15',
      issuingOrganization: 'Fixture Public Procurement Authority',
      country: 'Wonderland',
      rawType: 'RFB',
      rawPayload: '{"fixture":true,"domain":"procurement","record":"FX-P-1001"}',
      rawProvenance: {
        sourceId,
        sourceUrl: 'https://fixture.invalid/tenders/FX-P-1001',
        sourceRecordId: 'FX-P-1001',
        observedAt,
        queryTerm,
      },
    },
    {
      sourceRecordId: 'FX-P-1002',
      sourceUrl: 'https://fixture.invalid/tenders/FX-P-1002',
      title: 'Fixture IT Equipment Supply Tender (Year 1)',
      description: 'A deterministic local fixture listing. Not a real request for bids.',
      publicationDate: null,
      deadline: '2026-12-01',
      issuingOrganization: 'Fixture Digital Services Agency',
      country: null,
      rawType: 'RFB',
      rawPayload: '{"fixture":true,"domain":"procurement","record":"FX-P-1002"}',
      rawProvenance: {
        sourceId,
        sourceUrl: 'https://fixture.invalid/tenders/FX-P-1002',
        sourceRecordId: 'FX-P-1002',
        observedAt,
        queryTerm,
      },
    },
  ]
}

function fundingFixtures(queryTerm: string, sourceId: string): RawResult[] {
  return [
    {
      sourceRecordId: 'FX-F-2001',
      sourceUrl: 'https://fixture.invalid/grants/FX-F-2001',
      title: 'Fixture Climate Innovation Grant Programme',
      description: 'A deterministic local fixture listing. Not a real funding opportunity.',
      publicationDate: '2026-08-15',
      deadline: '2027-01-31',
      issuingOrganization: 'Fixture Climate Innovation Fund',
      country: 'Wonderland',
      rawType: 'grant',
      rawPayload: '{"fixture":true,"domain":"funding","record":"FX-F-2001"}',
      rawProvenance: {
        sourceId,
        sourceUrl: 'https://fixture.invalid/grants/FX-F-2001',
        sourceRecordId: 'FX-F-2001',
        observedAt,
        queryTerm,
      },
    },
  ]
}

function fixtureResultsFor(domain: DiscoveryDomain, queryTerm: string, sourceId: string): RawResult[] {
  return domain === 'procurement' ? procurementFixtures(queryTerm, sourceId) : fundingFixtures(queryTerm, sourceId)
}

export function createFixtureAdapter(sourceId: string): SourceAdapter {
  const source = DEFAULT_SOURCE_REGISTRY.get(sourceId)
  const sourceName = source ? source.name : sourceId
  return {
    sourceId,
    adapterType: FIXTURE_ADAPTER_TYPE,
    discover(request: DiscoveryRequest): AdapterResult {
      const config = (request.adapterConfig ?? {}) as FixtureAdapterConfig
      const scenario = config.scenario
      const results =
        scenario === 'empty' || scenario === 'failure'
          ? []
          : fixtureResultsFor(request.domain, request.queryTerms[0] ?? '', sourceId)

      const errors: ExecutionError[] = []
      if (scenario === 'partial') {
        errors.push({ code: 'item_error', message: 'fixture item 0 failed to parse', itemIndex: 0 })
      }
      if (scenario === 'failure') {
        errors.push({ code: 'adapter_error', message: 'fixture source returned a malformed listing payload' })
      }

      return executedResult({
        request,
        sourceName,
        adapterType: FIXTURE_ADAPTER_TYPE,
        accessState: 'AVAILABLE',
        results,
        errors,
      })
    },
  }
}