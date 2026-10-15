/**
 * Phase 13 MATCH-RULES-v2 tests — fully offline, synthetic fixtures only.
 *
 * Covers: independent versioning, identical-input v1 parity where rules agree,
 * the stricter PROPOSED gate (no match beside a contradiction), the SIC/CPV
 * vocabulary guard, informational-only context signals, determinism, and the
 * shared insufficient-evidence vocabulary.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { proposeMatch } from './match-proposal'
import { proposeProcurementMatch } from './procurement-proposal'
import {
  MATCH_RULES_V2_VERSION,
  PMATCH_RULES_V2_VERSION,
  contextSignalsFor,
  proposeMatchV2,
  proposeProcurementMatchV2,
} from './match-rules-v2'

const US_COMPANY = {
  companyId: 'LEI-US-1',
  name: 'General Electric Company',
  country: 'United States',
  industries: ['Electronic equipment (SIC 3600)'],
  description: null,
  capabilities: null,
} as const

const US_GRANT = {
  recordId: '357305',
  recordType: 'opportunity',
  name: 'Feasibility Clinical Trials',
  country: 'United States',
  industries: null,
  description: null,
} as const

test('v2 carries its own explicit rule versions, distinct from v1', () => {
  assert.equal(MATCH_RULES_V2_VERSION, 'MATCH-RULES-v2')
  assert.equal(PMATCH_RULES_V2_VERSION, 'PMATCH-RULES-v2')
  assert.notEqual(MATCH_RULES_V2_VERSION, 'MATCH-RULES-v1')
})

test('v2 agrees with v1 on the canonical country-match case (distinct ids)', () => {
  const v1 = proposeMatch({ ...US_GRANT }, { ...US_COMPANY })
  const v2 = proposeMatchV2({ ...US_GRANT }, { ...US_COMPANY })
  assert.equal(v1.status, 'PROPOSED')
  assert.equal(v2.status, 'PROPOSED')
  assert.deepEqual([...v2.matchedSignals], ['country-compatibility'])
  assert.ok(v2.proposalId.startsWith('MP2:MATCH-RULES-v2:357305:LEI-US-1'))
  assert.equal(v1.proposalId.startsWith('MP2:'), false)
})

test('v2 refuses PROPOSED beside a contradiction where v1 still proposes', () => {
  // Country matches but industries are both present and disjoint.
  const source = { ...US_GRANT, industries: ['Shipbuilding'] as readonly string[] }
  const v1 = proposeMatch(source, { ...US_COMPANY })
  assert.equal(v1.status, 'PROPOSED')
  const v2 = proposeMatchV2(source, { ...US_COMPANY })
  assert.equal(v2.status, 'NOT_A_MATCH')
})

test('SIC-vs-CPV industries are unverified context, never a verdict', () => {
  const source = { ...US_GRANT, industries: ['48180000'] as readonly string[] }
  const v2 = proposeMatchV2(source, { ...US_COMPANY })
  assert.ok(!v2.matchedSignals.includes('industry-overlap'))
  assert.ok(v2.missingSignals.includes('industry-overlap'))
  assert.ok(v2.contextSignals.includes('industry-vocabulary-unverified'))
  assert.equal(v2.status, 'PROPOSED', 'country match with no decisive contradiction still proposes')
})

test('same-vocabulary industries compare exactly like v1', () => {
  const source = { ...US_GRANT, industries: ['Electronic equipment (SIC 3600)'] as readonly string[] }
  const v2 = proposeMatchV2(source, { ...US_COMPANY })
  assert.ok(v2.matchedSignals.includes('industry-overlap'))
  const other = { ...US_GRANT, industries: ['Shipbuilding'] as readonly string[] }
  const plain = proposeMatchV2(
    { ...other },
    { companyId: 'C-9', name: 'Plain Co', country: 'United States', industries: ['Textiles'], description: null, capabilities: null },
  )
  assert.equal(plain.status, 'NOT_A_MATCH', 'country match cannot rescue disjoint plain industries under v2')
})

test('context signals record coverage without deciding', () => {
  const v2 = proposeMatchV2(
    { ...US_GRANT },
    { ...US_COMPANY },
    { opportunityProgrammes: ['93.213'], opportunitySectors: ['health'], opportunityCategories: ['48180000'], opportunityDocumentsAvailable: true },
  )
  assert.deepEqual([...v2.contextSignals].sort(), [
    'category-evidence-present',
    'document-evidence-present',
    'programme-evidence-present',
    'sector-evidence-present',
  ])
  assert.equal(v2.status, 'PROPOSED', 'context alone changes nothing without decisive support')
  const bare = proposeMatchV2({ ...US_GRANT }, { ...US_COMPANY }, null)
  assert.deepEqual([...bare.contextSignals], [])
  assert.equal(bare.status, 'PROPOSED')
})

test('insufficient evidence stays insufficient, never positive', () => {
  const v2 = proposeMatchV2(
    { recordId: 'X-1', recordType: 'opportunity', name: 'Unknown call', country: null, industries: null, description: null },
    { companyId: 'C-0', name: 'No Evidence Co', country: null, industries: null, description: null, capabilities: null },
  )
  assert.equal(v2.status, 'INSUFFICIENT_EVIDENCE')
})

test('v2 procurement mirrors the stricter gate with capability support', () => {
  const notice = { recordId: 'ocds-1', recordType: 'notice', name: 'Cleaning Services', country: 'United Kingdom', industries: null, description: null } as const
  const company = { companyId: 'LEI-GB-1', name: 'Clean Co', country: 'United Kingdom', industries: null, description: null, capabilities: null } as const
  const v1 = proposeProcurementMatch({ ...notice }, { ...company })
  const v2 = proposeProcurementMatchV2({ ...notice }, { ...company })
  assert.equal(v1.status, 'PROPOSED')
  assert.equal(v2.status, 'PROPOSED')
  assert.ok(v2.proposalId.startsWith('PP2:PMATCH-RULES-v2:'))
  assert.deepEqual([...v2.missingSignals].sort(), ['capability-overlap', 'industry-overlap', 'keyword-overlap'])
})

test('v2 is deterministic: identical inputs give identical outputs', () => {
  const first = proposeMatchV2({ ...US_GRANT }, { ...US_COMPANY })
  const second = proposeMatchV2({ ...US_GRANT }, { ...US_COMPANY })
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)))
})

test('contextSignalsFor handles absent evidence without inventing any', () => {
  assert.deepEqual([...contextSignalsFor(null)], [])
  assert.deepEqual([...contextSignalsFor(undefined)], [])
  assert.deepEqual([...contextSignalsFor({})], [])
})
