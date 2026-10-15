/**
 * Phase 10 proposal explanation tests — fully offline, synthetic proposals.
 *
 * Rules under test: explanations categorize without deciding, provenance is
 * passed through or null (never invented), the disclaimer denies eligibility
 * inference, and explaining never mutates the proposal.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ELIGIBILITY_DISCLAIMER, explainProposal } from './proposal-explanation'
import type { ExplainableProposal } from './proposal-explanation'

function proposal(overrides: Partial<ExplainableProposal> = {}): ExplainableProposal {
  return {
    proposalId: 'MP:MATCH-RULES-v1:357305:LEI-X',
    ruleVersion: 'MATCH-RULES-v1',
    status: 'PROPOSED',
    matchedSignals: ['country-compatibility'],
    missingSignals: ['industry-overlap', 'keyword-overlap'],
    evidence: [
      { signal: 'country-compatibility', outcome: 'matched', values: ['united states'], note: '' },
      { signal: 'industry-overlap', outcome: 'missing', values: [], note: 'company industry unavailable' },
      { signal: 'keyword-overlap', outcome: 'missing', values: [], note: 'company has no comparable text' },
    ],
    ...overrides,
  }
}

test('evidence splits into supporting, contradictory, missing, and unverified', () => {
  const explanation = explainProposal(proposal(), {
    companyProvenance: { source: 'https://api.gleif.org/api/v1/lei-records/X', verifiedAt: '2026-10-14' },
  })
  assert.deepEqual(explanation.supporting.map((entry) => entry.signal), ['country-compatibility'])
  assert.deepEqual(explanation.contradictory, [])
  assert.deepEqual(explanation.missing.map((entry) => entry.signal), ['industry-overlap', 'keyword-overlap'])
  assert.equal(explanation.unverified.length, 1)
  assert.equal(explanation.unverified[0].signal, 'industry-overlap')
  assert.ok(explanation.unverified[0].detail.includes('company publishes no evidenced industry'))
  assert.deepEqual(explanation.companyProvenance, {
    source: 'https://api.gleif.org/api/v1/lei-records/X',
    verifiedAt: '2026-10-14',
  })
  assert.equal(explanation.opportunityProvenance, null)
})

test('mismatches surface as contradictory with the responsible rule', () => {
  const explanation = explainProposal(
    proposal({
      status: 'NOT_A_MATCH',
      matchedSignals: [],
      evidence: [
        { signal: 'country-compatibility', outcome: 'mismatched', values: ['united states', 'united kingdom'], note: '' },
      ],
    }),
  )
  assert.deepEqual(explanation.contradictory.map((entry) => entry.signal), ['country-compatibility'])
  assert.ok(explanation.ruleNote.includes('explicit incompatibility'))
})

test('provenance is never invented and proposals are never mutated', () => {
  const input = proposal()
  const snapshot = JSON.parse(JSON.stringify(input))
  const explanation = explainProposal(input)
  assert.deepEqual(JSON.parse(JSON.stringify(input)), snapshot)
  assert.equal(explanation.companyProvenance, null)
  assert.equal(explanation.opportunityProvenance, null)
  assert.equal(explanation.eligibilityDisclaimer, ELIGIBILITY_DISCLAIMER)
  assert.ok(ELIGIBILITY_DISCLAIMER.includes('none establishes eligibility'))
})

test('evidenced industry on both sides removes the unverified flag', () => {
  const explanation = explainProposal(proposal(), {
    companyIndustryEvidenced: true,
    opportunityIndustryEvidenced: true,
  })
  assert.deepEqual(explanation.unverified, [])
})
