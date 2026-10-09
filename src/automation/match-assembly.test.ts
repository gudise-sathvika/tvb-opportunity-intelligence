/**
 * Phase 25 tests: guarded match assembly. Only real, traceable, open inputs
 * produce proposals; everything else is refused with a reason; missing evidence
 * stays missing and never becomes a match.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assembleMatchProposals, type VerifiedOpportunityRecord } from './match-assembly'
import type { VerifiedCompanyProfile } from './company-profile'
import type { MatchSourceRecord } from './match-proposal'

const OPEN_OPPORTUNITY: MatchSourceRecord = {
  recordId: 'OPP-900',
  recordType: 'opportunity',
  name: 'Solar Irrigation Grant',
  country: 'India',
  industries: ['Renewable energy'],
  description: 'Solar pumping for smallholder farmers.',
}

const COMPANY: VerifiedCompanyProfile = {
  companyId: 'COMP-900',
  name: 'Real Solar Pty Ltd',
  country: 'India',
  industry: ['Renewable energy'],
  businessDescription: 'Solar pumping systems for smallholder farmers.',
  technologyFocus: ['Solar photovoltaic pumping'],
  provenance: { source: 'https://example.invalid/COMP-900', verifiedAt: '2026-10-01', status: 'verified' },
}

const PROVENANCE = { source: 'https://example.invalid/OPP-900', verifiedAt: '2026-10-01', status: 'verified' } as const

function opportunity(overrides: Partial<VerifiedOpportunityRecord> = {}): VerifiedOpportunityRecord {
  return { record: OPEN_OPPORTUNITY, provenance: { ...PROVENANCE }, eligibility: 'open', ...overrides }
}

test('empty inputs produce no proposals and no fabrications', () => {
  const result = assembleMatchProposals({ companies: [], opportunities: [] })
  assert.deepEqual(result.proposals, [])
  assert.deepEqual(result.skippedCompanies, [])
  assert.deepEqual(result.skippedOpportunities, [])
})

test('a verified open opportunity and verified company produce exactly one proposal', () => {
  const result = assembleMatchProposals({ companies: [COMPANY], opportunities: [opportunity()] })
  assert.equal(result.proposals.length, 1)
  const proposal = result.proposals[0]
  assert.equal(proposal.sourceRecordId, 'OPP-900')
  assert.equal(proposal.companyId, 'COMP-900')
  assert.equal(proposal.status, 'PROPOSED')
  assert.deepEqual([...proposal.matchedSignals].sort(), ['country-compatibility', 'industry-overlap', 'keyword-overlap'])
  assert.deepEqual(result.skippedCompanies, [])
  assert.deepEqual(result.skippedOpportunities, [])
})

test('a non-open opportunity is refused, never matched', () => {
  for (const eligibility of ['forthcoming', 'expired', 'closed', 'historical', 'unknown'] as const) {
    const result = assembleMatchProposals({
      companies: [COMPANY],
      opportunities: [opportunity({ eligibility })],
    })
    assert.deepEqual(result.proposals, [])
    assert.equal(result.skippedOpportunities.length, 1)
    assert.match(result.skippedOpportunities[0].reason, /not open/)
  }
})

test('unverified provenance on either side is refused with a reason', () => {
  const unverifiedOpp = assembleMatchProposals({
    companies: [COMPANY],
    opportunities: [opportunity({ provenance: { ...PROVENANCE, status: 'unverified' } })],
  })
  assert.deepEqual(unverifiedOpp.proposals, [])
  assert.match(unverifiedOpp.skippedOpportunities[0].reason, /no verified provenance/)

  const noProvCompany = { ...COMPANY, provenance: { source: '', verifiedAt: '', status: 'verified' as const } }
  const unverifiedCompany = assembleMatchProposals({
    companies: [noProvCompany],
    opportunities: [opportunity()],
  })
  assert.deepEqual(unverifiedCompany.proposals, [])
  assert.equal(unverifiedCompany.skippedCompanies.length, 1)
})

test('missing evidence stays missing and cannot become a match', () => {
  const sparseCompany: VerifiedCompanyProfile = {
    companyId: 'COMP-901',
    name: 'Sparse Co',
    provenance: { source: 'COMP-901', verifiedAt: '2026-10-02', status: 'verified' },
  }
  const result = assembleMatchProposals({ companies: [sparseCompany], opportunities: [opportunity()] })
  assert.equal(result.proposals.length, 1)
  const proposal = result.proposals[0]
  assert.equal(proposal.status, 'INSUFFICIENT_EVIDENCE', 'nothing matched, so not proposed')
  assert.equal(proposal.matchedSignals.length, 0)
  assert.equal(proposal.missingSignals.length, 3)
  for (const evidence of proposal.evidence) {
    assert.equal(evidence.outcome, 'missing')
  }
})

test('assembly is deterministic', () => {
  const first = assembleMatchProposals({ companies: [COMPANY], opportunities: [opportunity()] })
  const second = assembleMatchProposals({ companies: [COMPANY], opportunities: [opportunity()] })
  assert.equal(first.proposals[0].proposalId, second.proposals[0].proposalId)
})
