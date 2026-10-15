/**
 * GLEIF company discovery tests. A discovered company is verified ONLY when the
 * official registry marks its entity ACTIVE and its registration ISSUED; the
 * LEI is the identity, country is taken only from the registered legal address,
 * and anything the endpoint does not publish stays absent (never invented).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isVerifiedCompanyProfile, toMatchCompanyRecord } from './company-profile'
import {
  gleifRecordToProfile,
  gleifRecordUrl,
  mapGleifSearchResponse,
} from './gleif-company-discovery'

const VERIFIED_AT = '2026-10-14'
const LEI = '969500RFR6THHK28RD81'

function activeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const entity: Record<string, unknown> = {
    legalName: { name: 'TESLA', language: 'fr' },
    legalAddress: { country: 'FR', city: 'COURBEVOIE' },
    status: 'ACTIVE',
  }
  const attributes: Record<string, unknown> = {
    lei: LEI,
    entity,
    registration: { status: 'ISSUED' },
  }
  return { type: 'lei-records', id: LEI, attributes, ...overrides }
}

test('an ACTIVE/ISSUED record becomes a verified profile with LEI identity and provenance', () => {
  const outcome = gleifRecordToProfile(activeRecord(), VERIFIED_AT)
  assert.ok('profile' in outcome, 'expected a profile')
  const profile = outcome.profile
  assert.equal(profile.companyId, `LEI-${LEI}`)
  assert.equal(profile.name, 'TESLA')
  assert.equal(profile.country, 'France')
  assert.deepEqual(profile.provenance, {
    source: gleifRecordUrl(LEI),
    verifiedAt: VERIFIED_AT,
    status: 'verified',
  })
  assert.equal(isVerifiedCompanyProfile(profile), true)
})

test('country comes only from the registered legal address; absent or malformed is missing, never guessed', () => {
  const noAddress = activeRecord()
  delete ((noAddress['attributes'] as Record<string, unknown>)['entity'] as Record<string, unknown>)['legalAddress']
  const a = gleifRecordToProfile(noAddress, VERIFIED_AT)
  assert.ok('profile' in a && a.profile.country === null)

  const badCountry = activeRecord()
  ;(((badCountry['attributes'] as Record<string, unknown>)['entity'] as Record<string, unknown>)['legalAddress'] as Record<
    string,
    unknown
  >)['country'] = 'France'
  const b = gleifRecordToProfile(badCountry, VERIFIED_AT)
  assert.ok('profile' in b && b.profile.country === null, 'a non-ISO country code is missing, not coerced')

  const lower = activeRecord()
  ;(((lower['attributes'] as Record<string, unknown>)['entity'] as Record<string, unknown>)['legalAddress'] as Record<
    string,
    unknown
  >)['country'] = 'de'
  const c = gleifRecordToProfile(lower, VERIFIED_AT)
  assert.ok('profile' in c && c.profile.country === 'Germany', 'a valid code is upper-cased, not invented')
})

test('no industry, description, capabilities or certifications are invented', () => {
  const outcome = gleifRecordToProfile(activeRecord(), VERIFIED_AT)
  assert.ok('profile' in outcome)
  const mapped = toMatchCompanyRecord(outcome.profile)
  assert.equal(mapped.country, 'France')
  assert.equal(mapped.industries, null)
  assert.equal(mapped.description, null)
  assert.equal(mapped.capabilities, null)
})

test('non-ACTIVE, non-ISSUED, malformed-LEI and nameless records are rejected, never coerced', () => {
  const inactive = activeRecord()
  ;(((inactive['attributes'] as Record<string, unknown>)['entity'] as Record<string, unknown>)['status'] = 'INACTIVE')
  const badReg = activeRecord()
  ;((badReg['attributes'] as Record<string, unknown>)['registration'] as Record<string, unknown>)['status'] = 'LAPSED'
  const badLei = activeRecord({ id: 'not-an-lei' })
  ;(badLei['attributes'] as Record<string, unknown>)['lei'] = 'nope'
  const nameless = activeRecord()
  delete ((nameless['attributes'] as Record<string, unknown>)['entity'] as Record<string, unknown>)['legalName']
  const notObject = 'x'

  for (const [label, record] of [
    ['inactive', inactive],
    ['badReg', badReg],
    ['badLei', badLei],
    ['nameless', nameless],
    ['notObject', notObject],
  ] as const) {
    const outcome = gleifRecordToProfile(record, VERIFIED_AT)
    assert.ok('rejection' in outcome, `${label} must be rejected`)
    assert.equal(outcome.rejection.reason.length > 0, true)
  }
})

test('a whole response separates accepted profiles from rejected records', () => {
  const inactive = activeRecord()
  ;(((inactive['attributes'] as Record<string, unknown>)['entity'] as Record<string, unknown>)['status'] = 'INACTIVE')
  const result = mapGleifSearchResponse({ data: [activeRecord(), inactive] }, VERIFIED_AT)
  assert.equal(result.profiles.length, 1)
  assert.equal(result.rejected.length, 1)
  assert.equal(result.profiles[0].companyId, `LEI-${LEI}`)
})

test('a malformed or empty response yields nothing, never a throw', () => {
  for (const value of [null, 'x', {}, { data: null }, { data: 'x' }, []]) {
    const result = mapGleifSearchResponse(value, VERIFIED_AT)
    assert.deepEqual(result.profiles, [])
    assert.deepEqual(result.rejected, [])
  }
})

test('mapping is deterministic', () => {
  const first = mapGleifSearchResponse({ data: [activeRecord()] }, VERIFIED_AT)
  const second = mapGleifSearchResponse({ data: [activeRecord()] }, VERIFIED_AT)
  assert.deepEqual(first, second)
})

test('Phase 15C: mapper reports the raw record count alongside the partition', () => {
  const result = mapGleifSearchResponse({ data: [{ id: 'x' }] }, VERIFIED_AT)
  assert.equal(result.totalRecords, 1)
  assert.equal(result.profiles.length + result.rejected.length, 1)
  assert.deepEqual(mapGleifSearchResponse({ data: [] }, VERIFIED_AT).totalRecords, 0)
  assert.deepEqual(mapGleifSearchResponse({ nope: true }, VERIFIED_AT).totalRecords, 0)
})
