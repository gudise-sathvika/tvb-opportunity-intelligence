/**
 * Phase Q procurement matching engine tests (PMATCH-RULES-v1).
 *
 * Real RFB-001…003 Notice values and real COMP-001…003 company values
 * (transcribed from the imported snapshot) drive the deterministic assertions:
 * sector/country/keyword/capability evidence, missing-data handling, the
 * NOT_A_MATCH and INSUFFICIENT_EVIDENCE verdicts, invalids, and determinism.
 * No scores, no I/O anywhere.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProcurementCompanyRecord, ProcurementSourceRecord } from './procurement-proposal'
import { PMATCH_RULES_VERSION, proposeProcurementMatch, proposeProcurementMatches } from './procurement-proposal'

/* Real RFB-001…003 notice values, transcribed from the snapshot. */
const ROOFTOP_SOLAR: ProcurementSourceRecord = {
  recordId: 'RFB-001',
  recordType: 'notice',
  name: 'DEMO — Rooftop Solar Installation — Works Framework',
  country: 'India',
  industries: ['Renewable energy'],
  description:
    'FICTIONAL DEMONSTRATION RECORD. Supply and installation of rooftop solar photovoltaic systems for three demonstration sites, including mounting structure, inverter, cabling, commissioning, and a two-year defect liability period. Nothing in this record describes a real tender.',
}

const WATER_QUALITY: ProcurementSourceRecord = {
  recordId: 'RFB-002',
  recordType: 'notice',
  name: 'DEMO — Water-Quality Data Analysis Services — Multi Lot',
  country: 'India',
  industries: [],
  description:
    'FICTIONAL DEMONSTRATION RECORD. Statistical analysis of a demonstration water-quality dataset across three separate lots, covering data validation, trend analysis, and reporting. Nothing in this record describes a real tender.',
}

/* Real COMP-001…003 company values, transcribed from the snapshot. */
const AGRISOLAR: ProcurementCompanyRecord = {
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

const NORTHFIELD: ProcurementCompanyRecord = {
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
    'Small Business Administration size-standard self-certification (illustrative, fictional)',
  ],
}

const SARVAJAL: ProcurementCompanyRecord = {
  companyId: 'COMP-003',
  name: 'DEMO — Sarva Jal Technologies LLP',
  country: 'India',
  industries: ['Water technology', 'Sanitation', 'Environment services'],
  description:
    'FICTIONAL DEMONSTRATION PROFILE. Sarva Jal is an invented company. It designs low-cost ceramic water filter modules for rural community water systems and provides installation and maintenance services through local partners. Every figure on this record is illustrative and fabricated. This is not a real company, not a real client of TVB, and not based on any actual business.',
  capabilities: [
    'Ceramic ultrafiltration',
    'Point-of-use water treatment',
    'Remote water quality sensing',
    'Rural drinking water supply',
    'Greywater reuse',
  ],
}

test('an RFP and company produce one deterministic proposal with an exact identity', () => {
  const first = proposeProcurementMatch(ROOFTOP_SOLAR, AGRISOLAR)
  const second = proposeProcurementMatch(ROOFTOP_SOLAR, AGRISOLAR)
  assert.deepEqual(second, first)
  assert.equal(first.proposalId, `PP:${PMATCH_RULES_VERSION}:RFB-001:COMP-001`)
  assert.equal(first.ruleVersion, PMATCH_RULES_VERSION)
  assert.equal(first.noticeId, 'RFB-001')
  assert.equal(first.companyId, 'COMP-001')
  assert.ok(Object.isFrozen(first))
  assert.ok(Object.isFrozen(first.evidence))
})

test('sector, country, keyword, and capability evidence all match on the solar case', () => {
  const p = proposeProcurementMatch(ROOFTOP_SOLAR, AGRISOLAR)
  assert.equal(p.status, 'PROPOSED')
  assert.deepEqual(p.matchedSignals, [
    'industry-overlap',
    'country-compatibility',
    'keyword-overlap',
    'capability-overlap',
  ])
  assert.deepEqual(p.missingSignals, [])
  const bySignal = Object.fromEntries(p.evidence.map((e) => [e.signal, e]))
  assert.deepEqual(bySignal['industry-overlap'], {
    signal: 'industry-overlap',
    outcome: 'matched',
    sourceField: 'industry',
    companyField: 'industry',
    values: ['renewable energy'],
    note: '',
  })
  assert.deepEqual(bySignal['country-compatibility'], {
    signal: 'country-compatibility',
    outcome: 'matched',
    sourceField: 'country',
    companyField: 'country',
    values: ['india'],
    note: '',
  })
  assert.deepEqual(bySignal['keyword-overlap'], {
    signal: 'keyword-overlap',
    outcome: 'matched',
    sourceField: 'name/description',
    companyField: 'description',
    values: ['solar'],
    note: '',
  })
  assert.deepEqual(bySignal['capability-overlap'], {
    signal: 'capability-overlap',
    outcome: 'matched',
    sourceField: 'name/description',
    companyField: 'capabilities',
    values: ['photovoltaic', 'solar'],
    note: '',
  })
})

test('country and capability evidence work on the water-quality case while industry stays missing', () => {
  const p = proposeProcurementMatch(WATER_QUALITY, SARVAJAL)
  assert.equal(p.status, 'PROPOSED')
  assert.deepEqual(p.matchedSignals, ['country-compatibility', 'keyword-overlap', 'capability-overlap'])
  assert.deepEqual(p.missingSignals, ['industry-overlap'])
  const industry = p.evidence.find((e) => e.signal === 'industry-overlap')!
  assert.equal(industry.outcome, 'missing')
  assert.equal(industry.note, 'RFP industry unavailable')
  const keyword = p.evidence.find((e) => e.signal === 'keyword-overlap')!
  assert.equal(keyword.outcome, 'matched')
  const capability = p.evidence.find((e) => e.signal === 'capability-overlap')!
  assert.equal(capability.outcome, 'matched')
  assert.deepEqual(capability.values, ['quality', 'water'])
})

test('conflicting evidence yields NOT_A_MATCH without any matched signal', () => {
  const p = proposeProcurementMatch(ROOFTOP_SOLAR, NORTHFIELD)
  assert.equal(p.status, 'NOT_A_MATCH')
  assert.deepEqual(p.matchedSignals, [])
  const industry = p.evidence.find((e) => e.signal === 'industry-overlap')!
  assert.equal(industry.outcome, 'mismatched')
  assert.deepEqual(industry.values, ['advanced manufacturing', 'industrial automation', 'renewable energy', 'robotics'])
  assert.equal(industry.note, 'no shared industry between RFP and company')
  const country = p.evidence.find((e) => e.signal === 'country-compatibility')!
  assert.equal(country.outcome, 'mismatched')
  assert.deepEqual(country.values, ['india', 'usa'])
  assert.equal(country.note, 'RFP and company countries differ')
  const keyword = p.evidence.find((e) => e.signal === 'keyword-overlap')!
  assert.equal(keyword.outcome, 'missing')
  assert.equal(keyword.note, 'no shared keyword between RFP text and company description')
  const capability = p.evidence.find((e) => e.signal === 'capability-overlap')!
  assert.equal(capability.outcome, 'missing')
  assert.equal(capability.note, 'no shared capability between RFP text and company capabilities')
})

test('all-missing evidence yields INSUFFICIENT_EVIDENCE', () => {
  const blankSource: ProcurementSourceRecord = {
    recordId: 'RFB-999',
    recordType: 'notice',
    name: null,
    country: null,
    industries: null,
    description: null,
  }
  const blankCompany: ProcurementCompanyRecord = {
    companyId: 'COMP-999',
    name: null,
    country: null,
    industries: null,
    description: null,
    capabilities: null,
  }
  const p = proposeProcurementMatch(blankSource, blankCompany)
  assert.equal(p.status, 'INSUFFICIENT_EVIDENCE')
  assert.deepEqual(p.matchedSignals, [])
  assert.deepEqual(p.missingSignals, [
    'industry-overlap',
    'country-compatibility',
    'keyword-overlap',
    'capability-overlap',
  ])
  for (const entry of p.evidence) assert.equal(entry.outcome, 'missing')
})

test('missing data stays missing and never assumed', () => {
  const noCaps: ProcurementCompanyRecord = { ...SARVAJAL, capabilities: [] }
  const cap = proposeProcurementMatch(WATER_QUALITY, noCaps).evidence.find((e) => e.signal === 'capability-overlap')!
  assert.equal(cap.outcome, 'missing')
  assert.equal(cap.note, 'company capability list unavailable')

  const noText: ProcurementSourceRecord = { ...ROOFTOP_SOLAR, name: null, description: null }
  const keyword = proposeProcurementMatch(noText, AGRISOLAR).evidence.find((e) => e.signal === 'keyword-overlap')!
  assert.equal(keyword.outcome, 'missing')
  assert.equal(keyword.note, 'RFP has no comparable text')

  const noIndustriesCompany: ProcurementCompanyRecord = { ...AGRISOLAR, industries: [] }
  const industry = proposeProcurementMatch(ROOFTOP_SOLAR, noIndustriesCompany).evidence.find(
    (e) => e.signal === 'industry-overlap',
  )!
  assert.equal(industry.outcome, 'missing')
  assert.equal(industry.note, 'company industry unavailable')
})

test('an invalid or missing Notice is rejected by the engine', () => {
  assert.throws(() => proposeProcurementMatch({ ...ROOFTOP_SOLAR, recordId: '' }, AGRISOLAR), /recordId must be a non-empty string/)
  assert.throws(
    () => proposeProcurementMatch({ ...ROOFTOP_SOLAR, recordType: 'opportunity' as never }, AGRISOLAR),
    /unsupported source record type/,
  )
  assert.throws(() => proposeProcurementMatch(null as never, AGRISOLAR), /RFP record object/)
})

test('an invalid or missing Company is rejected by the engine', () => {
  assert.throws(() => proposeProcurementMatch(ROOFTOP_SOLAR, { ...AGRISOLAR, companyId: '' }), /companyId must be a non-empty string/)
  assert.throws(() => proposeProcurementMatch(ROOFTOP_SOLAR, null as never), /company record object/)
})

test('plural proposing is total, ordered, and empty-safe', () => {
  const all = proposeProcurementMatches(ROOFTOP_SOLAR, [AGRISOLAR, NORTHFIELD, SARVAJAL])
  assert.equal(all.length, 3)
  assert.equal(all[0].status, 'PROPOSED')
  assert.equal(all[1].status, 'NOT_A_MATCH')
  assert.deepEqual(proposeProcurementMatches(ROOFTOP_SOLAR, []), [])
})

test('repeats are identical, outputs carry no score or confidence', () => {
  const first = proposeProcurementMatch(ROOFTOP_SOLAR, AGRISOLAR)
  const second = proposeProcurementMatch(ROOFTOP_SOLAR, AGRISOLAR)
  assert.deepEqual(second, first)
  const serialized = JSON.stringify(first)
  assert.ok(!serialized.includes('"score"'), 'no numeric score may leave the engine')
  assert.ok(!serialized.includes('"confidence"'), 'no confidence value may leave the engine')
  assert.ok(Object.isFrozen(first))
})