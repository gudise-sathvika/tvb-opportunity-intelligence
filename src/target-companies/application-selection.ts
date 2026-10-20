export interface TargetApplicationSelection {
  readonly companyId: string
  readonly companyName: string
  readonly opportunityId: string
  readonly opportunityTitle: string
  readonly sourceUrl: string
  readonly opportunityType: 'funding' | 'procurement'
  readonly status: 'planned' | 'in_preparation' | 'ready' | 'submitted' | 'awarded' | 'unsuccessful' | 'withdrawn'
  readonly createdAt: string
}

const STORAGE_KEY = 'tvb.target-applications.v1'

export function loadTargetApplicationSelections(): TargetApplicationSelection[] {
  try {
    if (typeof localStorage === 'undefined') return []
    let raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null && typeof sessionStorage !== 'undefined') {
      raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw !== null) {
        localStorage.setItem(STORAGE_KEY, raw)
        sessionStorage.removeItem(STORAGE_KEY)
      }
    }
    if (raw === null) return []
    const parsed = JSON.parse(raw) as TargetApplicationSelection[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveTargetApplicationSelection(selection: TargetApplicationSelection): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    const existing = loadTargetApplicationSelections()
    const duplicate = existing.some(
      (item) => item.companyId === selection.companyId && item.opportunityId === selection.opportunityId,
    )
    if (duplicate) return false
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, selection]))
    return true
  } catch {
    return false
  }
}

export function updateTargetApplicationStatus(
  companyId: string,
  opportunityId: string,
  status: TargetApplicationSelection['status'],
): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    const existing = loadTargetApplicationSelections()
    const next = existing.map((item) =>
      item.companyId === companyId && item.opportunityId === opportunityId ? { ...item, status } : item,
    )
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}