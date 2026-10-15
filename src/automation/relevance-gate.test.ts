/**
 * Phase 29 relevance-gate tests — fully offline, synthetic engine verdicts.
 *
 * Every assertion guards honesty: country-only never verifies relevance,
 * contradictions win, unknown stays unknown, and non-actionable stays
 * non-actionable regardless of evaluation.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyRelevance } from './relevance-gate'

function input(overrides = {}) {
  return {
    engineStatus: 'PROPOSED',
    matchedSignals: ['country-compatibility'],
    mismatchedSignals: [],
    opportunityEligibility: 'open',
    ...overrides,
  } as const
}

test('country compatibility alone is relevance-unverified, never supported', () => {
  const result = classifyRelevance(input())
  assert.equal(result.outcome, 'country_compatible_relevance_unverified')
  assert.ok(result.reason.includes('unknown'))
})

test('country mismatch contradicts regardless of other positives', () => {
  const result = classifyRelevance(
    input({ engineStatus: 'PROPOSED', matchedSignals: ['country-compatibility', 'keyword-overlap'], mismatchedSignals: ['industry-overlap'] }),
  )
  assert.equal(result.outcome, 'relevance_contradicted')
})

test('missing applicant eligibility stays unknown and never blocks honesty', () => {
  const result = classifyRelevance(input())
  assert.ok(!result.reason.includes('eligible'))
  assert.ok(result.reason.includes('applicant eligibility remain unknown') || result.reason.includes('unknown'))
})

test('incomparable classifications cannot support relevance', () => {
  // SIC-vs-CPV style: no comparable signal matched, so even a PROPOSED engine
  // verdict (country-only) stays unverified.
  const result = classifyRelevance(input({ matchedSignals: ['country-compatibility'] }))
  assert.notEqual(result.outcome, 'relevance_supported')
})

test('a real supported comparable signal is recognized when present', () => {
  const result = classifyRelevance(
    input({ matchedSignals: ['country-compatibility', 'industry-overlap'] }),
  )
  assert.equal(result.outcome, 'relevance_supported')
})

test('non-actionable opportunities stay non-actionable', () => {
  for (const eligibility of ['closed', 'expired', 'historical', 'unknown', 'forthcoming']) {
    const result = classifyRelevance(input({ opportunityEligibility: eligibility }))
    assert.equal(result.outcome, 'not_actionable', eligibility)
  }
})

test('original engine verdicts pass through untouched alongside the gate', () => {
  const gate = classifyRelevance(input())
  assert.equal(gate.version, 'relevance-gate-1')
  // The gate carries no engine fields and mutates nothing: inputs are literals.
  assert.deepEqual(Object.keys(gate).sort(), ['outcome', 'reason', 'version'])
})

test('independent classification per company for the same opportunity', () => {
  const forUs = classifyRelevance(input({ matchedSignals: ['country-compatibility'] }))
  const forOther = classifyRelevance(
    input({ engineStatus: 'NOT_A_MATCH', matchedSignals: [], mismatchedSignals: ['country-compatibility'] }),
  )
  assert.equal(forUs.outcome, 'country_compatible_relevance_unverified')
  assert.equal(forOther.outcome, 'relevance_contradicted')
})
