/**
 * Phase 2.1 additive conversion from a temporary CSV preview into target-company
 * matching profiles. Supplied values are preserved; missing values remain null.
 * No persistence or import occurs.
 */

import type { CsvPreview } from './csv'
import type { TargetCompanyMatchInput } from './matching'
import { loadProfileCompletion } from './profile-completion'

function headerIndex(headers: readonly string[], pattern: RegExp): number {
  return headers.findIndex((header) => pattern.test(header.trim()))
}

export function csvPreviewToTargetCompanies(preview: CsvPreview): TargetCompanyMatchInput[] {
  const nameIndex = headerIndex(preview.headers, /company.*name|^name$|legal name/i)
  const countryIndex = headerIndex(preview.headers, /hq|location|country|region/i)
  const sectorIndex = headerIndex(preview.headers, /sector|industry/i)
  const urlIndex = headerIndex(preview.headers, /url|website|domain/i)
  const icpIndex = headerIndex(preview.headers, /ideal customer|icp|profile/i)

  return preview.rows.map((row, index) => {
    const name = nameIndex >= 0 ? (row[nameIndex] ?? '').trim() : ''
    const suppliedName = name || `Unnamed target company (row ${index + 2})`
    const country = countryIndex >= 0 ? (row[countryIndex] ?? '').trim() : ''
    const sector = sectorIndex >= 0 ? (row[sectorIndex] ?? '').trim() : ''
    const url = urlIndex >= 0 ? (row[urlIndex] ?? '').trim() : ''
    const icp = icpIndex >= 0 ? (row[icpIndex] ?? '').trim() : ''
    const completion = loadProfileCompletion(suppliedName)
    const capabilities = [
      ...(sector ? sector.split(/[,;]+/).map((value) => value.trim()).filter(Boolean) : []),
      ...(completion.capabilities ? completion.capabilities.split(/[,;]+/).map((value) => value.trim()).filter(Boolean) : []),
      ...(completion.productsServices ? completion.productsServices.split(/[,;]+/).map((value) => value.trim()).filter(Boolean) : []),
      ...(completion.targetIndustries ? completion.targetIndustries.split(/[,;]+/).map((value) => value.trim()).filter(Boolean) : []),
    ]
    return {
      companyId: `target-row-${index + 2}`,
      name: suppliedName,
      country: completion.deliveryCountries?.trim() || country || null,
      sector: completion.targetIndustries?.trim() || sector || null,
      capabilities: capabilities.length > 0 ? capabilities : null,
      description: [url ? `Supplied website: ${url}` : null, icp ? `Ideal customer profile: ${icp}` : null, completion.productsServices ? `Products/services: ${completion.productsServices}` : null]
        .filter(Boolean)
        .join(' ') || null,
      companyType: completion.applicantCategory?.trim() || null,
    }
  })
}