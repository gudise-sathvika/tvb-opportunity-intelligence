/**
 * Phase G discovery control panel fixture tests (Phase G brief §5–§8, §16;
 * Phase H §6–§7).
 *
 * These cover the deterministic fixture orchestration that backs the control
 * panel: run identity and scenario handling, per-company execution through the
 * REAL Phase D orchestrator, run-level rollups, domain separation between
 * Grants and RFPs, the Phase H request filters, and the review handoff that
 * feeds the Phase E queue.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DISCOVERY_FIXTURE_REQUESTED_AT,
  beginRun,
  discoveryFixtureStore,
  finishRun,
  runCompany,
} from './discovery-fixture'
import { FIXTURE_FUNDING_SOURCE_ID, FIXTURE_PROCUREMENT_SOURCE_ID } from './registry'

const COMPANIES = ['COMP-001', 'COMP-002', 'COMP-003']

function standardRun(domain: 'funding' | 'procurement', companies: readonly string[] = COMPANIES) {
  const context = beginRun({ domain })
  const results = companies.map((companyId) => runCompany(context, companyId))
  return finishRun(context, results)
}

function scenarioRun(domain: 'funding' | 'procurement', scenario: 'standard' | 'partial' | 'failure' | 'blocked' | 'empty') {
  const context = beginRun({ domain, scenario })
  const results = COMPANIES.map((companyId) => runCompany(context, companyId))
  return finishRun(context, results)
}

test('beginRun returns a frozen context with a sequential run id and the fixture constants', () => {
  discoveryFixtureStore.reset()
  const context = beginRun({ domain: 'funding' })
  assert.ok(Object.isFrozen(context))
  assert.match(context.runId, /^RUN-G-\d{4}$/)
  assert.equal(context.runId, 'RUN-G-0001')
  assert.equal(context.domain, 'funding')
  assert.equal(context.scenario, 'standard')
  assert.equal(context.requestedAt, DISCOVERY_FIXTURE_REQUESTED_AT)

  const next = beginRun({ domain: 'procurement', requestedAt: '2026-10-08T00:00:00.000Z' })
  assert.equal(next.runId, 'RUN-G-0002')
  assert.equal(next.requestedAt, '2026-10-08T00:00:00.000Z')
  assert.equal(discoveryFixtureStore.history().length, 0, 'beginRun alone does not create history')
})

test('beginRun rejects an unknown domain or scenario', () => {
  assert.throws(() => beginRun({ domain: 'dating' as 'funding' }), /invalid discovery domain/)
  assert.throws(() => beginRun({ domain: 'funding', scenario: 'async' as 'standard' }), /invalid fixture scenario/)
})

test('runCompany is per-company and runs the real orchestrator against the funding fixture', () => {
  discoveryFixtureStore.reset()
  const context = beginRun({ domain: 'funding' })
  const company = runCompany(context, 'COMP-001')

  assert.ok(Object.isFrozen(company))
  assert.equal(company.companyId, 'COMP-001')
  assert.equal(company.domain, 'funding')
  assert.match(company.runId, /^RUN-G-\d{4}-COMP-001$/)
  assert.equal(company.requestedAt, DISCOVERY_FIXTURE_REQUESTED_AT)
  assert.equal(company.completedAt, company.requestedAt)
  assert.equal(company.outcome, 'SUCCESS')
  assert.equal(company.counts.candidatesCreated, 1)
  assert.equal(company.counts.totalSources, 1)
  assert.equal(company.counts.blockedSources, 0)
  assert.equal(company.counts.failedSources, 0)
  assert.equal(company.needsReview, 1, 'the normalized fixture candidate needs a human eye')
  assert.equal(company.sourceResults.length, 1)
  assert.equal(company.sourceResults[0].sourceId, FIXTURE_FUNDING_SOURCE_ID)
  assert.equal(company.candidates.length, 1)
  assert.equal(company.candidates[0].sourceTitle, 'Fixture Climate Innovation Grant Programme')
})

test('runCompany rejects blank company ids and malformed contexts', () => {
  discoveryFixtureStore.reset()
  const context = beginRun({ domain: 'funding' })
  assert.throws(() => runCompany(context, '   '), /company id must not be blank/)
  assert.throws(
    () => runCompany({ ...context, domain: 'dating' as 'funding' }, 'COMP-001'),
    /invalid discovery domain/,
  )
})

test('a standard Grants run across three companies sums to the real fixture numbers', () => {
  discoveryFixtureStore.reset()
  const run = standardRun('funding')

  assert.match(run.runId, /^RUN-G-\d{4}$/)
  assert.equal(run.domain, 'funding')
  assert.equal(run.scenario, 'standard')
  assert.equal(run.completedAt, run.requestedAt)
  assert.equal(run.outcome, 'SUCCESS')
  assert.deepEqual(run.companyIds, COMPANIES)
  assert.equal(run.companies.length, 3)

  assert.equal(run.counts.totalSources, 3)
  assert.equal(run.counts.candidatesReceived, 3)
  assert.equal(run.counts.candidatesCreated, 3, 'one finding per company')
  assert.equal(run.counts.candidatesRequiringReview, 0, 'the fixture classifier approves these grants')
  assert.equal(run.counts.duplicates, 0)
  assert.equal(run.counts.blockedSources, 0)
  assert.equal(run.counts.failedSources, 0)

  // Each company's finding becomes one review item needing a human eye.
  assert.equal(run.needsReview, 3)
  assert.deepEqual(run.companies.map((company) => company.needsReview), [1, 1, 1])
  assert.equal(run.reviewQueue.length, 3)
  for (const item of run.reviewQueue) {
    assert.equal(item.reviewStatus, 'NEEDS_REVIEW')
    assert.equal(item.sourceTitle, 'Fixture Climate Innovation Grant Programme')
    assert.ok(item.reviewId.startsWith('RI:DC:SU-FX-002:'))
  }
  assert.equal(new Set(run.reviewQueue.map((item) => item.reviewId)).size, 3, 'review ids stay unique')

  for (const company of run.companies) {
    assert.equal(company.outcome, 'SUCCESS')
    assert.equal(company.counts.candidatesCreated, 1)
    assert.equal(company.candidates[0].domain, 'funding')
  }
  assert.ok(Object.isFrozen(run))
  assert.ok(Object.isFrozen(run.reviewQueue))
})

test('a standard RFP run discovers two RFP listings per company, one review item each', () => {
  const run = standardRun('procurement')

  assert.equal(run.outcome, 'SUCCESS')
  assert.equal(run.counts.totalSources, 3)
  assert.equal(run.counts.candidatesCreated, 6, 'two findings per company')
  assert.equal(run.needsReview, 6)
  assert.deepEqual(run.companies.map((company) => company.needsReview), [2, 2, 2])
  assert.equal(run.reviewQueue.length, 6)
  assert.ok(run.reviewQueue.every((item) => item.reviewStatus === 'NEEDS_REVIEW'))
  assert.ok(run.reviewQueue.every((item) => item.domain === 'procurement'))
  for (const company of run.companies) {
    assert.equal(company.outcome, 'SUCCESS')
    assert.equal(company.counts.candidatesCreated, 2)
  }
})

test('Grants and RFPs are separated: a Grants run never surfaces an RFP listing', () => {
  const grants = standardRun('funding')

  for (const company of grants.companies) {
    for (const result of company.sourceResults) {
      assert.equal(result.domain, 'funding')
      assert.equal(result.sourceId, FIXTURE_FUNDING_SOURCE_ID)
    }
    for (const candidate of company.candidates) assert.equal(candidate.domain, 'funding')
  }
  for (const item of grants.reviewQueue) assert.equal(item.domain, 'funding')
  assert.ok(!grants.reviewQueue.some((item) => item.sourceTitle.includes('Framework Agreement')))

  const rfbs = standardRun('procurement')
  for (const company of rfbs.companies) {
    for (const result of company.sourceResults) {
      assert.equal(result.domain, 'procurement')
      assert.equal(result.sourceId, FIXTURE_PROCUREMENT_SOURCE_ID)
    }
    for (const candidate of company.candidates) assert.equal(candidate.domain, 'procurement')
  }
  for (const item of rfbs.reviewQueue) assert.equal(item.domain, 'procurement')
  assert.ok(!rfbs.reviewQueue.some((item) => item.sourceTitle.includes('Climate Innovation')))
})

test('the failure scenario fails every source and hands nothing to review', () => {
  const run = scenarioRun('funding', 'failure')

  assert.equal(run.outcome, 'FAILED')
  assert.equal(run.counts.candidatesCreated, 0)
  assert.equal(run.counts.failedSources, 3)
  assert.equal(run.counts.blockedSources, 0)
  assert.equal(run.needsReview, 0)
  assert.equal(run.reviewQueue.length, 0)
  for (const company of run.companies) {
    assert.equal(company.outcome, 'FAILED')
    assert.equal(company.candidates.length, 0)
    assert.ok(company.sourceResults[0].errors.some((error) => error.includes('adapter_error')))
  }
})

test('the blocked scenario blocks the AVAILABLE fixture source for want of an adapter', () => {
  const run = scenarioRun('procurement', 'blocked')

  assert.equal(run.outcome, 'BLOCKED')
  assert.equal(run.counts.candidatesCreated, 0)
  assert.equal(run.counts.blockedSources, 3)
  assert.equal(run.counts.failedSources, 0)
  assert.equal(run.needsReview, 0)
  for (const company of run.companies) {
    assert.equal(company.outcome, 'BLOCKED')
    assert.ok(
      company.sourceResults[0].errors.some((error) => error.includes('adapter_not_available')),
      'the real orchestrator reports the missing binding',
    )
  }
})

test('the partial scenario is PARTIAL, keeps its findings, and reports the item error', () => {
  const run = scenarioRun('funding', 'partial')

  assert.equal(run.outcome, 'PARTIAL')
  assert.equal(run.counts.candidatesCreated, 3)
  assert.equal(run.needsReview, 3)
  assert.equal(run.counts.blockedSources, 0)
  assert.equal(run.counts.failedSources, 0)
  assert.ok(run.reviewQueue.every((item) => item.sourceTitle === 'Fixture Climate Innovation Grant Programme'))
  for (const company of run.companies) {
    assert.equal(company.outcome, 'PARTIAL')
    assert.equal(company.needsReview, 1)
    assert.ok(company.sourceResults[0].errors.some((error) => error.includes('item_error')))
  }
})

test('the empty scenario reports NO_RESULTS with no review handoff', () => {
  const run = scenarioRun('procurement', 'empty')

  assert.equal(run.outcome, 'NO_RESULTS')
  assert.equal(run.counts.candidatesCreated, 0)
  assert.equal(run.needsReview, 0)
  assert.equal(run.reviewQueue.length, 0)
  for (const company of run.companies) assert.equal(company.outcome, 'NO_RESULTS')
})

test('finishRun validates that every company belongs to the run', () => {
  discoveryFixtureStore.reset()
  const context = beginRun({ domain: 'funding' })
  const company = runCompany(context, 'COMP-001')

  assert.throws(() => finishRun(context, []), /at least one company result/)

  const foreign = runCompany(beginRun({ domain: 'procurement' }), 'COMP-002')
  assert.throws(() => finishRun(context, [company, foreign]), /run domain mismatch/)

  const wrongRun = runCompany(beginRun({ domain: 'funding' }), 'COMP-003')
  assert.throws(() => finishRun(context, [company, wrongRun]), /does not belong/)

  const doctored = runCompany(context, 'COMP-001')
  const shadowed = { ...doctored, requestedAt: '2026-10-08T00:00:00.000Z' }
  assert.throws(() => finishRun(context, [shadowed]), /unexpected timestamps/)
})

test('history records completed runs and reset restores a clean store', () => {
  discoveryFixtureStore.reset()
  assert.equal(discoveryFixtureStore.history().length, 0)
  assert.ok(Object.isFrozen(discoveryFixtureStore.history()))

  const first = standardRun('funding')
  assert.equal(discoveryFixtureStore.history().length, 1)
  assert.equal(discoveryFixtureStore.history()[0].runId, first.runId)

  const second = standardRun('procurement', ['COMP-001'])
  assert.equal(second.runId, 'RUN-G-0002')
  assert.equal(discoveryFixtureStore.history().length, 2)
  assert.equal(discoveryFixtureStore.history()[1].runId, second.runId)
  assert.ok(Object.isFrozen(discoveryFixtureStore.history()))

  discoveryFixtureStore.reset()
  assert.equal(discoveryFixtureStore.history().length, 0)
  const restarted = beginRun({ domain: 'funding' })
  assert.equal(restarted.runId, 'RUN-G-0001', 'reset restarts the run counter')
})

test('runs are deterministic: the same selection yields the identical outcome', () => {
  discoveryFixtureStore.reset()
  const first = standardRun('procurement')
  discoveryFixtureStore.reset()
  const second = standardRun('procurement')
  assert.deepEqual(second, first)
})

test('beginRun defaults the Phase H filters and freezes the normalized context', () => {
  discoveryFixtureStore.reset()
  const context = beginRun({ domain: 'funding' })
  assert.equal(context.sector, 'all')
  assert.equal(context.keyword, '')
  assert.equal(context.location, 'all')
  assert.ok(Object.isFrozen(context))
})

test('beginRun normalizes the keyword and rejects unknown filters', () => {
  discoveryFixtureStore.reset()
  const context = beginRun({ domain: 'procurement', sector: 'infrastructure', keyword: '  Bridge ', location: 'usa' })
  assert.equal(context.sector, 'infrastructure')
  assert.equal(context.keyword, 'bridge', 'the keyword is trimmed and lowercased')
  assert.equal(context.location, 'usa')

  assert.throws(() => beginRun({ domain: 'funding', sector: 'space' as 'all' }), /invalid discovery sector/)
  assert.throws(() => beginRun({ domain: 'funding', location: 'mars' as 'all' }), /invalid discovery location/)
  assert.throws(() => beginRun({ domain: 'funding', keyword: 42 as unknown as string }), /keyword must be a string/)
})

test('sector and location are recorded on the run but do not filter fixture candidates', () => {
  discoveryFixtureStore.reset()
  const context = beginRun({ domain: 'funding', sector: 'infrastructure', location: 'usa' })
  const results = COMPANIES.map((companyId) => runCompany(context, companyId))
  const run = finishRun(context, results)

  assert.equal(run.sector, 'infrastructure')
  assert.equal(run.location, 'usa')
  assert.equal(run.keyword, '')
  assert.equal(run.counts.candidatesCreated, 3, 'no fixture narrowing: the engine numbers stand')
  assert.equal(run.needsReview, 3)
  assert.equal(run.reviewQueue.length, 3)
})

test('a matching keyword keeps the exact fixture findings; a miss hands nothing over', () => {
  discoveryFixtureStore.reset()
  const matched = beginRun({ domain: 'funding', keyword: 'grant' })
  const matchedRun = finishRun(
    matched,
    COMPANIES.map((companyId) => runCompany(matched, companyId)),
  )
  assert.equal(matchedRun.keyword, 'grant')
  assert.equal(matchedRun.counts.candidatesCreated, 3)
  assert.equal(matchedRun.needsReview, 3)
  assert.equal(matchedRun.reviewQueue.length, 3)

  discoveryFixtureStore.reset()
  const missed = beginRun({ domain: 'funding', keyword: 'bridge' })
  const missedRun = finishRun(
    missed,
    COMPANIES.map((companyId) => runCompany(missed, companyId)),
  )
  assert.equal(missedRun.outcome, 'SUCCESS', 'the sources still succeeded; the filter matched nothing')
  assert.equal(missedRun.counts.candidatesCreated, 3, 'engine counts stay source truth')
  assert.equal(missedRun.needsReview, 0)
  assert.equal(missedRun.reviewQueue.length, 0)
  assert.ok(missedRun.companies.every((company) => company.candidates.length === 0))
})

test('keyword matching is exact and case-insensitive, with no stemming', () => {
  discoveryFixtureStore.reset()
  const upper = beginRun({ domain: 'funding', keyword: 'GRANT' })
  assert.equal(upper.keyword, 'grant')
  const upperRun = finishRun(
    upper,
    COMPANIES.map((companyId) => runCompany(upper, companyId)),
  )
  assert.equal(upperRun.needsReview, 3, 'case does not matter')

  discoveryFixtureStore.reset()
  const plural = beginRun({ domain: 'funding', keyword: 'grants' })
  const pluralRun = finishRun(
    plural,
    COMPANIES.map((companyId) => runCompany(plural, companyId)),
  )
  assert.equal(pluralRun.needsReview, 0, 'no stemming: "grants" is not in "Grant Programme"')
})

test('a blank keyword means no keyword filter', () => {
  discoveryFixtureStore.reset()
  const context = beginRun({ domain: 'procurement', keyword: '   ' })
  assert.equal(context.keyword, '')
  const run = finishRun(
    context,
    COMPANIES.map((companyId) => runCompany(context, companyId)),
  )
  assert.equal(run.counts.candidatesCreated, 6)
  assert.equal(run.needsReview, 6)
})