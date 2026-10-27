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
  if (legacyPersistent !== null) {
    if (persistent !== null) {
      try { persistent.setItem(TARGET_COMPANIES_STORAGE_KEY, JSON.stringify(legacyPersistent)) } catch {}
    }
    return legacyPersistent
  }
  if (legacySession !== null) {
    if (persistent !== null) {
      try { persistent.setItem(TARGET_COMPANIES_STORAGE_KEY, JSON.stringify(legacySession)) } catch {}
    }
    return legacySession
  }
  return null
}

export function saveImportedTargetCompanies(preview: CsvPreview): boolean {
  const persistent = browserStorage('localStorage')
  if (persistent === null) return false
  let serialized: string
  try {
    serialized = JSON.stringify({ ...preview, errors: [] })
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
