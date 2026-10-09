/**
 * Phase J GlobalTenders adapter tests.
 *
 * Minimum proofs only:
 *  1. access-blocked behavior is explicit (UNKNOWN registry state → BLOCKED);
 *  2. the AdapterResult envelope is valid and frozen;
 *  3. request provenance is preserved on the BLOCKED result;
 *  4. errors stay observable (code + reason, no silent empty success);
 *  5. the adapter refuses requests for other sources;
 *  6. even an AVAILABLE registry entry yields zero fabricated listings;
 *  7. the gate + pipeline + orchestration carry the BLOCKED result with no
 *     candidates (the pipeline receives the adapter output honestly);
 *  8. repeated runs are byte-identical (no clock, no randomness, no I/O).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createGlobalTendersAdapter } from './globaltenders-adapter'
import { createDiscoveryRequest } from './request'
import {
  DEFAULT_SOURCE_REGISTRY,
  FIXTURE_PROCUREMENT_SOURCE_ID,
  GLOBALTENDERS_SOURCE_ID,
  createSourceRegistry,
} from './registry'
import { runDiscovery } from './discovery-run'
import { orchestrateDiscoveryRun } from './orchestrator'

const REQUESTED_AT = '2026-10-07T00:00:00.000Z'

function gtRequest(overrides: Record<string, unknown> = {}) {
  return createDiscoveryRequest({
    runId: 'RUN-GT-1',
    companyId: 'COMP-001',
    discoveryProfileId: 'DP-GT-1',
    sourceId: GLOBALTENDERS_SOURCE_ID,
    domain: 'procurement',
    queryTerms: ['bridge'],
    exclusions: [],
    requestedAt: REQUESTED_AT,
    ...overrides,
  })
}

test('GlobalTenders is BLOCKED with an explicit access reason and zero results', () => {
  const adapter = createGlobalTendersAdapter()
  assert.equal(adapter.sourceId, GLOBALTENDERS_SOURCE_ID)
  assert.equal(adapter.adapterType, 'globaltenders')

  const result = adapter.discover(gtRequest())
  assert.equal(result.status, 'BLOCKED')
  assert.deepEqual(result.results, [], 'a blocked source never yields findings')
  assert.ok(result.blockedReason?.includes('not AVAILABLE'), `reason names the cause, got: ${result.blockedReason}`)
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0].code, 'source_blocked')
  assert.ok(
    result.errors[0].message.includes('never been observed or authorized') &&
      result.errors[0].message.includes('never queried'),
    `error documents exactly why, got: ${result.errors[0].message}`,
  )
  assert.ok(Object.isFrozen(result))
})

test('the BLOCKED envelope preserves request provenance and uses no clock', () => {
  const result = createGlobalTendersAdapter().discover(gtRequest())

  assert.equal(result.sourceId, GLOBALTENDERS_SOURCE_ID)
  assert.equal(result.adapterType, 'globaltenders')
  assert.equal(result.accessState, 'UNKNOWN', 'the registry truth, never inflated')
  assert.equal(result.runId, 'RUN-GT-1')
  assert.equal(result.domain, 'procurement')
  assert.equal(result.requestedAt, REQUESTED_AT)
  assert.equal(result.observedAt, REQUESTED_AT, 'observedAt comes from the request, not a clock')
  assert.equal(result.provenance.runId, 'RUN-GT-1')
  assert.equal(result.provenance.companyId, 'COMP-001')
  assert.equal(result.provenance.discoveryProfileId, 'DP-GT-1')
  assert.equal(result.provenance.sourceId, GLOBALTENDERS_SOURCE_ID)
  assert.equal(result.provenance.sourceName, 'GlobalTenders')
})

test('the adapter refuses requests for other sources', () => {
  const result = createGlobalTendersAdapter().discover(
    gtRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID }),
  )
  assert.equal(result.status, 'BLOCKED')
  assert.deepEqual(result.results, [])
  assert.ok(result.blockedReason?.includes('GlobalTenders only'))
  assert.equal(result.errors[0].code, 'adapter_not_available')
})

test('even an AVAILABLE registry entry yields zero fabricated listings', () => {
  const available = createSourceRegistry([
    { ...DEFAULT_SOURCE_REGISTRY.get(GLOBALTENDERS_SOURCE_ID)!, accessState: 'AVAILABLE' as const },
  ])
  const adapter = createGlobalTendersAdapter(available)

  const result = adapter.discover(gtRequest())
  assert.equal(result.status, 'BLOCKED', 'no transport exists, so nothing is fabricated')
  assert.deepEqual(result.results, [])
  assert.ok(result.blockedReason?.includes('transport is not implemented'))
  assert.equal(result.accessState, 'AVAILABLE', 'the registry truth is reported, not hidden')
})

test('the gate never lets the unauthorized source reach retrieval', () => {
  const adapter = createGlobalTendersAdapter()
  const result = runDiscovery(gtRequest(), { registry: DEFAULT_SOURCE_REGISTRY, adapter })

  assert.equal(result.status, 'BLOCKED')
  assert.deepEqual(result.results, [])
  assert.equal(result.errors[0].code, 'source_blocked')
  assert.ok(result.blockedReason?.includes('UNKNOWN'))
})

test('an orchestrated GlobalTenders run is BLOCKED with zero candidates', () => {
  const adapter = createGlobalTendersAdapter()
  const run = orchestrateDiscoveryRun(
    {
      runId: 'RUN-GT-1-COMP-001',
      companyId: 'COMP-001',
      discoveryProfileId: 'DP-GT-1',
      domain: 'procurement',
      requestedAt: REQUESTED_AT,
      sourceIds: [GLOBALTENDERS_SOURCE_ID],
      queryTerms: ['bridge'],
    },
    { registry: DEFAULT_SOURCE_REGISTRY, adapters: { [GLOBALTENDERS_SOURCE_ID]: adapter } },
  )

  assert.equal(run.outcome, 'BLOCKED')
  assert.deepEqual(run.candidates, [], 'the pipeline receives the BLOCKED output: no candidates')
  assert.equal(run.counts.candidatesCreated, 0)
  assert.equal(run.counts.blockedSources, 1)
  assert.equal(run.sourceResults.length, 1)
  assert.equal(run.sourceResults[0].outcome, 'BLOCKED')
  assert.equal(run.sourceResults[0].accessState, 'UNKNOWN')
  assert.ok(run.sourceResults[0].errors.some((error) => error.includes('source_blocked') || error.includes('UNKNOWN')))
})

test('repeated runs are byte-identical: no clock, no randomness, no I/O', () => {
  const adapter = createGlobalTendersAdapter()
  assert.deepEqual(adapter.discover(gtRequest()), adapter.discover(gtRequest()))
})
