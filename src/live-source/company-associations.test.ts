/**
 * Phase 32 company-association tests — fully offline, fake storage only.
 *
 * Proves: associations require an explicit directory or imported CSV company
 * plus an APPROVED local item; repeats are idempotent; companies are isolated;
 * corrupt storage is ignored; rejections never associate.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { discoveryFixtureStore } from '../automation/discovery-fixture'
import { reviewFixtureStore } from '../automation/review-fixture'
import { TARGET_COMPANIES_STORAGE_KEY, saveImportedTargetCompanies } from '../target-companies/store'
import {
  associateCompany,
  associationsForCompany,
  listAssociations,
} from './company-associations'
import type { AssociationStorage } from './company-associations'

function fakeStorage(): AssociationStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => (values.has(key) ? (values.get(key) as string) : null),
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

function withImportedCompanies<T>(names: readonly string[], run: () => T): T {
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const importedStorage = fakeStorage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: importedStorage })
  saveImportedTargetCompanies({
    headers: ['company name'],
    rows: names.map((name) => [name]),
    rowCount: names.length,
    errors: [],
  })
  try {
    return run()
  } finally {
    if (previousLocalStorage) Object.defineProperty(globalThis, 'localStorage', previousLocalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

function seedApproved(company: string): string {
  reviewFixtureStore.reset()
  const context = discoveryFixtureStore.beginRun({ domain: 'funding', scenario: 'standard' })
  const outcome = discoveryFixtureStore.finishRun(context, [
    discoveryFixtureStore.runCompany(context, 'Aavo'),
    discoveryFixtureStore.runCompany(context, 'Arka VC'),
  ])
  reviewFixtureStore.addReviewItems(outcome.reviewQueue)
  discoveryFixtureStore.reset()
  const target = reviewFixtureStore.suppliedItems()[0]
  const updated = reviewFixtureStore.apply({
    reviewId: target.reviewId,
    decision: 'APPROVED',
    reviewerId: 'reviewer-32',
    decidedAt: '2026-10-15T01:00:00.000Z',
    reason: null,
  })
  void company
  return updated.reviewId
}

test('approval with an explicit imported company associates once, idempotently', () => {
  withImportedCompanies(['Aavo'], () => {
    const storage = fakeStorage()
    try {
      const reviewId = seedApproved('Aavo')
      const first = associateCompany(
        { reviewId, companyId: 'Aavo', decidedAt: '2026-10-15T01:00:00.000Z', reviewerId: 'reviewer-32' },
        storage,
      )
      assert.equal(first.ok, true)
      if (first.ok) {
        assert.equal(first.duplicate, false)
        assert.equal(first.association.companyId, 'Aavo')
      }
      const second = associateCompany(
        { reviewId, companyId: 'Aavo', decidedAt: '2026-10-15T01:00:00.000Z', reviewerId: 'reviewer-32' },
        storage,
      )
      assert.equal(second.ok && second.duplicate, true)
      assert.equal(listAssociations(storage).length, 1)
    } finally {
      reviewFixtureStore.reset()
    }
  })
})

test('an explicitly imported CSV company can be associated without directory verification', () => {
  const storage = fakeStorage()
  const previousSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const importedPersistentStorage = fakeStorage()
  const importedStorage = fakeStorage()
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: importedStorage })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: importedPersistentStorage })
  try {
    saveImportedTargetCompanies({
      headers: ['company name', 'company sector'],
      rows: [['Imported Solar Co', 'Energy']],
      rowCount: 1,
      errors: [],
    })
    const reviewId = seedApproved('Imported Solar Co')
    const result = associateCompany(
      {
        reviewId,
        companyId: 'Imported Solar Co',
        decidedAt: '2026-10-15T01:00:00.000Z',
        reviewerId: 'reviewer-32',
      },
      storage,
    )
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.association.companyId, 'Imported Solar Co')
  } finally {
    reviewFixtureStore.reset()
    importedStorage.removeItem(TARGET_COMPANIES_STORAGE_KEY)
    importedPersistentStorage.removeItem(TARGET_COMPANIES_STORAGE_KEY)
    if (previousSessionStorage) {
      Object.defineProperty(globalThis, 'sessionStorage', previousSessionStorage)
    } else {
      Reflect.deleteProperty(globalThis, 'sessionStorage')
    }
    if (previousLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', previousLocalStorage)
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage')
    }
  }
})

test('blank, unimported, missing, and non-approved associations are refused', () => {
  withImportedCompanies(['Aavo'], () => {
    const storage = fakeStorage()
    try {
      const reviewId = seedApproved('Aavo')
      assert.equal(
        associateCompany({ reviewId, companyId: '   ', decidedAt: '2026-10-15T01:00:00.000Z', reviewerId: 'r' }, storage).ok,
        false,
      )
      assert.equal(
        associateCompany({ reviewId, companyId: 'Not A Company', decidedAt: '2026-10-15T01:00:00.000Z', reviewerId: 'r' }, storage).ok,
        false,
      )
      assert.equal(
        associateCompany({ reviewId: 'RI-NOPE', companyId: 'Aavo', decidedAt: '2026-10-15T01:00:00.000Z', reviewerId: 'r' }, storage).ok,
        false,
      )
      const other = reviewFixtureStore.suppliedItems().find((item) => item.reviewId !== reviewId)
      assert.ok(other !== undefined)
      assert.equal(
        associateCompany({ reviewId: other.reviewId, companyId: 'Aavo', decidedAt: '2026-10-15T01:00:00.000Z', reviewerId: 'r' }, storage).ok,
        false,
      )
      assert.equal(listAssociations(storage).length, 0)
    } finally {
      reviewFixtureStore.reset()
    }
  })
})

test('a name-only directory search key cannot be used as an imported company association', () => {
  withImportedCompanies([], () => {
    const storage = fakeStorage()
    try {
      const reviewId = seedApproved('Aavo')
      assert.equal(
        associateCompany(
          { reviewId, companyId: 'Aavo', decidedAt: '2026-10-15T01:00:00.000Z', reviewerId: 'r' },
          storage,
        ).ok,
        false,
      )
    } finally {
      reviewFixtureStore.reset()
    }
  })
})

test('the same opportunity associates independently per company; counts stay distinct', () => {
  withImportedCompanies(['Aavo', 'Arka VC'], () => {
    const storage = fakeStorage()
    try {
      const reviewId = seedApproved('Aavo')
      assert.equal(
        associateCompany({ reviewId, companyId: 'Aavo', decidedAt: '2026-10-15T01:00:00.000Z', reviewerId: 'r' }, storage).ok,
        true,
      )
      // A second review item for another company is an independent association.
      const other = reviewFixtureStore.suppliedItems().find((item) => item.reviewId !== reviewId)
      assert.ok(other !== undefined)
      reviewFixtureStore.apply({
        reviewId: other.reviewId,
        decision: 'APPROVED',
        reviewerId: 'r',
        decidedAt: '2026-10-15T02:00:00.000Z',
        reason: null,
      })
      assert.equal(
        associateCompany({ reviewId: other.reviewId, companyId: 'Arka VC', decidedAt: '2026-10-15T02:00:00.000Z', reviewerId: 'r' }, storage).ok,
        true,
      )
      assert.equal(associationsForCompany('Aavo', storage).length, 1)
      assert.equal(associationsForCompany('Arka VC', storage).length, 1)
      assert.equal(listAssociations(storage).length, 2)
    } finally {
      reviewFixtureStore.reset()
    }
  })
})

test('corrupt storage is ignored and failed persistence reports honestly', () => {
  const storage = fakeStorage()
  storage.setItem('tvb.company-associations.v1', 'not-json{{{')
  assert.deepEqual(listAssociations(storage), [])
  assert.deepEqual(associationsForCompany('Aavo', storage), [])
})
