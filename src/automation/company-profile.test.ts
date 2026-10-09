/**
 * Phase 25 tests: the verified company profile gate and mapping. A profile
 * without valid identity or verified provenance is never matchable, and absent
 * attributes are carried through as absent (missing evidence), never defaulted.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isVerifiedCompanyProfile,
  toMatchCompanyRecord,
  type VerifiedCompanyProfile,
} from './company-profile'

const VERIFIED: VerifiedCompanyProfile = {
  companyId: 'COMP-100',
  name: 'Real Solar Pty Ltd',
  country: 'India',
  industry: ['Renewable energy'],
  businessDescription: 'Solar pumping systems for smallholder farmers.',
  technologyFocus: ['Solar photovoltaic pumping'],
  projectFocus: ['Rural electrification'],
  certifications: ['ISO 9001'],
  provenance: { source: 'https://example.invalid/registry/COMP-100', verifiedAt: '2026-10-01', status: 'verified' },
}

test('a completed verified profile passes the gate', () => {
  assert.equal(isVerifiedCompanyProfile(VERIFIED), true)
})

test('identity and provenance are both mandatory', () => {
  const noId = { ...VERIFIED, companyId: '' }
  const noName = { ...VERIFIED, name: '   ' }
  const noProvenance = { ...VERIFIED, provenance: undefined }
  const unverified = { ...VERIFIED, provenance: { ...VERIFIED.provenance, status: 'unverified' as const } }
  const noSource = { ...VERIFIED, provenance: { ...VERIFIED.provenance, source: '' } }
  const badDate = { ...VERIFIED, provenance: { ...VERIFIED.provenance, verifiedAt: 'October 2026' } }
  for (const candidate of [noId, noName, noProvenance, unverified, noSource, badDate, null, 'x', []]) {
    assert.equal(isVerifiedCompanyProfile(candidate), false, `must reject ${JSON.stringify(candidate)}`)
  }
})

test('absent attributes become null (missing), never a default', () => {
  const sparse: VerifiedCompanyProfile = {
    companyId: 'COMP-200',
    name: 'Sparse Co',
    provenance: { source: 'COMP-200 record', verifiedAt: '2026-10-02', status: 'verified' },
  }
  const mapped = toMatchCompanyRecord(sparse)
  assert.equal(mapped.companyId, 'COMP-200')
  assert.equal(mapped.country, null)
  assert.equal(mapped.industries, null)
  assert.equal(mapped.description, null)
  assert.equal(mapped.capabilities, null, 'no invented capabilities')
})

test('capabilities flatten present lists only, in tech→project→cert order', () => {
  const mapped = toMatchCompanyRecord(VERIFIED)
  assert.deepEqual(mapped.capabilities, [
    'Solar photovoltaic pumping',
    'Rural electrification',
    'ISO 9001',
  ])
})
