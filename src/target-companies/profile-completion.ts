/**
 * Additive session-state for manager-supplied target-company profile details.
 * These fields are optional and are never inferred or enriched.
 */

export interface TargetCompanyProfileCompletion {
  readonly productsServices?: string
  readonly capabilities?: string
  readonly targetIndustries?: string
  readonly preferredOpportunityTypes?: string
  readonly deliveryCountries?: string
  readonly applicantCategory?: string
}

const STORAGE_KEY = 'tvb.target-companies.profile-completion.v1'

export function loadAllProfileCompletions(): Record<string, TargetCompanyProfileCompletion> {
  try {
    if (typeof sessionStorage === 'undefined') return {}
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as Record<string, TargetCompanyProfileCompletion>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function loadProfileCompletion(companyName: string): TargetCompanyProfileCompletion {
  return loadAllProfileCompletions()[companyName] ?? {}
}

export function saveProfileCompletion(companyName: string, completion: TargetCompanyProfileCompletion): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    const all = loadAllProfileCompletions()
    all[companyName] = completion
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // Ignore storage failures; profile completion is temporary session state.
  }
}

export function clearProfileCompletions(): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore storage failures.
  }
}