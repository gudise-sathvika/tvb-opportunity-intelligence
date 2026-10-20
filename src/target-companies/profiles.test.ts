import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseTargetCompanyCsv } from './csv'
import { csvPreviewToTargetCompanies } from './profiles'
import { recommendOpportunitiesForTargetCompanies } from './recommendations'

test('CSV preview converts to target-company profiles without inventing missing values', () => {
  const csv = [
    'company name,company URL,company HQ location,company sector,Ideal Customer Profile',
    'ContextQA,https://contextai.us/,"Austin, US",AI Infrastructure,',
    'Growth Channel,,,,',
    'Mask NextGen,https://www.masknextgen.com/,"Austin, US","product, EdTec, Cyber Security,  Al",',
    'Pacewisdom,http://www.pacewisdom.com/,"Bangalore, India","Software Services, AI",',
    'flareAI,https://flareai.co/,"Austin, US","product, lead generation",',
  ].join('\n')
  const companies = csvPreviewToTargetCompanies(parseTargetCompanyCsv(csv))
  assert.equal(companies.length, 5)
  assert.equal(companies[1].name, 'Growth Channel')
  assert.equal(companies[1].sector, null)
  assert.equal(companies[1].country, null)
})

test('recommendations evaluate each company and opportunity independently', () => {
  const csv = [
    'company name,company sector',
    'Acme EdTech,education technology',
    'Beta Construction,bridge construction',
    'Gamma,ai',
    'Delta,software',
    'Epsilon,cloud',
  ].join('\n')
  const companies = csvPreviewToTargetCompanies(parseTargetCompanyCsv(csv))
  const results = recommendOpportunitiesForTargetCompanies(companies, [
    { opportunityId: 'O1', opportunityType: 'procurement', title: 'Bridge construction tender', description: 'bridge construction', sourceUrl: 'https://example.org/o1' },
  ])
  assert.equal(results.length, 5)
  assert.equal(results.find((r) => r.companyName === 'Beta Construction')?.outcome, 'potentially_relevant')
  assert.equal(results.find((r) => r.companyName === 'Acme EdTech')?.outcome, 'not_relevant')
})