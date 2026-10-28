/**
 * Generates and downloads a CSV export of qualified opportunity leads
 * for target companies, strictly adhering to the schema of
 * 'V:\TVB\RFP & Grant - RFPs & Grants.csv'.
 *
 * Requirements:
 * 1. Only exports qualified leads (outcome === 'relevant' | 'potentially_relevant').
 * 2. Exact 21 columns in the reference CSV order.
 * 3. Owner defaults to 'sathvika'.
 * 4. 'Date added' and 'Last updated' are left blank.
 * 5. Fit score scaled to 1–5.
 */

import type { TargetCompanyLiveDiscoveryResult, TargetCompanyLiveDiscoveryRecord } from './live-discovery'
import type { TargetRelevanceOutcome, TargetRelevanceResult } from './matching'

export const LEADS_CSV_HEADERS = [
  'Opportunity ID',
  'Type',
  'Title',
  'Issuer / Funder',
  'Issuer type',
  'Relevant TVB related Company',
  'Description',
  'Category / Sector',
  'Geography',
  'Funding amount min (if any)',
  'Funding amount max (if any)',
  'Currency',
  'Posted date',
  'Deadline',
  'Link',
  'Source',
  'Fit score (1-5)',
  'Owner',
  'Date added',
  'Last updated',
  'Notes',
] as const

export function fitScore1to5(score: number | null, outcome: TargetRelevanceOutcome): number {
  if (score !== null && Number.isFinite(score)) {
    if (score >= 80) return 5
    if (score >= 65) return 4
    if (score >= 50) return 3
    if (score >= 35) return 2
    return 1
  }
  if (outcome === 'relevant') return 5
  if (outcome === 'potentially_relevant') return 4
  return 3
}

export function isPotentialLead(rec: TargetRelevanceResult): boolean {
  return rec.outcome === 'relevant' || rec.outcome === 'potentially_relevant'
}

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function buildOpportunityLeadRow(
  rec: TargetRelevanceResult,
  record: TargetCompanyLiveDiscoveryRecord | undefined,
  companySector?: string | null,
  owner = 'sathvika',
): string[] {
  const isProcurement = rec.opportunityType === 'procurement'
  const type = isProcurement ? 'RFP' : 'Grant'

  const sourceHost = rec.sourceUrl.toLowerCase()
  const isGrantsGov = record?.source === 'grantsgov' || sourceHost.includes('grants.gov')
  const isTed = record?.source === 'ted' || sourceHost.includes('ted.europa.eu')
  const isEu = record?.source === 'eu-sedia' || sourceHost.includes('europa.eu')

  const sourceName = isGrantsGov
    ? 'Grants.gov'
    : isTed
      ? 'TED Procurement'
      : isEu
        ? 'EU Funding & Tenders'
        : 'Public Source'

  const issuer = isGrantsGov
    ? 'US Federal Agency'
    : isTed
      ? 'European Public Procurement Authority'
      : isEu
        ? 'European Commission'
        : 'Public Authority'

  const geography = isGrantsGov
    ? 'United States'
    : isTed || isEu
      ? 'European Union'
      : 'International'

  const currency = isGrantsGov ? 'USD' : isTed || isEu ? 'EUR' : 'USD'
  const fitScore = fitScore1to5(rec.score, rec.outcome)

  const sector =
    companySector ||
    (rec.matchedFields.length > 0
      ? rec.matchedFields.map((f) => f.replace('sector/capabilities', 'Technology & Services')).join('; ')
      : 'Technology & Services')

  const description =
    record?.description ||
    (Array.isArray(rec.reasons) && rec.reasons.length > 0 ? rec.reasons.join(' ') : rec.opportunityTitle)

  const notes = Array.isArray(rec.reasons) && rec.reasons.length > 0 ? rec.reasons.join(' ') : ''

  return [
    rec.opportunityId || record?.sourceRecordId || 'N/A', // Opportunity ID
    type, // Type
    rec.opportunityTitle, // Title
    issuer, // Issuer / Funder
    'Government', // Issuer type
    rec.companyName, // Relevant TVB related Company
    description, // Description
    sector, // Category / Sector
    geography, // Geography
    '', // Funding amount min (if any)
    '', // Funding amount max (if any)
    currency, // Currency
    '', // Posted date
    rec.deadline || record?.deadline || '', // Deadline
    rec.sourceUrl, // Link
    sourceName, // Source
    String(fitScore), // Fit score (1-5)
    owner, // Owner
    '', // Date added (leave empty)
    '', // Last updated (leave empty)
    notes, // Notes
  ]
}

export interface LeadBatchInfo {
  batchIndex: number
  start: number
  end: number
  offset: number
  limit: number
  label: string
}

export function getLeadBatches(totalLeads: number, batchSize = 10): LeadBatchInfo[] {
  if (totalLeads <= 0) return []
  const batches: LeadBatchInfo[] = []
  let offset = 0
  let batchIndex = 1
  while (offset < totalLeads) {
    const start = offset + 1
    const end = Math.min(offset + batchSize, totalLeads)
    const limit = end - offset
    batches.push({
      batchIndex,
      start,
      end,
      offset,
      limit,
      label: `Leads ${start} – ${end}`,
    })
    offset += batchSize
    batchIndex++
  }
  return batches
}

export interface GenerateLeadsCsvOptions {
  offset?: number
  limit?: number
}

export function generateLeadsCsv(
  results: readonly TargetCompanyLiveDiscoveryResult[],
  owner = 'sathvika',
  options?: GenerateLeadsCsvOptions,
): string {
  const recordMap = new Map<string, TargetCompanyLiveDiscoveryRecord>()
  for (const res of results) {
    for (const r of res.records ?? []) {
      if (r.sourceRecordId) recordMap.set(r.sourceRecordId, r)
      if (r.sourceUrl) recordMap.set(r.sourceUrl, r)
    }
  }

  // Collect qualified leads
  const seen = new Set<string>()
  const leadRows: { score: number; row: string[] }[] = []

  for (const res of results) {
    const compSector = res.profile.sector ?? null
    for (const rec of res.recommendations ?? []) {
      if (!isPotentialLead(rec)) continue

      const key = `${rec.opportunityId}:${rec.companyName}`
      if (seen.has(key)) continue
      seen.add(key)

      const record = recordMap.get(rec.opportunityId) ?? recordMap.get(rec.sourceUrl)
      const score = typeof rec.score === 'number' ? rec.score : 0
      leadRows.push({
        score,
        row: buildOpportunityLeadRow(rec, record, compSector, owner),
      })
    }
  }

  // Sort by score descending (highest-fit leads first)
  leadRows.sort((a, b) => b.score - a.score)

  let selectedRows = leadRows.map((item) => item.row)
  if (typeof options?.offset === 'number' || typeof options?.limit === 'number') {
    const start = options?.offset ?? 0
    const end = typeof options?.limit === 'number' ? start + options.limit : undefined
    selectedRows = selectedRows.slice(start, end)
  }

  const allRows: string[][] = [
    [...LEADS_CSV_HEADERS],
    ...selectedRows,
  ]

  return allRows.map((r) => r.map(escapeCsvCell).join(',')).join('\r\n')
}

export function countPotentialLeads(results: readonly TargetCompanyLiveDiscoveryResult[]): number {
  const seen = new Set<string>()
  let count = 0
  for (const res of results) {
    for (const rec of res.recommendations ?? []) {
      if (isPotentialLead(rec)) {
        const key = `${rec.opportunityId}:${rec.companyName}`
        if (!seen.has(key)) {
          seen.add(key)
          count++
        }
      }
    }
  }
  return count
}

export function triggerCsvDownload(csvContent: string, fileName: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', fileName)
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export interface DownloadLeadsCsvOptions extends GenerateLeadsCsvOptions {
  batchLabel?: string
}

export function downloadLeadsCsv(
  results: readonly TargetCompanyLiveDiscoveryResult[],
  companyName?: string,
  owner = 'sathvika',
  options?: DownloadLeadsCsvOptions,
): void {
  const csvContent = generateLeadsCsv(results, owner, options)
  const cleanName = (companyName || results[0]?.profile.name || 'Target-Company')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
  const suffix = options?.batchLabel ? `-${options.batchLabel.replace(/[^a-zA-Z0-9_-]/g, '_')}` : ''
  const fileName = `${cleanName}-Opportunity-Leads${suffix}.csv`
  triggerCsvDownload(csvContent, fileName)
}
