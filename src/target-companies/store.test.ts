import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TARGET_COMPANIES_STORAGE_KEY,
  clearImportedTargetCompanies,
  loadImportedTargetCompanies,
  saveImportedTargetCompanies,
  subscribeImportedTargetCompanies,
} from './store'
import type { CsvPreview } from './csv'

interface FakeStorage extends Storage {
  values: Map<string, string>
}

function fakeStorage(): FakeStorage {
  const values = new Map<string, string>()
  return {
    values,
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

function withStorage<T>(run: (local: FakeStorage, session: FakeStorage) => T): T {
  const local = fakeStorage()
  const session = fakeStorage()
  const previousLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const previousSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session })
  try {
    return run(local, session)
  } finally {
    if (previousLocal) Object.defineProperty(globalThis, 'localStorage', previousLocal)
    else Reflect.deleteProperty(globalThis, 'localStorage')
    if (previousSession) Object.defineProperty(globalThis, 'sessionStorage', previousSession)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
}

function preview(headers: string[], rows: string[][]): CsvPreview {
  return { headers, rows, rowCount: rows.length, errors: [] }
}

test('migrates existing session imports to persistent local storage without discarding them', () => {
  withStorage((local, session) => {
    const saved = preview(['company name', 'sector'], [['ContextQA', 'AI']])
    session.setItem('tvb.target-companies.preview.v1', JSON.stringify(saved))
    assert.deepEqual(loadImportedTargetCompanies(), saved)
    assert.deepEqual(JSON.parse(local.getItem(TARGET_COMPANIES_STORAGE_KEY) ?? 'null'), saved)
    assert.notEqual(session.getItem('tvb.target-companies.preview.v1'), null)
  })
})

test('migrates legacy persistent imports without discarding the original value', () => {
  withStorage((local, _session) => {
    const saved = preview(['company name'], [['ContextQA']])
    local.setItem('tvb.target-companies.preview.v1', JSON.stringify(saved))
    assert.deepEqual(loadImportedTargetCompanies(), saved)
    assert.deepEqual(JSON.parse(local.getItem(TARGET_COMPANIES_STORAGE_KEY) ?? 'null'), saved)
    assert.notEqual(local.getItem('tvb.target-companies.preview.v1'), null)
  })
})

test('merges imports by company name, preserves existing values, and adds supplied missing fields', () => {
  withStorage(() => {
    assert.equal(
      saveImportedTargetCompanies(preview(['Company Name', 'Country'], [['ContextQA', 'US']])),
      true,
    )
    assert.equal(
      saveImportedTargetCompanies(
        preview(['company name', 'sector'], [['contextqa', 'AI'], ['Northfield', 'Robotics']]),
      ),
      true,
    )
    assert.deepEqual(loadImportedTargetCompanies(), {
      headers: ['Company Name', 'Country', 'sector'],
      rows: [
        ['ContextQA', 'US', 'AI'],
        ['Northfield', '', 'Robotics'],
      ],
      rowCount: 2,
      errors: [],
    })
  })
})

test('notifies same-tab subscribers and removes both persistent and legacy imports on explicit clear', () => {
  withStorage((local, session) => {
    let notifications = 0
    const unsubscribe = subscribeImportedTargetCompanies(() => {
      notifications += 1
    })
    try {
      assert.equal(saveImportedTargetCompanies(preview(['Company Name'], [['ContextQA']])), true)
      assert.equal(notifications, 1)
      local.setItem('tvb.target-companies.preview.v1', 'legacy')
      session.setItem('tvb.target-companies.preview.v1', 'legacy')
      assert.equal(clearImportedTargetCompanies(), true)
      assert.equal(notifications, 2)
      assert.equal(local.getItem(TARGET_COMPANIES_STORAGE_KEY), null)
      assert.equal(local.getItem('tvb.target-companies.preview.v1'), null)
      assert.equal(session.getItem('tvb.target-companies.preview.v1'), null)
    } finally {
      unsubscribe()
    }
  })
})
