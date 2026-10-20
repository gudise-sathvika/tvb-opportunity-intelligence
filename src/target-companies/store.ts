import type { CsvPreview } from './csv'

export const TARGET_COMPANIES_STORAGE_KEY = 'tvb.target-companies.imported.v1'
const LEGACY_SESSION_STORAGE_KEY = 'tvb.target-companies.preview.v1'
const listeners = new Set<() => void>()

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(name: 'localStorage' | 'sessionStorage'): StorageLike | null {
  try {
    return typeof globalThis[name] === 'undefined' ? null : globalThis[name]
  } catch {
    return null
  }
}

function decodePreview(raw: string | null): CsvPreview | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as CsvPreview).headers) ||
      !Array.isArray((parsed as CsvPreview).rows) ||
      !(parsed as CsvPreview).headers.every((header) => typeof header === 'string') ||
      !(parsed as CsvPreview).rows.every(
        (row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'),
      )
    ) {
      return null
    }
    const preview = parsed as CsvPreview
    return {
      headers: preview.headers,
      rows: preview.rows,
      rowCount: preview.rows.length,
      errors: Array.isArray(preview.errors) ? preview.errors.filter((error) => typeof error === 'string') : [],
    }
  } catch {
    return null
  }
}

function notifyChanged(): void {
  for (const listener of listeners) listener()
}

export function loadImportedTargetCompanies(): CsvPreview | null {
  const persistent = browserStorage('localStorage')
  let legacyPersistent: CsvPreview | null = null
  if (persistent !== null) {
    const saved = decodePreview(persistent.getItem(TARGET_COMPANIES_STORAGE_KEY))
    if (saved !== null) return saved
    legacyPersistent = decodePreview(persistent.getItem(LEGACY_SESSION_STORAGE_KEY))
  }

  const session = browserStorage('sessionStorage')
  const legacySession = decodePreview(
    session?.getItem(LEGACY_SESSION_STORAGE_KEY) ??
      session?.getItem(TARGET_COMPANIES_STORAGE_KEY) ??
      null,
  )
  const legacy = legacyPersistent === null
    ? legacySession
    : legacySession === null
      ? legacyPersistent
      : mergePreviews(legacyPersistent, legacySession)
  if (legacy !== null && persistent !== null) {
    try {
      persistent.setItem(TARGET_COMPANIES_STORAGE_KEY, JSON.stringify(legacy))
    } catch {
      return legacy
    }
  }
  return legacy
}

function normalizedHeader(header: string): string {
  return header.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function companyNameIndex(headers: readonly string[]): number {
  return headers.findIndex((header) => /company.*name|^name$|legal name/i.test(header.trim()))
}

function companyName(preview: CsvPreview, row: readonly string[]): string | null {
  const index = companyNameIndex(preview.headers)
  const name = index < 0 ? '' : (row[index] ?? '').trim()
  return name === '' ? null : name.toLocaleLowerCase()
}

function mergePreviews(existing: CsvPreview | null, incoming: CsvPreview): CsvPreview {
  if (existing === null || existing.rows.length === 0) return { ...incoming, errors: [] }

  const headers = [...existing.headers]
  const indexes = new Map(headers.map((header, index) => [normalizedHeader(header), index]))
  for (const header of incoming.headers) {
    const key = normalizedHeader(header)
    if (!indexes.has(key)) {
      indexes.set(key, headers.length)
      headers.push(header)
    }
  }
  const align = (source: CsvPreview, row: readonly string[]): string[] => {
    const aligned = Array.from({ length: headers.length }, () => '')
    source.headers.forEach((header, index) => {
      const target = indexes.get(normalizedHeader(header))
      if (target !== undefined) aligned[target] = row[index] ?? ''
    })
    return aligned
  }

  const rows = existing.rows.map((row) => align(existing, row))
  const knownRows = new Map<string, number>()
  existing.rows.forEach((row, index) => {
    const name = companyName(existing, row)
    if (name !== null) knownRows.set(name, index)
  })
  for (const sourceRow of incoming.rows) {
    const row = align(incoming, sourceRow)
    const name = companyName(incoming, sourceRow)
    const existingIndex = name === null ? undefined : knownRows.get(name)
    if (existingIndex === undefined) {
      rows.push(row)
      if (name !== null) knownRows.set(name, rows.length - 1)
      continue
    }
    const prior = rows[existingIndex]
    if (prior !== undefined) {
      for (let index = 0; index < row.length; index += 1) {
        if ((prior[index] ?? '').trim() === '' && (row[index] ?? '').trim() !== '') prior[index] = row[index] ?? ''
      }
    }
  }
  return { headers, rows, rowCount: rows.length, errors: [] }
}

export function saveImportedTargetCompanies(preview: CsvPreview): boolean {
  const persistent = browserStorage('localStorage')
  if (persistent === null) return false
  let serialized: string
  try {
    const merged = mergePreviews(loadImportedTargetCompanies(), preview)
    serialized = JSON.stringify(merged)
    persistent.setItem(TARGET_COMPANIES_STORAGE_KEY, serialized)
  } catch {
    return false
  }
  notifyChanged()
  return true
}

export function subscribeImportedTargetCompanies(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === TARGET_COMPANIES_STORAGE_KEY) listener()
  }
  globalThis.addEventListener?.('storage', onStorage)
  return () => {
    listeners.delete(listener)
    globalThis.removeEventListener?.('storage', onStorage)
  }
}

export function clearImportedTargetCompanies(): boolean {
  const persistent = browserStorage('localStorage')
  if (persistent === null) return false
  try {
    const session = browserStorage('sessionStorage')
    persistent.removeItem(LEGACY_SESSION_STORAGE_KEY)
    session?.removeItem(LEGACY_SESSION_STORAGE_KEY)
    session?.removeItem(TARGET_COMPANIES_STORAGE_KEY)
    persistent.removeItem(TARGET_COMPANIES_STORAGE_KEY)
  } catch {
    return false
  }
  notifyChanged()
  return true
}
