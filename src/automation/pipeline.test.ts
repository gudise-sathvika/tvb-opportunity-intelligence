/**
 * Discovery candidate pipeline tests (Phase C brief §6, §10, §11, §12).
 *
 * Behavior under test: the end-to-end transform → normalize → classify →
 * dedup composition; the outcome vocabulary including the distinct
 * NO_RESULTS signal; GlobalTenders staying BLOCKED while a synthetic
 * GlobalTenders-STYLE result still flows through the pipeline with no
 * network; funding/procurement separation; and the "never auto-approve /
 * never fabricate" guarantees.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_SOURCE_REGISTRY, FIXTURE_FUNDING_SOURCE_ID, FIXTURE_PROCUREMENT_SOURCE_ID, GLOBALTENDERS_SOURCE_ID } from './registry'
import { createFixtureAdapter } from './fixture-adapter'
import { buildPipelineResult, runCandidatePipeline } from './pipeline'
import { makeRaw, syntheticAdapterResult, fixtureRequest } from './phase-c-fixtures'

const PROCUREMENT_ADAPTER = createFixtureAdapter(FIXTURE_PROCUREMENT_SOURCE_ID)
const FUNDING_ADAPTER = createFixtureAdapter(FIXTURE_FUNDING_SOURCE_ID)

const NON_AUTO_STATUSES = ['NEW', 'NORMALIZED', 'REVIEW', 'DUPLICATE', 'BLOCKED'] as const

test('a full funding run flows through every stage and reports SUCCESS', () => {
  const result = runCandidatePipeline(
    fixtureRequest({ sourceId: FIXTURE_FUNDING_SOURCE_ID, domain: 'funding' }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: FUNDING_ADAPTER },
  )

  assert.equal(result.outcome, 'SUCCESS')
  assert.equal(result.sourceId, FIXTURE_FUNDING_SOURCE_ID)
  assert.equal(result.domain, 'funding')
  assert.deepEqual(result.counts, {
    candidatesReceived: 1,
    candidatesCreated: 1,
    normalized: 1,
    classified: 1,
    distinct: 1,
    duplicates: 0,
    possibleDuplicates: 0,
    blocked: 0,
    failed: 0,
  })
  assert.deepEqual(result.errors, [])

  const candidate = result.candidates[0] ?? assert.fail('expected a candidate')
  assert.equal(candidate.candidateId, 'DC:SU-FX-002:FX-F-2001')
  assert.deepEqual(candidate.provenance.stageHistory, ['transform', 'normalize', 'classify', 'dedup'])
  assert.equal(candidate.normalization?.status, 'UNCHANGED')
  assert.equal(candidate.classification?.state, 'CLASSIFIED')
  assert.equal(candidate.classification?.type, 'Grant')
  assert.equal(candidate.classification?.certainty, 'HIGH')
  assert.equal(candidate.duplicate?.verdict, 'DISTINCT')
  assert.equal(candidate.candidateStatus, 'NORMALIZED')
  assert.equal(candidate.sourcePublicationDate, '2026-08-15')
  assert.equal(candidate.sourceDeadline, '2027-01-31')
  assert.equal(candidate.sourceCountry, 'Wonderland')
  assert.equal(result.provenance.sourceId, FIXTURE_FUNDING_SOURCE_ID)
})

test('a full procurement run produces two Notice candidates with no duplicates', () => {
  const result = runCandidatePipeline(fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID }), {
    registry: DEFAULT_SOURCE_REGISTRY,
    adapter: PROCUREMENT_ADAPTER,
  })

  assert.equal(result.outcome, 'SUCCESS')
  assert.equal(result.candidates.length, 2)
  assert.deepEqual(result.counts.distinct, 2)
  assert.deepEqual(result.counts.duplicates, 0)
  for (const candidate of result.candidates) {
    assert.equal(candidate.classification?.type, 'Notice')
    assert.equal(candidate.classification?.certainty, 'HIGH')
  }
  assert.equal(result.candidates[0]?.sourceRawType, 'RFB')
  assert.equal(result.candidates[1]?.sourceRawType, 'RFB')
})

test('an empty run is NO_RESULTS and is distinct from BLOCKED and FAILED', () => {
  const empty = runCandidatePipeline(
    fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID, adapterConfig: { scenario: 'empty' } }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: PROCUREMENT_ADAPTER },
  )
  assert.equal(empty.outcome, 'NO_RESULTS')
  assert.deepEqual(empty.candidates, [])
  assert.deepEqual(empty.counts.candidatesReceived, 0)
  assert.deepEqual(empty.counts.blocked, 0)
  assert.deepEqual(empty.counts.failed, 0)

  const blocked = runCandidatePipeline(
    fixtureRequest({ sourceId: GLOBALTENDERS_SOURCE_ID }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: PROCUREMENT_ADAPTER },
  )
  assert.notEqual(blocked.outcome, 'NO_RESULTS')
  assert.equal(blocked.outcome, 'BLOCKED')

  const failed = runCandidatePipeline(
    fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID, adapterConfig: { scenario: 'failure' } }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: PROCUREMENT_ADAPTER },
  )
  assert.notEqual(failed.outcome, 'NO_RESULTS')
  assert.equal(failed.outcome, 'FAILED')
})

test('a blocked run reports BLOCKED with the reason and count, and no candidates', () => {
  const result = runCandidatePipeline(
    fixtureRequest({ sourceId: GLOBALTENDERS_SOURCE_ID, domain: 'procurement' }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: PROCUREMENT_ADAPTER },
  )
  assert.equal(result.outcome, 'BLOCKED')
  assert.equal(result.counts.blocked, 1)
  assert.equal(result.counts.failed, 0)
  assert.deepEqual(result.candidates, [])
  assert.ok(result.errors.some((error) => error.includes('UNKNOWN')), 'blocked reason names the access state')
})

test('a failed run reports FAILED and never yields candidates', () => {
  const result = runCandidatePipeline(
    fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID, adapterConfig: { scenario: 'failure' } }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: PROCUREMENT_ADAPTER },
  )
  assert.equal(result.outcome, 'FAILED')
  assert.equal(result.counts.failed, 1)
  assert.deepEqual(result.candidates, [])
  assert.ok(result.errors.some((error) => error.includes('adapter_error')))
})

test('a partial run is PARTIAL, keeps survivors and the per-item errors', () => {
  const result = runCandidatePipeline(
    fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID, adapterConfig: { scenario: 'partial' } }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: PROCUREMENT_ADAPTER },
  )
  assert.equal(result.outcome, 'PARTIAL')
  assert.equal(result.counts.candidatesReceived, 2)
  assert.equal(result.counts.candidatesCreated, 2)
  assert.equal(result.candidates.length, 2)
  assert.ok(result.errors.some((error) => error.includes('item 0')))
})

test('a candidate whose title fails normalization is blocked, counted, and excluded from dedup', () => {
  const request = fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID, domain: 'procurement' })
  const result = buildPipelineResult(
    syntheticAdapterResult({
      request,
      sourceName: 'Fixture Procurement Portal (test)',
      adapterType: 'fixture',
      results: [
        makeRaw({ sourceUrl: 'https://fixture.invalid/tenders/bad', title: '   ', sourceRecordId: 'FX-P-BAD', queryTerm: 'fixture' }),
        makeRaw({ sourceUrl: 'https://fixture.invalid/tenders/good', title: 'Fixture Good Tender', rawType: 'RFB', sourceRecordId: 'FX-P-GOOD', queryTerm: 'fixture' }),
      ],
    }),
  )

  assert.equal(result.outcome, 'SUCCESS')
  assert.equal(result.counts.blocked, 1)
  assert.equal(result.counts.normalized, 1)
  assert.equal(result.counts.classified, 1)
  assert.equal(result.candidates.length, 2, 'the blocked candidate is preserved in the result, not dropped')
  const bad = result.candidates.find((candidate) => candidate.candidateId === 'DC:SU-FX-001:FX-P-BAD')
  assert.equal(bad?.candidateStatus, 'BLOCKED')
  assert.equal(bad?.normalization?.status, 'FAILED')
  assert.equal(bad?.classification, null, 'a blocked candidate is never classified')
  assert.equal(bad?.duplicate, null, 'a blocked candidate never enters deduplication')
})

test('a synthetic GlobalTenders-STYLE result flows through the pipeline with no network', () => {
  const request = fixtureRequest({ sourceId: GLOBALTENDERS_SOURCE_ID, domain: 'procurement', runId: 'RUN-GT-SYNTH' })
  const result = buildPipelineResult(
    syntheticAdapterResult({
      request,
      sourceName: 'GlobalTenders (synthetic)',
      adapterType: 'globaltenders-synthetic',
      accessState: 'AVAILABLE',
      results: [
        makeRaw({
          sourceId: GLOBALTENDERS_SOURCE_ID,
          sourceUrl: 'https://www.globaltenders.com/notice/GT-2026-0001',
          title: 'Synthetic GlobalTenders Framework Notice',
          rawType: 'RFB',
          sourceRecordId: 'GT-2026-0001',
          queryTerm: 'fixture',
          country: 'Wonderland',
        }),
      ],
    }),
  )

  assert.equal(result.outcome, 'SUCCESS', 'synthetic GlobalTenders-style data is exercised offline')
  assert.equal(result.sourceId, GLOBALTENDERS_SOURCE_ID)
  assert.equal(result.provenance.sourceId, GLOBALTENDERS_SOURCE_ID)
  const candidate = result.candidates[0] ?? assert.fail('expected a candidate')
  assert.equal(candidate.candidateId, 'DC:SU-GT-001:GT-2026-0001')
  assert.equal(candidate.classification?.type, 'Notice')
  assert.equal(candidate.classification?.certainty, 'HIGH')
  assert.equal(candidate.classification?.evidence.sourceEvidence.sourceId, GLOBALTENDERS_SOURCE_ID)
})

test('real GlobalTenders execution stays BLOCKED even with an adapter bound', () => {
  const result = runCandidatePipeline(
    fixtureRequest({ sourceId: GLOBALTENDERS_SOURCE_ID, domain: 'procurement' }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: createFixtureAdapter(GLOBALTENDERS_SOURCE_ID) },
  )
  assert.equal(result.outcome, 'BLOCKED')
  assert.equal(result.counts.blocked, 1)
  assert.deepEqual(result.candidates, [])
  assert.equal(result.provenance.accessState, 'UNKNOWN')
  assert.ok(result.errors.some((error) => error.includes('source_blocked')))
})

test('the pipeline never auto-approves or rejects a candidate', () => {
  const results = [
    runCandidatePipeline(
      fixtureRequest({ sourceId: FIXTURE_FUNDING_SOURCE_ID, domain: 'funding' }),
      { registry: DEFAULT_SOURCE_REGISTRY, adapter: FUNDING_ADAPTER },
    ),
    runCandidatePipeline(
      fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID }),
      { registry: DEFAULT_SOURCE_REGISTRY, adapter: PROCUREMENT_ADAPTER },
    ),
  ]
  for (const result of results) {
    for (const candidate of result.candidates) {
      assert.ok(
        (NON_AUTO_STATUSES as readonly string[]).includes(candidate.candidateStatus),
        `pipeline must only produce ${NON_AUTO_STATUSES.join('/')}, got ${candidate.candidateStatus}`,
      )
    }
  }
})

test('funding and procurement separation holds end-to-end', () => {
  const funding = runCandidatePipeline(
    fixtureRequest({ sourceId: FIXTURE_FUNDING_SOURCE_ID, domain: 'funding' }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: FUNDING_ADAPTER },
  )
  const procurement = runCandidatePipeline(
    fixtureRequest({ sourceId: FIXTURE_PROCUREMENT_SOURCE_ID }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: PROCUREMENT_ADAPTER },
  )

  assert.equal(funding.domain, 'funding')
  assert.equal(procurement.domain, 'procurement')
  for (const candidate of funding.candidates) assert.notEqual(candidate.classification?.type, 'Notice')
  for (const candidate of procurement.candidates) assert.equal(candidate.classification?.type, 'Notice')
})