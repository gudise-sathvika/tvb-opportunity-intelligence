export const TARGET_COMPANY_DISCOVERY_HISTORY_KEY = 'tvb.target-companies.discovery-history.v1'

export function loadKnownDiscoveryIds(): Set<string> {
  try {
    if (typeof sessionStorage === 'undefined') return new Set()
    const raw = sessionStorage.getItem(TARGET_COMPANY_DISCOVERY_HISTORY_KEY)
    if (raw === null) return new Set()
    const parsed = JSON.parse(raw) as string[]
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

export function saveKnownDiscoveryIds(ids: readonly string[]): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    const known = loadKnownDiscoveryIds()
    for (const id of ids) known.add(id)
    sessionStorage.setItem(TARGET_COMPANY_DISCOVERY_HISTORY_KEY, JSON.stringify([...known]))
  } catch {
    // Ignore storage failures.
  }
}