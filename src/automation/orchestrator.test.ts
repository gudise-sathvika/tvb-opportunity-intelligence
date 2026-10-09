/**
 * Phase D discovery run orchestrator tests (Phase D brief §5, §6, §13).
 *
 * Behavior under test:
 *  - the run contract (identity, timestamps, per-source results, aggregates);
 *  - run-level outcome semantics (SUCCESS / NO_RESULTS / PARTIAL / BLOCKED /
 *    FAILED) with the documented precedence;
 *  - multi-source aggregation where one source never erases another;
 *  - source isolation: each adapter sees only its own request, and blocked
 *    sources are never passed to an adapter;
 *  - domain separation (funding / procurement), including a mixed-domain run;
 *  - GlobalTenders staying BLOCKED whether or not an adapter is bound;
 *  - determinism (no clock, no randomness, supplied identity preserved).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SourceDefinition } from './registry'
import { createSourceRegistry, FIXTURE_ADAPTER_TYPE, GLOBALTENDERS_SOURCE_ID } from './registry'
import { createFixtureAdapter } from './fixture-adapter'
import type { SourceAdapter } from './adapter'
import { executedResult } from './adapter'
import type { DiscoveryRequest } from './request'
import { makeRaw } from './phase-c-fixtures'
import type { DiscoveryRunInput, DiscoveryRunDependencies } from './orchestrator'
import { orchestrateDiscoveryRun } from './orchestrator'

const O1 = 'SU-FX-001' // procurement AVAILABLE
const O2 = 'SU-FX-002' // funding AVAILABLE
const O3 = 'SU-FX-030' // procurement AVAILABLE (custom)
const O4 = 'SU-FX-031' // procurement RESTRICTED
const O5 = 'SU-FX-032' // procurement AVAILABLE (throwing adapter)

function def(
  sourceId: string,
  name: string,
  applicability: SourceDefinition['applicability'],
  accessState: SourceDefinition['accessState'],
): SourceDefinition {
  return {
    sourceId,
    name,
    domain: 'fixture.invalid',
    applicability,
    discoveryCapability: 'listing_search',
    accessState,
    adapterType: FIXTURE_ADAPTER_TYPE,
    provenanceRequirements: ['listing_url', 'raw_payload', 'observed_at'],
    notesRestrictions: ['Local fixture only. No network access.'],
  }
}

const RUN_REGISTRY = createSourceRegistry([
  def(O1, 'Fixture Procurement Portal', 'procurement', 'AVAILABLE'),
  def(O2, 'Fixture Grants Portal', 'funding', 'AVAILABLE'),
  def(O3, 'Fixture Procurement Mirror (custom)', 'procurement', 'AVAILABLE'),
  def(O4, 'Fixture Restricted Portal', 'procurement', 'RESTRICTED'),
  def(O5, 'Fixture Flaky Portal', 'procurement', 'AVAILABLE'),
  def(GLOBALTENDERS_SOURCE_ID, 'GlobalTenders', 'procurement', 'UNKNOWN'),
])

function fixtureAdapters(): Readonly<Record<string, SourceAdapter>> {
  return {
    [O1]: createFixtureAdapter(O1),
    [O2]: createFixtureAdapter(O2),
    [O3]: createFixtureAdapter(O3),
    [O4]: createFixtureAdapter(O4),
    [O5]: createThrowingAdapter(O5),
    [GLOBALTENDERS_SOURCE_ID]: createFixtureAdapter(GLOBALTENDERS_SOURCE_ID),
  }
}

function createThrowingAdapter(sourceId: string): SourceAdapter {
  return Object.freeze({
    sourceId,
    adapterType: 'fixture-throwing',
    discover: () => {
      throw new Error('fixture adapter exploded')
    },
  })
}

/**
 * A funding adapter whose listing is genuinely unclassifiable (no raw type,
 * no vocabulary hint), so the pipeline must move the candidate to REVIEW
 * instead of guessing an opportunity type.
 */
function createNeedsReviewFundingAdapter(sourceId: string): SourceAdapter {
  return Object.freeze({
    sourceId,
    adapterType: 'fixture-funding-needs-review',
    discover(request: DiscoveryRequest) {
      return executedResult({
        request,
        sourceName: 'Fixture Grants Portal',
        adapterType: 'fixture-funding-needs-review',
        accessState: 'AVAILABLE',
        results: [
          makeRaw({
            sourceId,
            sourceUrl: 'https://fixture.invalid/grants/needs-review-1',
            title: 'Fixture Open Call for Community Innovators',
            rawType: null,
            sourceRecordId: 'FX-F-NR-1',
            queryTerm: 'fixture',
          }),
        ],
        errors: [],
      })
    },
  })
}

interface TraceAdapter extends SourceAdapter {
  readonly calls: readonly string[]
}

function createTraceAdapter(persona: SourceAdapter): TraceAdapter {
  const calls: string[] = []
  return Object.freeze({
    sourceId: persona.sourceId,
    adapterType: persona.adapterType,
    calls,
    discover(request: DiscoveryRequest): ReturnType<SourceAdapter['discover']> {
      calls.push(request.sourceId)
      return persona.discover(request)
    },
  })
}

const REQUESTED_AT = '2026-10-07T00:00:00.000Z'

function runInput(overrides: Partial<DiscoveryRunInput> = {}): DiscoveryRunInput {
  return {
    runId: overrides.runId ?? 'RUN-PHASED-001',
    companyId: overrides.companyId ?? 'COM-PHASED',
    discoveryProfileId: overrides.discoveryProfileId ?? 'DP-PHASED-v1',
    domain: overrides.domain ?? 'procurement',
    requestedAt: overrides.requestedAt ?? REQUESTED_AT,
    sourceIds: overrides.sourceIds ?? [O1],
    queryTerms: overrides.queryTerms ?? ['fixture search'],
    exclusions: overrides.exclusions ?? [],
    ...(overrides.adapterConfig !== undefined ? { adapterConfig: overrides.adapterConfig } : {}),
  }
}

function depsFor(adapters: Readonly<Record<string, SourceAdapter>> = fixtureAdapters()): DiscoveryRunDependencies {
  return { registry: RUN_REGISTRY, adapters }
}

test('a single AVAILABLE source with an adapter completes as SUCCESS with full provenance', () => {
  const result = orchestrateDiscoveryRun(runInput({ sourceIds: [O1] }), depsFor())

  assert.equal(result.outcome, 'SUCCESS')
  assert.equal(result.runId, 'RUN-PHASED-001')
  assert.equal(result.companyId, 'COM-PHASED')
  assert.equal(result.discoveryProfileId, 'DP-PHASED-v1')
  assert.equal(result.domain, 'procurement')
  assert.equal(result.requestedAt, REQUESTED_AT)
  assert.equal(result.completedAt, REQUESTED_AT, 'completedAt must equal requestedAt (no clock)')
  assert.deepEqual(result.sourceIds, [O1])

  assert.deepEqual(result.counts, {
    totalSources: 1,
    candidatesReceived: 2,
    candidatesCreated: 2,
    candidatesRequiringReview: 0,
    duplicates: 0,
    blockedSources: 0,
    failedSources: 0,
  })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])

  assert.equal(result.sourceResults.length, 1)
  const source = result.sourceResults[0] ?? assert.fail('expected a source result')
  assert.equal(source.sourceId, O1)
  assert.equal(source.sourceName, 'Fixture Procurement Portal')
  assert.equal(source.adapterType, FIXTURE_ADAPTER_TYPE)
  assert.equal(source.accessState, 'AVAILABLE')
  assert.equal(source.domain, 'procurement')
  assert.equal(source.outcome, 'SUCCESS')
  assert.equal(source.requestedAt, REQUESTED_AT)
  assert.equal(source.observedAt, REQUESTED_AT)
  assert.deepEqual(source.candidateIds, ['DC:SU-FX-001:FX-P-1001', 'DC:SU-FX-001:FX-P-1002'])

  assert.equal(result.candidates.length, 2)
  for (const candidate of result.candidates) {
    assert.equal(candidate.discoveryRunId, 'RUN-PHASED-001')
    assert.equal(candidate.companyId, 'COM-PHASED')
    assert.equal(candidate.discoveryProfileId, 'DP-PHASED-v1')
    assert.equal(candidate.sourceId, O1)
    assert.equal(candidate.domain, 'procurement')
    assert.equal(candidate.provenance.requestedAt, REQUESTED_AT)
    assert.equal(candidate.provenance.observedAt, REQUESTED_AT)
    assert.equal(candidate.provenance.accessState, 'AVAILABLE')
    assert.equal(candidate.classification?.type, 'Notice')
  }
})

test('multiple AVAILABLE sources aggregate into one run without cross-source merging', () => {
  const result = orchestrateDiscoveryRun(runInput({ sourceIds: [O1, O3] }), depsFor())

  assert.equal(result.outcome, 'SUCCESS')
  assert.equal(result.counts.totalSources, 2)
  assert.equal(result.counts.candidatesReceived, 4)
  assert.equal(result.counts.candidatesCreated, 4)
  assert.equal(result.candidates.length, 4)
  assert.deepEqual(result.sourceResults.map((s) => s.outcome), ['SUCCESS', 'SUCCESS'])

  const first = result.sourceResults[0] ?? assert.fail('expected a source result')
  const second = result.sourceResults[1] ?? assert.fail('expected a source result')
  assert.equal(first.sourceId, O1)
  assert.equal(second.sourceId, O3)
  assert.deepEqual(first.candidateIds, ['DC:SU-FX-001:FX-P-1001', 'DC:SU-FX-001:FX-P-1002'])
  assert.deepEqual(second.candidateIds, ['DC:SU-FX-030:FX-P-1001', 'DC:SU-FX-030:FX-P-1002'])
  assert.ok(result.candidates.every((candidate) => candidate.sourceId === O1 || candidate.sourceId === O3))
})

test('an empty source run is NO_RESULTS and is distinct from BLOCKED and FAILED', () => {
  const result = orchestrateDiscoveryRun(
    runInput({ sourceIds: [O1], adapterConfig: { scenario: 'empty' } }),
    depsFor(),
  )

  assert.equal(result.outcome, 'NO_RESULTS')
  assert.deepEqual(result.candidates, [])
  assert.equal(result.counts.candidatesCreated, 0)
  assert.equal(result.counts.blockedSources, 0)
  assert.equal(result.counts.failedSources, 0)
  assert.deepEqual(result.sourceResults[0]?.outcome, 'NO_RESULTS')
})

test('an unregistered source is BLOCKED with an unknown_source error', () => {
  const result = orchestrateDiscoveryRun(runInput({ sourceIds: ['SU-NOPE'] }), depsFor())

  assert.equal(result.outcome, 'BLOCKED')
  assert.equal(result.counts.blockedSources, 1)
  assert.equal(result.counts.totalSources, 1)
  assert.deepEqual(result.candidates, [])
  assert.equal(result.sourceResults[0]?.outcome, 'BLOCKED')
  assert.equal(result.sourceResults[0]?.sourceName, null)
  assert.ok(result.errors.some((error) => error.includes('unknown_source')))
})

test('an AVAILABLE source with no bound adapter is BLOCKED as adapter_not_available', () => {
  const result = orchestrateDiscoveryRun(runInput({ sourceIds: [O3] }), depsFor({}))

  assert.equal(result.outcome, 'BLOCKED')
  assert.equal(result.counts.blockedSources, 1)
  assert.equal(result.sourceResults[0]?.outcome, 'BLOCKED')
  assert.equal(result.sourceResults[0]?.adapterType, FIXTURE_ADAPTER_TYPE)
  assert.ok(result.errors.some((error) => error.includes('adapter_not_available')))
})

test('a throwing adapter fails without erasing a successful sibling source', () => {
  const result = orchestrateDiscoveryRun(runInput({ sourceIds: [O5, O1] }), depsFor())

  assert.equal(result.outcome, 'PARTIAL')
  assert.equal(result.counts.totalSources, 2)
  assert.equal(result.counts.failedSources, 1)
  assert.equal(result.counts.blockedSources, 0)
  assert.equal(result.sourceResults[0]?.outcome, 'FAILED')
  assert.equal(result.sourceResults[1]?.outcome, 'SUCCESS')
  assert.ok(result.errors.some((error) => error.includes('adapter_error')))

  assert.equal(result.candidates.length, 2, 'the successful source keeps its candidates')
  assert.ok(result.candidates.every((candidate) => candidate.sourceId === O1))
  assert.deepEqual(result.sourceResults[1]?.candidateIds, ['DC:SU-FX-001:FX-P-1001', 'DC:SU-FX-001:FX-P-1002'])
})

test('GlobalTenders stays BLOCKED even with an adapter bound, and the adapter is never invoked', () => {
  const gt = createTraceAdapter(createFixtureAdapter(GLOBALTENDERS_SOURCE_ID))
  const result = orchestrateDiscoveryRun(
    runInput({ sourceIds: [GLOBALTENDERS_SOURCE_ID] }),
    depsFor({ [GLOBALTENDERS_SOURCE_ID]: gt }),
  )

  assert.equal(result.outcome, 'BLOCKED')
  assert.equal(result.counts.blockedSources, 1)
  assert.deepEqual(result.candidates, [])
  assert.equal(result.sourceResults[0]?.outcome, 'BLOCKED')
  assert.equal(result.sourceResults[0]?.accessState, 'UNKNOWN')
  assert.ok(result.errors.some((error) => error.includes('source_blocked')))
  assert.deepEqual(gt.calls, [], 'a blocked source must never reach its adapter')
})

test('GlobalTenders with no adapter bound is also BLOCKED via a never-invoked guard', () => {
  const result = orchestrateDiscoveryRun(runInput({ sourceIds: [GLOBALTENDERS_SOURCE_ID] }), depsFor({}))

  assert.equal(result.outcome, 'BLOCKED')
  assert.equal(result.sourceResults[0]?.outcome, 'BLOCKED')
  assert.equal(result.sourceResults[0]?.accessState, 'UNKNOWN')
  assert.ok(result.errors.some((error) => error.includes('source_blocked')))
})

test('a RESTRICTED source with an adapter bound is BLOCKED and the adapter is never invoked', () => {
  const restricted = createTraceAdapter(createFixtureAdapter(O4))
  const result = orchestrateDiscoveryRun(runInput({ sourceIds: [O4] }), depsFor({ [O4]: restricted }))

  assert.equal(result.outcome, 'BLOCKED')
  assert.equal(result.sourceResults[0]?.outcome, 'BLOCKED')
  assert.equal(result.sourceResults[0]?.accessState, 'RESTRICTED')
  assert.ok(result.errors.some((error) => error.includes('source_blocked')))
  assert.deepEqual(restricted.calls, [], 'a RESTRICTED source must never reach its adapter')
})

test('a RESTRICTED source with no adapter is BLOCKED without throwing', () => {
  const result = orchestrateDiscoveryRun(runInput({ sourceIds: [O4] }), depsFor({}))

  assert.equal(result.outcome, 'BLOCKED')
  assert.equal(result.counts.blockedSources, 1)
  assert.deepEqual(result.candidates, [])
  assert.equal(result.sourceResults[0]?.outcome, 'BLOCKED')
})

test('a failed source plus a blocked source plus a success is PARTIAL with all sources preserved', () => {
  const gt = createTraceAdapter(createFixtureAdapter(GLOBALTENDERS_SOURCE_ID))
  const result = orchestrateDiscoveryRun(
    runInput({ sourceIds: [O5, GLOBALTENDERS_SOURCE_ID, O1] }),
    depsFor({ ...fixtureAdapters(), [GLOBALTENDERS_SOURCE_ID]: gt }),
  )

  assert.equal(result.outcome, 'PARTIAL')
  assert.equal(result.counts.totalSources, 3)
  assert.equal(result.counts.failedSources, 1)
  assert.equal(result.counts.blockedSources, 1)
  assert.equal(result.counts.candidatesCreated, 2)
  assert.deepEqual(result.sourceResults.map((s) => s.outcome), ['FAILED', 'BLOCKED', 'SUCCESS'])
  assert.deepEqual(gt.calls, [], 'the blocked source is isolated even in a mixed run')
  assert.equal(result.candidates.length, 2)
  assert.ok(result.candidates.every((candidate) => candidate.sourceId === O1))
})

test('source isolation: each adapter receives only its own request', () => {
  const o1 = createTraceAdapter(createFixtureAdapter(O1))
  const o3 = createTraceAdapter(createFixtureAdapter(O3))
  const both = orchestrateDiscoveryRun(runInput({ sourceIds: [O1, O3] }), depsFor({ [O1]: o1, [O3]: o3 }))

  assert.equal(both.outcome, 'SUCCESS')
  assert.deepEqual(o1.calls, ['SU-FX-001'], 'the procurement adapter served only its own source')
  assert.deepEqual(o3.calls, ['SU-FX-030'], 'the other procurement adapter served only its own source')

  const o1b = createTraceAdapter(createFixtureAdapter(O1))
  const o2b = createTraceAdapter(createFixtureAdapter(O2))
  const mixed = orchestrateDiscoveryRun(
    runInput({ sourceIds: [O1, O2], domain: 'funding' }),
    depsFor({ [O1]: o1b, [O2]: o2b }),
  )

  assert.equal(mixed.outcome, 'PARTIAL', 'procurement source in a funding run is domain-blocked')
  assert.deepEqual(o1b.calls, [], 'a domain-blocked procurement source must never reach its adapter')
  assert.deepEqual(o2b.calls, ['SU-FX-002'])
  assert.equal(mixed.sourceResults[0]?.outcome, 'BLOCKED')
  assert.equal(mixed.sourceResults[1]?.outcome, 'SUCCESS')
  assert.ok(mixed.errors.some((error) => error.includes('domain_mismatch')))
})

test('funding and procurement run domains stay sealed and separated', () => {
  const funding = orchestrateDiscoveryRun(runInput({ sourceIds: [O2], domain: 'funding' }), depsFor())
  const procurement = orchestrateDiscoveryRun(runInput({ sourceIds: [O1] }), depsFor())

  assert.equal(funding.outcome, 'SUCCESS')
  assert.equal(procurement.outcome, 'SUCCESS')
  for (const candidate of funding.candidates) {
    assert.equal(candidate.domain, 'funding')
    assert.equal(candidate.classification?.type, 'Grant')
  }
  for (const candidate of procurement.candidates) {
    assert.equal(candidate.domain, 'procurement')
    assert.equal(candidate.classification?.type, 'Notice')
  }
})

test('a funding-domain run that lists a procurement source is a domain-mismatch BLOCK for that source', () => {
  const result = orchestrateDiscoveryRun(runInput({ sourceIds: [O1], domain: 'funding' }), depsFor())

  assert.equal(result.outcome, 'BLOCKED')
  assert.equal(result.sourceResults[0]?.outcome, 'BLOCKED')
  assert.equal(result.counts.blockedSources, 1)
  assert.deepEqual(result.candidates, [])
  assert.ok(result.errors.some((error) => error.includes('domain_mismatch')))
})

test('the run-level adapterConfig is applied to every request', () => {
  const result = orchestrateDiscoveryRun(
    runInput({ sourceIds: [O1, O3], adapterConfig: { scenario: 'empty' } }),
    depsFor(),
  )

  assert.equal(result.outcome, 'NO_RESULTS')
  assert.equal(result.counts.totalSources, 2)
  assert.deepEqual(result.sourceResults.map((s) => s.outcome), ['NO_RESULTS', 'NO_RESULTS'])
  assert.deepEqual(result.candidates, [])
})

test('duplicate source ids are deduplicated while preserving request order', () => {
  const result = orchestrateDiscoveryRun(runInput({ sourceIds: [O1, O1, O3] }), depsFor())

  assert.equal(result.outcome, 'SUCCESS')
  assert.deepEqual(result.sourceIds, [O1, O3])
  assert.equal(result.counts.totalSources, 2)
  assert.equal(result.candidates.length, 4)
})

test('runs are deterministic: identical inputs and deps produce identical results', () => {
  const input = runInput({ sourceIds: [O1, O2, O5, GLOBALTENDERS_SOURCE_ID], domain: 'funding' })
  const first = orchestrateDiscoveryRun(input, depsFor())
  const second = orchestrateDiscoveryRun(input, depsFor())

  assert.deepEqual(first, second)
  assert.equal(first.completedAt, first.requestedAt)
})

test('a partial run is PARTIAL and keeps survivors and per-item errors', () => {
  const result = orchestrateDiscoveryRun(
    runInput({ sourceIds: [O1], adapterConfig: { scenario: 'partial' } }),
    depsFor(),
  )

  assert.equal(result.outcome, 'PARTIAL')
  assert.equal(result.sourceResults[0]?.outcome, 'PARTIAL')
  assert.equal(result.counts.candidatesReceived, 2)
  assert.equal(result.counts.candidatesCreated, 2)
  assert.equal(result.candidates.length, 2)
  assert.ok(result.errors.some((error) => error.includes('item 0')))
})

test('invalid run inputs are rejected as BLOCKED with validation errors', () => {
  const cases: Array<[Partial<DiscoveryRunInput>, string]> = [
    [{ sourceIds: [] }, 'sourceIds'],
    [{ runId: '' }, 'runId'],
    [{ requestedAt: '' }, 'requestedAt'],
    [{ domain: 'engineering' as DiscoveryRunInput['domain'] }, 'domain'],
    [{ queryTerms: [] }, 'queryTerms'],
  ]
  for (const [overrides, marker] of cases) {
    const result = orchestrateDiscoveryRun(runInput(overrides), depsFor())
    assert.equal(result.outcome, 'BLOCKED', `input ${JSON.stringify(overrides)} must reject as BLOCKED`)
    assert.equal(result.counts.totalSources, 0)
    assert.deepEqual(result.sourceResults, [])
    assert.deepEqual(result.candidates, [])
    assert.ok(result.errors.some((error) => error.includes(marker)), `errors must mention ${marker}`)
  }
})

test('a non-object run input is rejected as BLOCKED', () => {
  const result = orchestrateDiscoveryRun(null as unknown as DiscoveryRunInput, depsFor())
  assert.equal(result.outcome, 'BLOCKED')
  assert.deepEqual(result.sourceResults, [])
  assert.ok(result.errors.some((error) => error.includes('object')))
})

test('sourceIds containing empty strings are rejected as BLOCKED', () => {
  const result = orchestrateDiscoveryRun(runInput({ sourceIds: [O1, ''] }), depsFor())
  assert.equal(result.outcome, 'BLOCKED')
  assert.ok(result.errors.some((error) => error.includes('sourceIds')))
})

test('candidates requiring human review are counted at run and source level', () => {
  const needsReview = createNeedsReviewFundingAdapter(O2)
  const result = orchestrateDiscoveryRun(
    runInput({ sourceIds: [O2], domain: 'funding' }),
    depsFor({ [O2]: needsReview }),
  )

  assert.equal(result.outcome, 'SUCCESS')
  assert.equal(result.counts.candidatesRequiringReview, 1)
  assert.equal(result.sourceResults[0]?.candidatesRequiringReview, 1)
  const candidate = result.candidates[0] ?? assert.fail('expected a candidate')
  assert.equal(candidate.candidateStatus, 'REVIEW')
  assert.equal(candidate.classification?.state, 'NEEDS_REVIEW')
  assert.equal(candidate.classification?.type, null, 'a needs-review candidate is never assigned a type')
})