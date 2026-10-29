/**
 * Client-side company enrichment storage & coordinator.
 *
 * Persists Firecrawl & web enrichment profiles in localStorage so that
 * company research is cached permanently, eliminating duplicate API calls.
 */

import type { EnrichedCompanyProfile, CompanyEnrichmentRequest, CompanyEnrichmentResponse } from '../live-source/enrichment-bridge/contract'
import { ENRICHMENT_BRIDGE_ENRICH_PATH } from '../live-source/enrichment-bridge/contract'

const STORAGE_KEY = 'tvb:company-enrichment-cache'

export function loadEnrichmentCache(): Record<string, EnrichedCompanyProfile> {
  if (typeof window === 'undefined' || !window.localStorage) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, EnrichedCompanyProfile>
  } catch {
    return {}
  }
}

export function getCachedEnrichment(companyName: string): EnrichedCompanyProfile | null {
  const cache = loadEnrichmentCache()
  const key = companyName.trim().toLowerCase()
  return cache[key] ?? null
}

export function saveCachedEnrichment(profile: EnrichedCompanyProfile): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const cache = loadEnrichmentCache()
    const key = profile.companyName.trim().toLowerCase()
    cache[key] = profile
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // Ignore storage quota errors
  }
}

export async function requestCompanyEnrichment(
  req: CompanyEnrichmentRequest,
): Promise<EnrichedCompanyProfile | null> {
  const cached = getCachedEnrichment(req.companyName)
  if (cached) return cached

  try {
    const response = await fetch(ENRICHMENT_BRIDGE_ENRICH_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    if (!response.ok) return null
    const result = (await response.json()) as CompanyEnrichmentResponse
    if (result.ok && result.profile) {
      saveCachedEnrichment(result.profile)
      return result.profile
    }
    return null
  } catch {
    return null
  }
}
