/**
 * Candidate classification tests (Phase C brief §8) — CLASSIFY-RULES-v1.
 *
 * Behavior under test (fixtures: known/unknown funding type, known
 * procurement type, uncertain classification):
 *  - funding raw type aliases map to Grant/Fund/Subsidy/Incentive/Program
 *  - funding title keywords map with MEDIUM certainty
 *  - uncertain funding → NEEDS_REVIEW, never a guessed type
 *  - procurement always classifies to Notice (raw type, title, or domain rule)
 *  - funding and procurement are sealed: cross-domain types never leak
 *  - evidence is deterministic and fully reproducible (no AI prose)
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DiscoveryCandidate } from './candidate'
import { CLASSIFICATION_RULE_VERSION, classifyCandidate } from './classify'
import { candidateFromRawResult } from './transform'
import { makeRaw, syntheticAdapterResult, fixtureRequest } from './phase-c-fixtures'
import type { AdapterResult, RawResult } from './types'

function classify(raw: RawResult, domain: 'funding' | 'procurement'): DiscoveryCandidate {
  const request = fixtureRequest({ sourceId: domain === 'funding' ? 'SU-FX-002' : 'SU-FX-001', domain })
  const result: AdapterResult = syntheticAdapterResult({
    request,
    sourceName: domain === 'funding' ? 'Fixture Grants Portal (test)' : 'Fixture Procurement Portal (test)',
    adapterType: 'fixture',
    results: [raw],
  })
  return classifyCandidate(candidateFromRawResult(result, raw))
}

test('a funding listing with rawType grant classifies as Grant with HIGH certainty', () => {
  const candidate = classify(
    makeRaw({ sourceUrl: 'https://fixture.invalid/grants/1', title: 'Fixture Climate Innovation Grant Programme', rawType: 'grant', sourceRecordId: 'FX-F-1001' }),
    'funding',
  )
  const classification = candidate.classification ?? assert.fail('expected classification')
  assert.equal(classification.state, 'CLASSIFIED')
  assert.equal(classification.type, 'Grant')
  assert.equal(classification.certainty, 'HIGH')
  assert.equal(classification.evidence.matchedRule, 'raw-type-alias')
  assert.deepEqual(classification.evidence.titleHints, [])
  assert.equal(classification.evidence.sourceEvidence.sourceRawType, 'grant')
  assert.equal(classification.evidence.sourceEvidence.adapterType, 'fixture')
  assert.equal(classification.evidence.sourceEvidence.sourceId, 'SU-FX-002')
  assert.equal(classification.evidence.ruleVersion, CLASSIFICATION_RULE_VERSION)
  assert.equal(classification.evidence.domain, 'funding')
  assert.equal(candidate.candidateStatus, 'NEW', 'a classified funding candidate is not auto-approved')
})

test('each funding raw-type alias maps to its vocabulary type', () => {
  const cases: Array<[string, string]> = [
    ['grant', 'Grant'],
    ['fund', 'Fund'],
    ['subsidy', 'Subsidy'],
    ['incentive', 'Incentive'],
    ['program', 'Program'],
    ['programme', 'Program'],
  ]
  for (const [rawType, expected] of cases) {
    const classification = classify(
      makeRaw({ sourceUrl: `https://fixture.invalid/grants/${rawType}`, title: `Fixture ${rawType} title`, rawType, sourceRecordId: `FX-F-${rawType}` }),
      'funding',
    ).classification
    assert.equal(classification?.state, 'CLASSIFIED')
    assert.equal(classification?.type, expected)
    assert.equal(classification?.certainty, 'HIGH')
  }
})

test('a funding listing with a title keyword but no raw type classifies with MEDIUM certainty', () => {
  const candidate = classify(
    makeRaw({ sourceUrl: 'https://fixture.invalid/grants/2', title: 'Regional Digitalisation Subsidy', rawType: null, sourceRecordId: 'FX-F-1002' }),
    'funding',
  )
  const classification = candidate.classification ?? assert.fail('expected classification')
  assert.equal(classification.state, 'CLASSIFIED')
  assert.equal(classification.type, 'Subsidy')
  assert.equal(classification.certainty, 'MEDIUM')
  assert.equal(classification.evidence.matchedRule, 'title-keyword')
  assert.ok(classification.evidence.titleHints.includes('subsidy'))
})

test('an uncertain funding listing is NEEDS_REVIEW and moves to REVIEW — never guessed', () => {
  const candidate = classify(
    makeRaw({ sourceUrl: 'https://fixture.invalid/grants/3', title: 'Quarterly Innovation Update', rawType: 'misc', sourceRecordId: 'FX-F-1003' }),
    'funding',
  )
  const classification = candidate.classification ?? assert.fail('expected classification')
  assert.equal(classification.state, 'NEEDS_REVIEW')
  assert.equal(classification.type, null)
  assert.equal(classification.certainty, null)
  assert.equal(classification.evidence.matchedRule, 'needs-review-no-evidence')
  assert.equal(candidate.candidateStatus, 'REVIEW')
})

test('a procurement listing with rawType RFB classifies as Notice with HIGH certainty', () => {
  const candidate = classify(
    makeRaw({ sourceUrl: 'https://fixture.invalid/tenders/1', title: 'Fixture Framework Agreement for Construction Services', rawType: 'RFB', sourceRecordId: 'FX-P-1001' }),
    'procurement',
  )
  const classification = candidate.classification ?? assert.fail('expected classification')
  assert.equal(classification.state, 'CLASSIFIED')
  assert.equal(classification.type, 'Notice')
  assert.equal(classification.certainty, 'HIGH')
  assert.equal(classification.evidence.matchedRule, 'raw-type-alias')
  assert.equal(candidate.candidateStatus, 'NEW')
})

test('a procurement listing with a tender keyword classifies to Notice with MEDIUM certainty', () => {
  const candidate = classify(
    makeRaw({ sourceUrl: 'https://fixture.invalid/tenders/2', title: 'Tender for the supply of IT equipment', rawType: null, sourceRecordId: 'FX-P-1002' }),
    'procurement',
  )
  const classification = candidate.classification ?? assert.fail('expected classification')
  assert.equal(classification.state, 'CLASSIFIED')
  assert.equal(classification.type, 'Notice')
  assert.equal(classification.certainty, 'MEDIUM')
  assert.equal(classification.evidence.matchedRule, 'title-keyword')
  assert.ok(classification.evidence.titleHints.includes('tender'))
})

test('a procurement listing with no signal classifies to Notice via the domain default (LOW)', () => {
  const candidate = classify(
    makeRaw({ sourceUrl: 'https://fixture.invalid/tenders/3', title: 'Annual Progress Report', rawType: null, sourceRecordId: 'FX-P-1003' }),
    'procurement',
  )
  const classification = candidate.classification ?? assert.fail('expected classification')
  assert.equal(classification.state, 'CLASSIFIED')
  assert.equal(classification.type, 'Notice')
  assert.equal(classification.certainty, 'LOW')
  assert.equal(classification.evidence.matchedRule, 'domain-default-procurement')
})

test('funding and procurement types never cross the domain seal', () => {
  const fundingTypes = normalizeVocabularyValues('funding')
  const procurementTypes = normalizeVocabularyValues('procurement')
  for (const type of fundingTypes) assert.notEqual(type, 'Notice')
  for (const type of procurementTypes) assert.equal(type, 'Notice')
})

function normalizeVocabularyValues(domain: 'funding' | 'procurement'): string[] {
  const raws: RawResult[] = ['grant', 'program'].map((rawType, index) =>
    makeRaw({ sourceUrl: `https://fixture.invalid/${domain}/${index}`, title: `Fixture ${rawType} title`, rawType, sourceRecordId: `FX-${domain}-${index}` }),
  )
  return raws
    .map((raw) => classify(raw, domain).classification?.type)
    .filter((type): type is string => type !== undefined && type !== null)
}

test('classification evidence is deterministic and contains no free-text AI explanation', () => {
  for (const domain of ['funding', 'procurement'] as const) {
    const candidate = classify(
      makeRaw({
        sourceUrl: `https://fixture.invalid/${domain}/x`,
        title: domain === 'funding' ? 'Fixture Grant Thing' : 'Fixture Tender Thing',
        rawType: domain === 'funding' ? 'grant' : 'RFB',
        sourceRecordId: `FX-${domain}-x`,
      }),
      domain,
    )
    const evidence = candidate.classification?.evidence ?? assert.fail('expected evidence')
    assert.deepEqual(
      Object.keys(evidence).sort(),
      ['domain', 'matchedRule', 'ruleVersion', 'sourceEvidence', 'titleHints'].sort(),
    )
    assert.equal(evidence.ruleVersion, CLASSIFICATION_RULE_VERSION)
    assert.equal(candidate.provenance.stageHistory.at(-1), 'classify')
  }
})

test('classification is idempotent and never rewrites an existing result', () => {
  const candidate = classify(
    makeRaw({ sourceUrl: 'https://fixture.invalid/grants/4', title: 'Fixture Grant', rawType: 'grant', sourceRecordId: 'FX-F-1004' }),
    'funding',
  )
  assert.equal(classifyCandidate(candidate), candidate)
})