import assert from 'node:assert/strict'
import { test } from 'node:test'

import { evaluateTargetCompanyRelevance } from './matching'

test('shared sector terms make an opportunity relevant', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C1', name: 'Acme EdTech', sector: 'education technology', capabilities: ['learning platforms'] },
    { opportunityId: 'O1', opportunityType: 'funding', title: 'Digital learning grants', description: 'Support for education technology platforms', sourceUrl: 'https://example.org/o1' },
  )
  assert.equal(result.outcome, 'potentially_relevant')
  assert.ok(result.matchedFields.includes('sector/capabilities'))
})

test('education technology company is not matched to bridge construction', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C2', name: 'Acme EdTech', sector: 'education technology', capabilities: ['learning platforms'], country: 'US' },
    { opportunityId: 'O2', opportunityType: 'procurement', title: 'Bridge construction services', description: 'Civil engineering and bridge construction', country: 'US', sourceUrl: 'https://example.org/o2' },
  )
  assert.equal(result.outcome, 'not_relevant')
  assert.ok(result.mismatchedFields.includes('sector/capabilities'))
})

test('missing company data produces uncertainty, not fabrication', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C3', name: 'Growth Channel' },
    { opportunityId: 'O3', opportunityType: 'funding', title: 'AI infrastructure grant', description: 'Funding for AI infrastructure', sourceUrl: 'https://example.org/o3' },
  )
  assert.ok(['insufficient_evidence', 'potentially_relevant'].includes(result.outcome))
  assert.ok(result.missingFields.includes('company.sector/description/capabilities'))
  assert.ok(result.uncertainty.length > 0)
})

test('eligibility is reported separately and not assumed', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C4', name: 'Acme', sector: 'AI infrastructure', country: 'US', companyType: 'SME' },
    { opportunityId: 'O4', opportunityType: 'procurement', title: 'AI infrastructure tender', description: 'AI infrastructure services', country: 'US', applicantTypes: ['SME'], requirements: ['eligibility screening required'], sourceUrl: 'https://example.org/o4' },
  )
  assert.equal(result.outcome, 'potentially_relevant')
  assert.ok(result.matchedFields.includes('applicantType'))
  assert.ok(result.uncertainty.some((value) => /eligibility/i.test(value)))
})

test('Austin, US matches US without creating relevance by itself', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C5', name: 'Acme', country: 'Austin, US' },
    { opportunityId: 'O5', opportunityType: 'funding', title: 'Generic funding', description: 'No sector overlap', country: 'US', sourceUrl: 'https://example.org/o5' },
  )
  assert.notEqual(result.outcome, 'relevant')
  assert.ok(result.matchedFields.includes('country'))
})

test('Bangalore, India matches India', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C6', name: 'Pacewisdom', country: 'Bangalore, India', sector: 'Software Services, AI' },
    { opportunityId: 'O6', opportunityType: 'funding', title: 'Software services grant', description: 'software services', country: 'India', sourceUrl: 'https://example.org/o6' },
  )
  assert.ok(result.matchedFields.includes('country'))
})

test('generic single-term overlap is not enough for relevant', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C7', name: 'Acme', sector: 'AI Infrastructure', country: 'US' },
    { opportunityId: 'O7', opportunityType: 'funding', title: 'Infrastructure hubs', description: 'infrastructure', country: 'US', sourceUrl: 'https://example.org/o7' },
  )
  assert.notEqual(result.outcome, 'relevant')
})

test('missing location creates uncertainty', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C8', name: 'Growth Channel' },
    { opportunityId: 'O8', opportunityType: 'funding', title: 'AI infrastructure', description: 'ai infrastructure', sourceUrl: 'https://example.org/o8' },
  )
  assert.ok(result.missingFields.includes('company.country'))
})