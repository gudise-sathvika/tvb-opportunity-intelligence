/**
 * Firecrawl & Company Web Enrichment Bridge Contract.
 *
 * Defines the contract for automated website resolution, Firecrawl scraping,
 * capability/keyword extraction, and dual-jurisdiction (India + US) location detection.
 */

export const ENRICHMENT_BRIDGE_ENRICH_PATH = '/__tvb/enrichment/enrich'
export const ENRICHMENT_BRIDGE_BATCH_PATH = '/__tvb/enrichment/batch'

export interface CompanyEnrichmentRequest {
  readonly companyName: string
  readonly websiteUrl?: string | null
  readonly apiKey?: string | null
}

export interface BatchCompanyEnrichmentRequest {
  readonly companies: readonly CompanyEnrichmentRequest[]
  readonly apiKey?: string | null
}

export interface EnrichedCompanyProfile {
  readonly companyName: string
  readonly websiteUrl: string
  readonly resolvedVia: 'supplied-url' | 'search-discovery'
  readonly hqLocation: string
  readonly operatingCountries: readonly string[] // e.g. ['India', 'United States']
  readonly isMultiJurisdiction: boolean // true if company has branches in both India and US
  readonly sectors: readonly string[]
  readonly capabilities: readonly string[]
  readonly entityType: string
  readonly summary: string
  readonly rawMarkdownPreview?: string
}

export interface CompanyEnrichmentResponse {
  readonly ok: boolean
  readonly status: number
  readonly profile: EnrichedCompanyProfile | null
  readonly errors?: readonly string[]
}

export interface BatchCompanyEnrichmentResponse {
  readonly ok: boolean
  readonly status: number
  readonly profiles: readonly EnrichedCompanyProfile[]
  readonly errors?: readonly string[]
}
