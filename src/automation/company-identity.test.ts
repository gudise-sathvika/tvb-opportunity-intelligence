/**
 * Phase 16 company-identity tests — fully offline, synthetic candidates.
 *
 * Rules under test: stages stay distinct, confirmation requires an already
 * verified candidate, ambiguous/unverified records never resolve, original
 * names are retained, and non-LEI verified entities are representable.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  IDENTITY_OUTCOMES,
  confirmEntityCandidate,
  resolveConfirmedIdentities,
} from './company-identity'
import type { EntityCandidate } from './company-identity'

function candidate(overrides: Partial<EntityCandidate> = {}): EntityCandidate {
  return {
    candidateId: 'CAND-1',
    directoryName: 'Pulsar',
    registeredName: 'PULSAR',
    companyId: 'LEI-969500ENLQNIKQP7Z957',
    outcome: 'verified_legal_entity',
    evidence: [],
    ...overrides,
  }
}

test('outcome vocabulary is never a binary real/fake field', () => {
  assert.ok((IDENTITY_OUTCOMES as readonly string[]).includes('ambiguous_entity'))
  assert.ok((IDENTITY_OUTCOMES as readonly string[]).includes('not_found_in_searched_sources'))
  assert.ok((IDENTITY_OUTCOMES as readonly string[]).includes('not_checked'))
  assert.equal((IDENTITY_OUTCOMES as readonly string[]).includes('fake'), false)
})

test('confirmation requires an already-verified candidate and records audit', () => {
  const confirmed = confirmEntityCandidate(candidate(), 'reviewer-1', '2026-10-15', 'Matches the engaged client.')
  assert.ok(confirmed !== null)
  assert.equal(confirmed?.companyId, 'LEI-969500ENLQNIKQP7Z957')
  assert.equal(confirmed?.confirmedBy, 'reviewer-1')
  assert.equal(confirmEntityCandidate(candidate({ outcome: 'ambiguous_entity' }), 'reviewer-1', '2026-10-15'), null)
  assert.equal(confirmEntityCandidate(candidate({ outcome: 'not_found_in_searched_sources' }), 'reviewer-1', '2026-10-15'), null)
  assert.equal(confirmEntityCandidate(candidate(), '   ', '2026-10-15'), null)
})

test('resolution partitions without claiming intent; absent list preserves legacy behavior', () => {
  const ids = ['LEI-A', 'LEI-B', 'LEI-C']
  assert.deepEqual(resolveConfirmedIdentities(ids, undefined), { confirmed: ids, unconfirmed: [] })
  assert.deepEqual(resolveConfirmedIdentities(ids, ['LEI-B']), { confirmed: ['LEI-B'], unconfirmed: ['LEI-A', 'LEI-C'] })
  assert.deepEqual(resolveConfirmedIdentities(ids, []), { confirmed: [], unconfirmed: ids })
})

test('a verified non-LEI entity is representable without fabricating an LEI', () => {
  const record = candidate({
    candidateId: 'CAND-CH',
    directoryName: 'Acme Ltd',
    registeredName: 'ACME LIMITED',
    companyId: 'CH-12345678',
    evidence: [
      {
        evidenceType: 'company-register-record',
        sourceName: 'Example Companies Register (illustrative)',
        sourceUrl: 'https://register.invalid/CH-12345678',
        registeredName: 'ACME LIMITED',
        jurisdiction: 'United Kingdom',
        registrationNumber: '12345678',
        lei: null,
        entityStatus: 'active',
        retrievedAt: '2026-10-15',
        outcome: 'verified_legal_entity',
        fieldsSupported: ['registeredName', 'jurisdiction', 'registrationNumber'],
        note: null,
      },
    ],
  })
  assert.equal(record.companyId, 'CH-12345678')
  assert.equal(record.evidence[0].lei, null)
  const confirmed = confirmEntityCandidate(record, 'reviewer-1', '2026-10-15')
  assert.ok(confirmed !== null && confirmed.companyId === 'CH-12345678')
})

test('original directory names are retained alongside verified legal names', () => {
  const record = candidate({ directoryName: 'flareAI', registeredName: 'FLARE AI LIMITED' })
  assert.equal(record.directoryName, 'flareAI')
  assert.notEqual(record.directoryName, record.registeredName)
})

test('Phase 30: capability claims keep their provenance tier and unknowns stay unknown', async () => {
  const { classifyCapabilityEvidence } = await import('./company-identity')
  assert.equal(classifyCapabilityEvidence({ capability: null }).tier, 'unknown')
  assert.equal(classifyCapabilityEvidence({ capability: '  ' }).tier, 'unknown')
  assert.equal(classifyCapabilityEvidence({ capability: 'grid-scale batteries' }).tier, 'company_provided')
  assert.equal(
    classifyCapabilityEvidence({ capability: 'grid-scale batteries', officialSourceUrl: 'https://sec.gov/x' }).tier,
    'source_supported',
  )
  assert.equal(
    classifyCapabilityEvidence({ capability: 'grid-scale batteries', officialSourceUrl: 'https://sec.gov/x', confirmedBy: 'reviewer-1' }).tier,
    'human_confirmed',
  )
  // Confirmation alone, without a source, never confirms.
  assert.equal(classifyCapabilityEvidence({ capability: 'grid-scale batteries', confirmedBy: 'reviewer-1' }).tier, 'company_provided')
})
