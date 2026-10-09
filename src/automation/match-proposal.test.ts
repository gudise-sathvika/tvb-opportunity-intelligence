/**
 * Phase L company-matching proposal engine tests (MATCH-RULES-v1).
 *
 * Company inputs mirror the real Vault company universe field-for-field
 * (02 - Companies/COMP-001..003, values copied verbatim, no Vault import and
 * no new Vault record — the automation layer stays data-free). Proposal inputs
 * mirror Phase K payload shapes. Proofs: sector/country/keyword signals with
 * field-level evidence, missing-data honesty, NOT_A_MATCH vs
 * INSUFFICIENT_EVIDENCE, deterministic ids and repeats, no scores, no Match
 * records, no I/O (the last via the boundary scan + Vault manifest).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { MatchCompanyRecord, MatchSourceRecord } from './match-proposal'
import { MATCH_RULES_VERSION, proposeMatch, proposeMatches } from './match-proposal'

/* Real COMP-001 values: India; Agricultural technology / Renewable energy /
 * Manufacturing; business_description + technology/project focus +
 * certifications flattened into capabilities. */
const AGRISOLAR: MatchCompanyRecord = {
  companyId: 'COMP-001',
  name: 'DEMO — AgriSolar Systems Private Limited',
  country: 'India',
  industries: ['Agricultural technology', 'Renewable energy', 'Manufacturing'],
  description:
    'FICTIONAL DEMONSTRATION PROFILE. AgriSolar is an invented company. It designs and manufactures small solar-powered irrigation pumping units and cold-storage enclosures for smallholder farmers, and services them through regional technicians. Every figure on this record is illustrative and fabricated. This is not a real company, not a real client of TVB, and not based on any actual business.',
  capabilities: [
    'Solar photovoltaic pumping systems',
    'IoT remote monitoring',
    'Cold-chain storage enclosures',
    'Decentralised rural electrification',
    'Farmer cold-chain infrastructure',
    'Water-efficient irrigation',
    'Udyam registration (illustrative, fictional)',
    'ISO 9001 (illustrative, fictional)',
  ],
}

/* Real COMP-002 values: USA; Industrial automation / Robotics / Advanced
 * manufacturing; business_description + focus lists flattened. */
const NORTHFIELD: MatchCompanyRecord = {
  companyId: 'COMP-002',
  name: 'DEMO — Northfield Robotics Inc',
  country: 'USA',
  industries: ['Industrial automation', 'Robotics', 'Advanced manufacturing'],
  description:
    'FICTIONAL DEMONSTRATION PROFILE. Northfield is an invented company. It designs and integrates robotic inspection and material-handling systems for automotive and aerospace component manufacturers, with a service arm supplying replacement grippers and vision hardware. Every figure on this record is illustrative and fabricated. This is not a real company, not a real client of TVB, and not based on any actual business.',
  capabilities: [
    'Computer vision inspection',
    'Collaborative robotics',
    'Industrial control software',
    'Automated quality inspection',
    'Warehouse automation',
    'Aerospace component inspection',
  ],
}

const TENDER_US_TECH: MatchSourceRecord = {
  recordId: 'RFB-T6',
  recordType: 'notice',
  name: 'Q',
  country: 'USA',
  industries: ['Technology'],
  description: null,
}

test('sector overlap creates the industry signal with field-level evidence', () => {
  const proposal = proposeMatch(
    { recordId: 'OPP-T1', recordType: 'opportunity', name: 'Q', industries: ['Robotics'] },
    { companyId: 'C-T1', industries: ['robotics ', 'Automation'] },
  )
  assert.equal(proposal.status, 'PROPOSED')
  assert.deepEqual(proposal.matchedSignals, ['industry-overlap'])
  const evidence = proposal.evidence.find((entry) => entry.signal === 'industry-overlap')
  assert.equal(evidence?.outcome, 'matched')
  assert.equal(evidence?.sourceField, 'industry')
  assert.equal(evidence?.companyField, 'industry')
  assert.deepEqual(evidence?.values, ['robotics'], 'normalized, whitespace-tolerant, exact')
})

test('country compatibility is represented with the normalized value', () => {
  const proposal = proposeMatch(
    { recordId: 'OPP-T2', recordType: 'opportunity', name: 'Q', country: 'India' },
    { companyId: 'C-T2', country: ' india ' },
  )
  assert.equal(proposal.status, 'PROPOSED')
  assert.deepEqual(proposal.matchedSignals, ['country-compatibility'])
  const evidence = proposal.evidence.find((entry) => entry.signal === 'country-compatibility')
  assert.deepEqual(evidence?.values, ['india'])
})

test('keyword overlap is deterministic and case-insensitive', () => {
  const source: MatchSourceRecord = { recordId: 'OPP-T3', recordType: 'opportunity', name: 'Solar water pumps' }
  const company: MatchCompanyRecord = { companyId: 'C-T3', description: 'Designs SOLAR pumping units for farms.' }
  const first = proposeMatch(source, company)
  const second = proposeMatch(source, company)
  assert.equal(first.status, 'PROPOSED')
  assert.deepEqual(first.matchedSignals, ['keyword-overlap'])
  const evidence = first.evidence.find((entry) => entry.signal === 'keyword-overlap')
  assert.deepEqual(evidence?.values, ['solar'])
  assert.equal(evidence?.sourceField, 'name/description')
  assert.equal(evidence?.companyField, 'description/capabilities')
  assert.deepEqual(second.evidence, first.evidence, 'identical inputs, identical evidence')
})

test('missing company data becomes missing evidence, never an assumed match', () => {
  const proposal = proposeMatch(
    {
      recordId: 'OPP-T4',
      recordType: 'opportunity',
      name: 'Solar water pumps',
      country: 'India',
      industries: ['Energy'],
    },
    { companyId: 'C-T4' },
  )
  assert.equal(proposal.status, 'INSUFFICIENT_EVIDENCE')
  assert.deepEqual(proposal.matchedSignals, [])
  assert.deepEqual(proposal.missingSignals, ['industry-overlap', 'country-compatibility', 'keyword-overlap'])
  const notes = Object.fromEntries(proposal.evidence.map((entry) => [entry.signal, entry.note]))
  assert.equal(notes['industry-overlap'], 'company industry unavailable')
  assert.equal(notes['country-compatibility'], 'company country unavailable')
  assert.equal(notes['keyword-overlap'], 'company has no comparable text')
})

test('missing proposal data becomes missing evidence', () => {
  const proposal = proposeMatch(
    { recordId: 'OPP-T5', recordType: 'opportunity', name: 'X' },
    AGRISOLAR,
  )
  assert.equal(proposal.status, 'INSUFFICIENT_EVIDENCE')
  const notes = Object.fromEntries(proposal.evidence.map((entry) => [entry.signal, entry.note]))
  assert.equal(notes['industry-overlap'], 'proposal industry unavailable')
  assert.equal(notes['country-compatibility'], 'proposal country unavailable')
  assert.equal(notes['keyword-overlap'], 'proposal has no comparable text')
})

test('incompatible evidence with nothing matched produces NOT_A_MATCH', () => {
  const proposal = proposeMatch(TENDER_US_TECH, AGRISOLAR)
  assert.equal(proposal.status, 'NOT_A_MATCH')
  assert.deepEqual(proposal.matchedSignals, [])
  const industry = proposal.evidence.find((entry) => entry.signal === 'industry-overlap')
  assert.equal(industry?.outcome, 'mismatched')
  assert.ok((industry?.values.length ?? 0) > 0, 'the compared values stay visible')
  const country = proposal.evidence.find((entry) => entry.signal === 'country-compatibility')
  assert.equal(country?.outcome, 'mismatched')
  assert.deepEqual(country?.values, ['india', 'usa'])
})

test('sparse inputs produce INSUFFICIENT_EVIDENCE, not a guess', () => {
  const proposal = proposeMatch(
    { recordId: 'OPP-T7', recordType: 'opportunity', name: 'X' },
    { companyId: 'C-T7' },
  )
  assert.equal(proposal.status, 'INSUFFICIENT_EVIDENCE')
  assert.deepEqual(proposal.matchedSignals, [])
})

test('real universe pairs evaluate transparently end to end', () => {
  const usTender: MatchSourceRecord = {
    recordId: 'RFB-101',
    recordType: 'notice',
    name: 'Fixture IT Equipment Supply Tender (Year 1)',
    country: 'USA',
    industries: ['Technology'],
    description: 'A deterministic local fixture listing. Not a real request for bids.',
  }
  const [forNorthfield, forAgrisolar] = proposeMatches(usTender, [NORTHFIELD, AGRISOLAR])
  assert.deepEqual(
    proposeMatches(usTender, [NORTHFIELD, AGRISOLAR]).map((p) => p.companyId),
    ['COMP-002', 'COMP-001'],
    'input order preserved',
  )
  assert.equal(forNorthfield.status, 'PROPOSED', 'USA country match carries it')
  assert.deepEqual(forNorthfield.matchedSignals, ['country-compatibility'])
  assert.equal(forAgrisolar.status, 'NOT_A_MATCH', 'India vs USA with disjoint industries')
})

test('proposal ids are deterministic and carry the rule version', () => {
  const first = proposeMatch(TENDER_US_TECH, AGRISOLAR)
  const second = proposeMatch(TENDER_US_TECH, AGRISOLAR)
  assert.equal(first.proposalId, 'MP:MATCH-RULES-v1:RFB-T6:COMP-001')
  assert.equal(second.proposalId, first.proposalId)
  assert.equal(first.ruleVersion, MATCH_RULES_VERSION)
  assert.equal(first.sourceRecordId, 'RFB-T6')
  assert.equal(first.sourceRecordType, 'notice')
  assert.equal(first.companyId, 'COMP-001')
  const other = proposeMatch(TENDER_US_TECH, NORTHFIELD)
  assert.notEqual(other.proposalId, first.proposalId)
})

test('repeats are byte-identical and frozen; no score or Match record exists', () => {
  const first = proposeMatch(TENDER_US_TECH, NORTHFIELD)
  const second = proposeMatch(TENDER_US_TECH, NORTHFIELD)
  assert.deepEqual(second, first)
  assert.ok(Object.isFrozen(first))
  assert.ok(Object.isFrozen(first.evidence))
  const serialized = JSON.stringify(first)
  assert.ok(!serialized.includes('"score"'), 'no numeric score anywhere in the proposal')
  assert.ok(!serialized.includes('"confidence"'), 'no confidence anywhere in the proposal')
  assert.ok(!('match_id' in first), 'a proposal is not a Match record and carries no match identity')
  assert.ok(['PROPOSED', 'INSUFFICIENT_EVIDENCE', 'NOT_A_MATCH'].includes(first.status))
})

test('malformed inputs throw instead of guessing', () => {
  assert.throws(
    () => proposeMatch({ recordId: '', recordType: 'notice' }, AGRISOLAR),
    /recordId must be a non-empty string/,
  )
  assert.throws(
    () => proposeMatch({ recordId: 'X', recordType: 'bid' as 'notice' }, AGRISOLAR),
    /unsupported source record type/,
  )
  assert.throws(
    () => proposeMatch(TENDER_US_TECH, { companyId: '' }),
    /companyId must be a non-empty string/,
  )
  assert.deepEqual(proposeMatches(TENDER_US_TECH, []), [], 'empty input yields no proposals')
})
