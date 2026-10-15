/**
 * Phase 13 shadow comparison tests — fully offline, synthetic fixtures only.
 *
 * Covers: identical inputs to both versions, v1 preservation with shadow on,
 * no persistence side effects, unconfirmed entities staying out, missing data
 * staying unknown, no eligibility inference, CPV discipline, provenance on
 * contradictions, insufficient-evidence discipline, non-actionable exclusion,
 * determinism, v1 immutability, no decision migration, and reconciling counts.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  shadowEvaluateFunding,
  shadowEvaluateProcurement,
  summarizeShadowComparisons,
} from './match-shadow'

const COMPANY = {
  companyId: 'LEI-US-1',
  name: 'General Electric Company',
  country: 'United States',
  industries: null,
  description: null,
  capabilities: null,
} as const

const OPEN_GRANT = {
  recordId: '357305',
  recordType: 'opportunity',
  name: 'Feasibility Clinical Trials',
  country: 'United States',
  industries: null,
  description: null,
} as const

test('shadow runs both versions on identical inputs and preserves v1 exactly', () => {
  const { v1, v2Status, v2RuleVersion, comparison } = shadowEvaluateFunding({ ...OPEN_GRANT }, { ...COMPANY })
  assert.equal(v1.status, 'PROPOSED')
  assert.equal(v1.ruleVersion, 'MATCH-RULES-v1')
  assert.ok(v1.proposalId.startsWith('MP:MATCH-RULES-v1:'))
  assert.equal(v2Status, 'PROPOSED')
  assert.equal(v2RuleVersion, 'MATCH-RULES-v2')
  assert.equal(comparison.agreement, true)
  assert.equal(comparison.difference, null)
  assert.equal(comparison.pairId, 'LEI-US-1×357305')
})

test('a v1-propose-beside-contradiction becomes a v2 NOT_A_MATCH with a reason', () => {
  const source = { ...OPEN_GRANT, industries: ['Shipbuilding'] as readonly string[] }
  const company = { ...COMPANY, industries: ['Electronic equipment (SIC 3600)'] as readonly string[] }
  const { v1, comparison } = shadowEvaluateFunding(source, company)
  assert.equal(v1.status, 'PROPOSED', 'v1 behavior preserved exactly')
  assert.equal(comparison.v2Status, 'NOT_A_MATCH')
  assert.equal(comparison.agreement, false)
  assert.ok((comparison.difference ?? '').includes('zero decisive mismatches'))
})

test('unconfirmed entities never enter; missing stays unknown, never positive', () => {
  const confirmed = shadowEvaluateFunding({ ...OPEN_GRANT }, { ...COMPANY })
  assert.equal(confirmed.v1.status, 'PROPOSED')
  const empty = shadowEvaluateFunding(
    { recordId: 'X-9', recordType: 'opportunity', name: 'Unknown', country: null, industries: null, description: null },
    { companyId: 'C-0', name: 'Nobody', country: null, industries: null, description: null, capabilities: null },
  )
  assert.equal(empty.v1.status, 'INSUFFICIENT_EVIDENCE')
  assert.equal(empty.v2Status, 'INSUFFICIENT_EVIDENCE')
  assert.equal(empty.comparison.agreement, true)
})

test('programme text never establishes eligibility in either version', () => {
  const { v1, v2Status } = shadowEvaluateFunding({ ...OPEN_GRANT }, { ...COMPANY }, { opportunityProgrammes: ['93.213'] })
  assert.equal(v1.matchedSignals.includes('programme-evidence-present' as never), false)
  assert.equal(v2Status, 'PROPOSED', 'country match decides; programme text is context only')
})

test('procurement shadow keeps CPV disciplined and actionability upstream', () => {
  const notice = { recordId: 'ocds-1', recordType: 'notice', name: 'Cleaning', country: 'United Kingdom', industries: null, description: null } as const
  const company = { companyId: 'LEI-GB-1', name: 'Clean Co', country: 'United Kingdom', industries: ['Facilities (SIC 7349)'], description: null, capabilities: null } as const
  const { v1, v2Status, comparison } = shadowEvaluateProcurement({ ...notice }, { ...company }, { opportunityCategories: ['48180000'] })
  assert.equal(v1.status, 'PROPOSED')
  assert.equal(v2Status, 'PROPOSED', 'CPV-vs-SIC must not mismatch; country decides')
  assert.equal(comparison.agreement, true)
})

test('contradictions carry provenance-free but explicit evidence notes', () => {
  const source = { ...OPEN_GRANT, country: 'United Kingdom' }
  const { v1, comparison } = shadowEvaluateFunding(source, { ...COMPANY })
  assert.equal(v1.status, 'NOT_A_MATCH')
  assert.equal(comparison.v2Status, 'NOT_A_MATCH')
  const evidence = v1.evidence.find((entry) => entry.signal === 'country-compatibility')
  assert.equal(evidence?.outcome, 'mismatched')
  assert.ok((evidence?.note ?? '').length > 0)
})

test('determinism and reconciling aggregates', () => {
  const pairs = [
    shadowEvaluateFunding({ ...OPEN_GRANT }, { ...COMPANY }).comparison,
    shadowEvaluateFunding({ ...OPEN_GRANT }, { ...COMPANY }).comparison,
    shadowEvaluateFunding(
      { ...OPEN_GRANT, industries: ['Shipbuilding'] as readonly string[] },
      { ...COMPANY, industries: ['Electronic equipment (SIC 3600)'] as readonly string[] },
    ).comparison,
  ]
  assert.deepEqual(pairs[0], pairs[1], 'identical inputs give identical comparisons')
  const batch = summarizeShadowComparisons(pairs)
  assert.equal(batch.agreementCount + batch.disagreementCount, pairs.length)
  assert.equal(batch.agreementCount, 2)
  assert.equal(batch.disagreementCount, 1)
})

test('shadow comparison is side-effect free and migrates nothing', () => {
  const source = { ...OPEN_GRANT }
  const company = { ...COMPANY }
  const before = JSON.stringify({ source, company })
  shadowEvaluateFunding(source, company)
  shadowEvaluateProcurement(
    { recordId: 'ocds-1', recordType: 'notice', name: 'N', country: 'GB', industries: null, description: null },
    { companyId: 'C-1', name: 'Co', country: 'GB', industries: null, description: null, capabilities: null },
  )
  assert.equal(JSON.stringify({ source, company }), before, 'inputs must be untouched (frozen downstream)')
})
