import type { TargetOpportunityType, TargetRelevanceOutcome, TargetRelevanceResult } from '../../target-companies/matching'
import type { OpportunityAssessmentGroup } from '../../target-companies/live-discovery'

export interface MatrixCellData {
  readonly companyName: string
  readonly assessment: TargetRelevanceResult | null
  readonly score: number | null
  readonly formattedPercentage: string
  readonly outcome: TargetRelevanceOutcome | null
  readonly isTopMatch: boolean
}

export interface MatrixRowData {
  readonly key: string
  readonly opportunityId: string
  readonly opportunityTitle: string
  readonly source: string
  readonly opportunityType: TargetOpportunityType
  readonly sourceUrl: string
  readonly deadline: string | null
  readonly status: string | null
  readonly highestScore: number | null
  readonly lowestScore: number | null
  readonly topCompanies: readonly string[]
  readonly cells: readonly MatrixCellData[]
  readonly cellMap: ReadonlyMap<string, MatrixCellData>
  readonly rawGroup: OpportunityAssessmentGroup
}

export interface MatrixFilterSortOptions {
  readonly search?: string
  readonly typeFilter?: 'all' | 'funding' | 'procurement'
  readonly outcomeFilter?: string
  readonly sourceFilter?: string
  readonly companyFilter?: string
  readonly visibleCompanies?: readonly string[]
  readonly sortBy?: 'best_match' | 'lowest_match' | 'title' | 'deadline' | string
  readonly sortDirection?: 'asc' | 'desc'
}

/**
 * Format score into display string.
 * Strictly returns '—' for null, undefined, or non-numeric values.
 * Never outputs '0%' for missing scores.
 */
export function formatScorePercentage(score: number | null | undefined): string {
  if (score === null || score === undefined || typeof score !== 'number' || Number.isNaN(score)) {
    return '—'
  }
  const normalized = score <= 1 ? Math.round(score * 100) : Math.round(score)
  return `${Math.max(0, Math.min(100, normalized))}%`
}

/**
 * Returns CSS modifier for outcome badge.
 */
export function outcomeBadgeClass(outcome: TargetRelevanceOutcome | null | undefined): string {
  switch (outcome) {
    case 'relevant':
      return 'sn-tag--success'
    case 'potentially_relevant':
      return 'sn-tag--warn'
    case 'not_relevant':
      return 'sn-tag--muted'
    case 'insufficient_evidence':
      return 'sn-tag--neutral'
    default:
      return ''
  }
}

/**
 * Human-friendly outcome label.
 */
export function outcomeLabel(outcome: TargetRelevanceOutcome | null | undefined): string {
  switch (outcome) {
    case 'relevant':
      return 'Relevant'
    case 'potentially_relevant':
      return 'Potential'
    case 'not_relevant':
      return 'Not Relevant'
    case 'insufficient_evidence':
      return 'Insufficient Data'
    default:
      return '—'
  }
}

/**
 * Collect all distinct company names across all opportunity assessment groups.
 */
export function extractDistinctCompanies(groups: readonly OpportunityAssessmentGroup[]): string[] {
  const companySet = new Set<string>()
  for (const group of groups) {
    for (const assessment of group.assessments ?? []) {
      const name = assessment.companyName.trim()
      if (name) companySet.add(name)
    }
  }
  return [...companySet].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
}

/**
 * Pure transformation from OpportunityAssessmentGroups to sorted & filtered MatrixRowData.
 */
export function buildMatrixRows(
  groups: readonly OpportunityAssessmentGroup[],
  allCompanies: readonly string[],
  options: MatrixFilterSortOptions = {},
): MatrixRowData[] {
  const {
    search = '',
    typeFilter = 'all',
    outcomeFilter = 'all',
    sourceFilter = 'all',
    companyFilter = 'all',
    visibleCompanies,
    sortBy = 'best_match',
    sortDirection = 'desc',
  } = options

  const effectiveColumns = visibleCompanies && visibleCompanies.length > 0 ? visibleCompanies : allCompanies
  const query = search.trim().toLowerCase()

  const rows: MatrixRowData[] = []

  for (const group of groups) {
    // 1. Filter by category (funding / procurement)
    if (typeFilter !== 'all' && group.opportunityType !== typeFilter) {
      continue
    }

    // 2. Filter by source host
    if (sourceFilter !== 'all' && group.source.toLowerCase() !== sourceFilter.toLowerCase()) {
      continue
    }

    // 3. Search query matching
    if (query) {
      const titleMatches = group.opportunityTitle.toLowerCase().includes(query)
      const sourceMatches = group.source.toLowerCase().includes(query)
      const companyMatches = (group.assessments ?? []).some((a) => a.companyName.toLowerCase().includes(query))
      const reasonMatches = (group.assessments ?? []).some((a) => (a.reasons ?? []).some((r) => r.toLowerCase().includes(query)))
      if (!titleMatches && !sourceMatches && !companyMatches && !reasonMatches) {
        continue
      }
    }

    // 4. Build map of assessments for this opportunity
    const assessmentByCompany = new Map<string, TargetRelevanceResult>()
    for (const assessment of group.assessments ?? []) {
      assessmentByCompany.set(assessment.companyName.toLowerCase(), assessment)
    }

    // 5. Filter by company if single company filter is set
    if (companyFilter !== 'all') {
      const targetAssessment = assessmentByCompany.get(companyFilter.toLowerCase())
      if (!targetAssessment) continue
    }

    // 6. Filter by outcome if outcome filter is set
    if (outcomeFilter !== 'all') {
      const matchesOutcome = effectiveColumns.some((col) => {
        const a = assessmentByCompany.get(col.toLowerCase())
        return a?.outcome === outcomeFilter
      })
      if (!matchesOutcome) continue
    }

    // 7. Calculate highest and lowest numeric scores across visible columns
    let highestScore: number | null = null
    let lowestScore: number | null = null

    for (const col of effectiveColumns) {
      const a = assessmentByCompany.get(col.toLowerCase())
      if (a && typeof a.score === 'number' && !Number.isNaN(a.score)) {
        if (highestScore === null || a.score > highestScore) highestScore = a.score
        if (lowestScore === null || a.score < lowestScore) lowestScore = a.score
      }
    }

    // Determine companies that have the top score (only when score > 0)
    const topCompanies: string[] = []
    if (highestScore !== null && highestScore > 0) {
      for (const col of effectiveColumns) {
        const a = assessmentByCompany.get(col.toLowerCase())
        if (a && a.score === highestScore) {
          topCompanies.push(col)
        }
      }
    }

    // 8. Build cells
    const cells: MatrixCellData[] = []
    const cellMap = new Map<string, MatrixCellData>()

    for (const col of effectiveColumns) {
      const a = assessmentByCompany.get(col.toLowerCase()) ?? null
      const score = a && typeof a.score === 'number' ? a.score : null
      const formatted = formatScorePercentage(score)
      const isTop = topCompanies.includes(col)

      const cellData: MatrixCellData = {
        companyName: col,
        assessment: a,
        score,
        formattedPercentage: formatted,
        outcome: a ? a.outcome : null,
        isTopMatch: isTop,
      }

      cells.push(cellData)
      cellMap.set(col.toLowerCase(), cellData)
    }

    const firstAssessment = group.assessments[0]

    rows.push({
      key: group.key,
      opportunityId: group.opportunityId,
      opportunityTitle: group.opportunityTitle,
      source: group.source,
      opportunityType: group.opportunityType,
      sourceUrl: firstAssessment?.sourceUrl ?? '',
      deadline: firstAssessment?.deadline ?? null,
      status: firstAssessment?.status ?? null,
      highestScore,
      lowestScore,
      topCompanies,
      cells,
      cellMap,
      rawGroup: group,
    })
  }

  // 9. Sort rows
  return sortMatrixRows(rows, sortBy, sortDirection)
}

/**
 * Sorts matrix rows according to sort criteria.
 */
export function sortMatrixRows(
  rows: MatrixRowData[],
  sortBy: string,
  sortDirection: 'asc' | 'desc' = 'desc',
): MatrixRowData[] {
  const dir = sortDirection === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    if (sortBy === 'title') {
      return dir * a.opportunityTitle.localeCompare(b.opportunityTitle, 'en', { sensitivity: 'base' })
    }

    if (sortBy === 'deadline') {
      const dateA = a.deadline ? new Date(a.deadline).getTime() : 0
      const dateB = b.deadline ? new Date(b.deadline).getTime() : 0
      return dir * (dateA - dateB)
    }

    if (sortBy === 'lowest_match') {
      const scoreA = a.lowestScore ?? 9999
      const scoreB = b.lowestScore ?? 9999
      return dir * (scoreA - scoreB)
    }

    if (sortBy.startsWith('company:')) {
      const targetCompany = sortBy.replace('company:', '').toLowerCase()
      const scoreA = a.cellMap.get(targetCompany)?.score ?? -1
      const scoreB = b.cellMap.get(targetCompany)?.score ?? -1
      if (scoreA !== scoreB) {
        return dir * (scoreA - scoreB)
      }
      return a.opportunityTitle.localeCompare(b.opportunityTitle)
    }

    // Default: 'best_match' (highest score descending)
    const scoreA = a.highestScore ?? -1
    const scoreB = b.highestScore ?? -1
    if (scoreA !== scoreB) {
      return dir * (scoreA - scoreB)
    }
    return a.opportunityTitle.localeCompare(b.opportunityTitle)
  })
}
