/**
 * Phase 2.1 additive conversion from a temporary CSV preview into target-company
 * matching profiles. Supplied values are preserved; missing values remain null.
 * No persistence or import occurs.
 */

import type { CsvPreview } from './csv'
import type { TargetCompanyMatchInput } from './matching'
import { loadProfileCompletion } from './profile-completion'
import { getCachedEnrichment } from './enrichment-store'

function headerIndex(headers: readonly string[], pattern: RegExp): number {
  return headers.findIndex((header) => pattern.test(header.trim()))
}

export function csvPreviewToTargetCompanies(preview: CsvPreview): TargetCompanyMatchInput[] {
  const nameIndex = headerIndex(preview.headers, /company.*name|^name$|legal name/i)
  const countryIndex = headerIndex(preview.headers, /hq|location|country|region/i)
  const sectorIndex = headerIndex(preview.headers, /sector|industry/i)
  const urlIndex = headerIndex(preview.headers, /url|website|domain/i)
  const icpIndex = headerIndex(preview.headers, /ideal customer|icp|profile/i)
  const tagsIndex = headerIndex(preview.headers, /tags?|keywords?|capabilities|agreement/i)

  return preview.rows.map((row, index) => {
    const rawName = nameIndex >= 0 ? (row[nameIndex] ?? '').trim() : ''
    const cleanName = rawName.replace(/^companies\//i, '').trim()
    const suppliedName = cleanName || `Unnamed target company (row ${index + 2})`
    let country = countryIndex >= 0 ? (row[countryIndex] ?? '').trim() : ''
    const sector = sectorIndex >= 0 ? (row[sectorIndex] ?? '').trim() : ''
    const url = urlIndex >= 0 ? (row[urlIndex] ?? '').trim() : ''
    const icp = icpIndex >= 0 ? (row[icpIndex] ?? '').trim() : ''
    const rawTags = tagsIndex >= 0 ? (row[tagsIndex] ?? '').trim() : ''

    const parsedTags = rawTags
      ? rawTags
          .split(/[\r\n,;]+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => t.replace(/^(sector|capability|market|industry|tech)\//i, '').replace(/[-_]+/g, ' ').trim())
          .filter((t) => t.length > 0 && !t.startsWith('profile/') && !t.startsWith('relationship/'))
      : []

    // If country is empty but URL has .in domain
    if (!country && (url.includes('.in/') || url.endsWith('.in'))) {
      country = 'India'
    }

    const completion = loadProfileCompletion(suppliedName)
    const enriched = getCachedEnrichment(suppliedName)
    const effectiveCountry = country || enriched?.hqLocation || completion.deliveryCountries?.trim() || null
    const effectiveSector = sector || (enriched ? enriched.sectors.join(', ') : null) || completion.targetIndustries?.trim() || (parsedTags.length > 0 ? parsedTags.slice(0, 2).join(', ') : null)
    const effectiveUrl = url || enriched?.websiteUrl || null

    const sectorParts = effectiveSector ? effectiveSector.split(/[\r\n,;]+/).map((value) => value.trim()).filter(Boolean) : []
    const isSoftwareFirm = /software|it services|digital/i.test(`${effectiveSector} ${suppliedName}`)

    // Name-derived keywords (e.g. "Datacolor AI" -> "AI")
    const nameKeywords = suppliedName
      .split(/[\s_-]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2 && !/^(the|and|pvt|ltd|inc|llc|corp|tech|technologies|services|company)$/i.test(w))

    // If no explicit tags were provided in CSV, infer foundational capabilities from software services sector
    const baselineCapabilities = parsedTags.length === 0 && (!enriched || enriched.capabilities.length === 0) && isSoftwareFirm
      ? ['Custom Web Applications', 'Cloud Architecture', 'Automated QA Testing', 'API Integration']
      : []

    const capabilities = [
      ...sectorParts,
      ...parsedTags,
      ...(enriched?.capabilities ?? []),
      ...nameKeywords,
      ...baselineCapabilities,
      ...(completion.capabilities ? completion.capabilities.split(/[,;]+/).map((value) => value.trim()).filter(Boolean) : []),
      ...(completion.productsServices ? completion.productsServices.split(/[,;]+/).map((value) => value.trim()).filter(Boolean) : []),
      ...(completion.targetIndustries ? completion.targetIndustries.split(/[,;]+/).map((value) => value.trim()).filter(Boolean) : []),
    ]

    const inferredType =
      completion.applicantCategory?.trim() ||
      enriched?.entityType ||
      (/software|services|tech|solutions|ai|data|systems|corp|pvt|ltd|inc|consulting/i.test(`${suppliedName} ${effectiveSector} ${rawTags}`)
        ? 'commercial'
        : null)

    return {
      companyId: `target-row-${index + 2}`,
      name: suppliedName,
      country: effectiveCountry,
      countries: enriched?.operatingCountries ?? null,
      website: effectiveUrl,
      sector: effectiveSector,
      capabilities: capabilities.length > 0 ? [...new Set(capabilities)] : null,
      description: [
        effectiveUrl ? `Supplied website: ${effectiveUrl}` : null,
        icp ? `Ideal customer profile: ${icp}` : null,
        enriched?.summary ? `Enriched summary: ${enriched.summary}` : null,
        parsedTags.length > 0 ? `Key capabilities: ${parsedTags.join(', ')}` : null,
        completion.productsServices ? `Products/services: ${completion.productsServices}` : null,
      ]
        .filter(Boolean)
        .join(' ') || null,
      companyType: inferredType,
    }
  })
}