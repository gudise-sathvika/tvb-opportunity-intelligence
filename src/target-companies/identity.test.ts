import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyIdentityEvidence,
  createUnverifiedTargetCompanyIdentity,
  isIdentityVerified,
} from './identity'

const SOURCE = {
  rowNumber: 2,
  headers: ['company name', 'company URL'],
  values: ['ContextQA', 'https://contextai.us/'],
}

test('new target company identity starts unverified and not ready', () => {
  const profile = createUnverifiedTargetCompanyIdentity(SOURCE)
  assert.equal(profile.identityStatus, 'not_checked')
  assert.equal(profile.canonicalName, null)
  assert.equal(profile.canonicalUrl, null)
  assert.equal(profile.readiness, 'insufficient_evidence')
  assert.equal(isIdentityVerified(profile), false)
})

test('verified legal identity does not imply capabilities or relevance', () => {
  const profile = createUnverifiedTargetCompanyIdentity(SOURCE)
  const evidence = {
    evidenceType: 'company-register-record',
    sourceName: 'Example Registry',
    sourceUrl: 'https://registry.example/123',
    registeredName: 'CONTEXTQA INC',
    jurisdiction: 'US',
    registrationNumber: '123',
    lei: null,
    entityStatus: 'active',
    retrievedAt: '2026-10-19',
    outcome: 'verified_legal_entity' as const,
    fieldsSupported: ['registeredName'],
    note: null,
  }
  const verified = applyIdentityEvidence(profile, 'verified_legal_entity', evidence)
  assert.equal(verified.identityStatus, 'verified_legal_entity')
  assert.equal(verified.canonicalName, 'CONTEXTQA INC')
  assert.equal(verified.canonicalUrl, 'https://registry.example/123')
  assert.equal(verified.readiness, 'limited')
  assert.ok(verified.readinessReasons.some((r) => /capabilities, eligibility, and opportunity relevance remain unverified/i.test(r)))
  assert.ok(verified.claims.length === 1)
})

test('ambiguous identity is deferred and not canonicalized', () => {
  const profile = createUnverifiedTargetCompanyIdentity(SOURCE)
  const evidence = {
    evidenceType: 'company-register-record',
    sourceName: 'Example Registry',
    sourceUrl: 'https://registry.example/ambiguous',
    registeredName: 'CONTEXTQA LLC',
    jurisdiction: 'US',
    registrationNumber: null,
    lei: null,
    entityStatus: 'active',
    retrievedAt: '2026-10-19',
    outcome: 'ambiguous_entity' as const,
    fieldsSupported: ['registeredName'],
    note: 'Multiple candidates',
  }
  const result = applyIdentityEvidence(profile, 'ambiguous_entity', evidence, ['Multiple possible legal entities found.'])
  assert.equal(result.identityStatus, 'ambiguous_entity')
  assert.equal(result.canonicalName, null)
  assert.equal(result.readiness, 'deferred')
  assert.ok(result.conflicts.includes('Multiple possible legal entities found.'))
})

test('source values are preserved separately from verified claims', () => {
  const profile = createUnverifiedTargetCompanyIdentity(SOURCE)
  assert.deepEqual(profile.source.values, ['ContextQA', 'https://contextai.us/'])
})