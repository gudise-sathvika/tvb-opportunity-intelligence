import test from 'node:test'
import assert from 'node:assert/strict'
import type { OpportunityAssessmentGroup } from '../../target-companies/live-discovery'
import type { TargetRelevanceResult } from '../../target-companies/matching'
import {
  buildMatrixRows,
  extractDistinctCompanies,
  formatScorePercentage,
} from './match-matrix-model'

function mockAssessment(overrides: Partial<TargetRelevanceResult>): TargetRelevanceResult {
  return {
    companyId: overrides.companyId ?? 'comp-1',
    companyName: overrides.companyName ?? 'Company Alpha',
    opportunityId: overrides.opportunityId ?? 'opp-1',
    opportunityTitle: overrides.opportunityTitle ?? 'Opportunity One',
    opportunityType: overrides.opportunityType ?? 'funding',
    sourceUrl: overrides.sourceUrl ?? 'https://grants.example.com/1',
    outcome: overrides.outcome ?? 'relevant',
    score: overrides.score !== undefined ? overrides.score : 0.85,
    scoreStatus: overrides.scoreStatus ?? 'SCORED',
    coverage: 1,
    factors: {
      industryAlignment: { score: 1, weight: 0.3, evidence: ['Tech'], reason: 'Matched tech' },
      capabilityAlignment: { score: 0.9, weight: 0.25, evidence: ['AI'], reason: 'Matched AI' },
      useCaseAlignment: { score: 0.8, weight: 0.2, evidence: ['Research'], reason: 'Matched research' },
      applicantEligibility: { score: 1, weight: 0.1, evidence: ['US entity'], reason: 'Eligible' },
      geography: { score: 1, weight: 0.1, evidence: ['US'], reason: 'US location' },
      companyStage: { score: 0.7, weight: 0.05, evidence: ['Early'], reason: 'Stage fit' },
    },
    matchedFields: ['sector', 'capabilities'],
    mismatchedFields: [],
    missingFields: [],
    uncertainty: [],
    reasons: ['Strong topical match for Tech and AI.'],
    deadline: '2026-12-31',
    status: 'posted',
    ...overrides,
  }
}

test('1. formatScorePercentage: displays valid scores as percentages, and missing scores strictly as em-dash (never 0%)', () => {
  assert.equal(formatScorePercentage(0.94), '94%')
  assert.equal(formatScorePercentage(1.0), '100%')
  assert.equal(formatScorePercentage(0.425), '43%')
  assert.equal(formatScorePercentage(85), '85%')
  assert.equal(formatScorePercentage(0), '0%')

  // Missing or invalid scores MUST return '—'
  assert.equal(formatScorePercentage(null), '—')
  assert.equal(formatScorePercentage(undefined), '—')
  assert.equal(formatScorePercentage(Number.NaN), '—')
})

test('2. extractDistinctCompanies: extracts sorted distinct company names across all opportunity assessment groups', () => {
  const groups: OpportunityAssessmentGroup[] = [
    {
      key: 'opp-1',
      opportunityId: 'opp-1',
      opportunityTitle: 'Grant One',
      source: 'grants.gov',
      opportunityType: 'funding',
      assessments: [
        mockAssessment({ companyName: 'Beta Corp' }),
        mockAssessment({ companyName: 'Alpha LLC' }),
      ],
    },
    {
      key: 'opp-2',
      opportunityId: 'opp-2',
      opportunityTitle: 'Tender Two',
      source: 'ted.europa.eu',
      opportunityType: 'procurement',
      assessments: [
        mockAssessment({ companyName: 'Gamma Inc' }),
        mockAssessment({ companyName: 'Alpha LLC' }),
      ],
    },
  ]

  const distinct = extractDistinctCompanies(groups)
  assert.deepEqual(distinct, ['Alpha LLC', 'Beta Corp', 'Gamma Inc'])
})

test('3. Correct company-to-opportunity cell mapping and different scores for different companies on the same opportunity', () => {
  const opp1Assessments = [
    mockAssessment({ companyName: 'Alpha LLC', score: 0.95, outcome: 'relevant' }),
    mockAssessment({ companyName: 'Beta Corp', score: 0.42, outcome: 'potentially_relevant' }),
    mockAssessment({ companyName: 'Gamma Inc', score: null, outcome: 'insufficient_evidence' }),
  ]

  const groups: OpportunityAssessmentGroup[] = [
    {
      key: 'opp-1',
      opportunityId: 'opp-1',
      opportunityTitle: 'AI Research Grant',
      source: 'grants.gov',
      opportunityType: 'funding',
      assessments: opp1Assessments,
    },
  ]

  const columns = ['Alpha LLC', 'Beta Corp', 'Gamma Inc', 'Delta Unrelated']
  const rows = buildMatrixRows(groups, columns)

  assert.equal(rows.length, 1)
  const row = rows[0]

  assert.equal(row.opportunityTitle, 'AI Research Grant')
  assert.equal(row.cells.length, 4)

  // Cell for Alpha LLC (95%, Top Match)
  const alphaCell = row.cellMap.get('alpha llc')!
  assert.ok(alphaCell)
  assert.equal(alphaCell.score, 0.95)
  assert.equal(alphaCell.formattedPercentage, '95%')
  assert.equal(alphaCell.outcome, 'relevant')
  assert.equal(alphaCell.isTopMatch, true)

  // Cell for Beta Corp (42%, not top)
  const betaCell = row.cellMap.get('beta corp')!
  assert.ok(betaCell)
  assert.equal(betaCell.score, 0.42)
  assert.equal(betaCell.formattedPercentage, '42%')
  assert.equal(betaCell.outcome, 'potentially_relevant')
  assert.equal(betaCell.isTopMatch, false)

  // Cell for Gamma Inc (null score -> '—')
  const gammaCell = row.cellMap.get('gamma inc')!
  assert.ok(gammaCell)
  assert.equal(gammaCell.score, null)
  assert.equal(gammaCell.formattedPercentage, '—')
  assert.equal(gammaCell.outcome, 'insufficient_evidence')
  assert.equal(gammaCell.isTopMatch, false)

  // Cell for Delta Unrelated (no assessment for this company -> '—')
  const deltaCell = row.cellMap.get('delta unrelated')!
  assert.ok(deltaCell)
  assert.equal(deltaCell.assessment, null)
  assert.equal(deltaCell.score, null)
  assert.equal(deltaCell.formattedPercentage, '—')
  assert.equal(deltaCell.outcome, null)
  assert.equal(deltaCell.isTopMatch, false)

  // Highest and lowest score summary on row
  assert.equal(row.highestScore, 0.95)
  assert.equal(row.lowestScore, 0.42)
  assert.deepEqual(row.topCompanies, ['Alpha LLC'])
})

test('4. Filtering by category, search query, outcome, and column visibility', () => {
  const groups: OpportunityAssessmentGroup[] = [
    {
      key: 'opp-funding',
      opportunityId: 'opp-1',
      opportunityTitle: 'Biomedical Innovation Call',
      source: 'grants.gov',
      opportunityType: 'funding',
      assessments: [
        mockAssessment({ companyName: 'Alpha LLC', score: 0.9, outcome: 'relevant' }),
        mockAssessment({ companyName: 'Beta Corp', score: 0.2, outcome: 'not_relevant' }),
      ],
    },
    {
      key: 'opp-procurement',
      opportunityId: 'opp-2',
      opportunityTitle: 'Cloud Infrastructure Tender',
      source: 'ted.europa.eu',
      opportunityType: 'procurement',
      assessments: [
        mockAssessment({ companyName: 'Alpha LLC', score: 0.5, outcome: 'potentially_relevant' }),
        mockAssessment({ companyName: 'Beta Corp', score: 0.88, outcome: 'relevant' }),
      ],
    },
  ]

  const allCompanies = ['Alpha LLC', 'Beta Corp']

  // Category filter: funding only
  const fundingRows = buildMatrixRows(groups, allCompanies, { typeFilter: 'funding' })
  assert.equal(fundingRows.length, 1)
  assert.equal(fundingRows[0].opportunityId, 'opp-1')

  // Search filter: 'infrastructure'
  const searchRows = buildMatrixRows(groups, allCompanies, { search: 'infrastructure' })
  assert.equal(searchRows.length, 1)
  assert.equal(searchRows[0].opportunityId, 'opp-2')

  // Outcome filter: 'not_relevant'
  const outcomeRows = buildMatrixRows(groups, allCompanies, { outcomeFilter: 'not_relevant' })
  assert.equal(outcomeRows.length, 1)
  assert.equal(outcomeRows[0].opportunityId, 'opp-1')

  // Column visibility subset: only 'Beta Corp' visible
  const betaOnlyRows = buildMatrixRows(groups, allCompanies, { visibleCompanies: ['Beta Corp'] })
  assert.equal(betaOnlyRows.length, 2)
  assert.equal(betaOnlyRows[0].cells.length, 1)
  assert.equal(betaOnlyRows[0].cells[0].companyName, 'Beta Corp')
})

test('5. Sorting: Best Match, Title, Deadline, and by specific Company column', () => {
  const groups: OpportunityAssessmentGroup[] = [
    {
      key: 'opp-low',
      opportunityId: 'opp-low',
      opportunityTitle: 'Zebra Research (Low Fit)',
      source: 'grants.gov',
      opportunityType: 'funding',
      assessments: [
        mockAssessment({ companyName: 'Alpha LLC', score: 0.3, deadline: '2026-12-01' }),
        mockAssessment({ companyName: 'Beta Corp', score: 0.2, deadline: '2026-12-01' }),
      ],
    },
    {
      key: 'opp-high',
      opportunityId: 'opp-high',
      opportunityTitle: 'Apple Genomics (High Fit)',
      source: 'grants.gov',
      opportunityType: 'funding',
      assessments: [
        mockAssessment({ companyName: 'Alpha LLC', score: 0.95, deadline: '2026-06-01' }),
        mockAssessment({ companyName: 'Beta Corp', score: 0.1, deadline: '2026-06-01' }),
      ],
    },
    {
      key: 'opp-beta-favored',
      opportunityId: 'opp-beta',
      opportunityTitle: 'Beta Specialized Project',
      source: 'grants.gov',
      opportunityType: 'funding',
      assessments: [
        mockAssessment({ companyName: 'Alpha LLC', score: 0.4, deadline: '2026-08-01' }),
        mockAssessment({ companyName: 'Beta Corp', score: 0.99, deadline: '2026-08-01' }),
      ],
    },
  ]

  const companies = ['Alpha LLC', 'Beta Corp']

  // Sort by title asc
  const titleAsc = buildMatrixRows(groups, companies, { sortBy: 'title', sortDirection: 'asc' })
  assert.equal(titleAsc[0].opportunityId, 'opp-high') // Apple...
  assert.equal(titleAsc[2].opportunityId, 'opp-low')  // Zebra...

  // Sort by deadline asc
  const deadlineAsc = buildMatrixRows(groups, companies, { sortBy: 'deadline', sortDirection: 'asc' })
  assert.equal(deadlineAsc[0].opportunityId, 'opp-high') // June
  assert.equal(deadlineAsc[1].opportunityId, 'opp-beta') // August
  assert.equal(deadlineAsc[2].opportunityId, 'opp-low')  // December

  // Sort by company:Beta Corp (descending: Beta's 0.99 should be first)
  const betaSort = buildMatrixRows(groups, companies, { sortBy: 'company:Beta Corp', sortDirection: 'desc' })
  assert.equal(betaSort[0].opportunityId, 'opp-beta') // Beta score 0.99
  assert.equal(betaSort[1].opportunityId, 'opp-low')  // Beta score 0.20
  assert.equal(betaSort[2].opportunityId, 'opp-high') // Beta score 0.10
})

test('6. Consistency: Matrix uses exact same opportunities and assessments without duplication or merging', () => {
  const assessments: TargetRelevanceResult[] = [
    mockAssessment({ companyName: 'Comp A', opportunityId: 'grant-101', score: 0.8 }),
    mockAssessment({ companyName: 'Comp B', opportunityId: 'grant-101', score: 0.6 }),
    mockAssessment({ companyName: 'Comp C', opportunityId: 'grant-101', score: 0.4 }),
    mockAssessment({ companyName: 'Comp A', opportunityId: 'tender-202', score: 0.7 }),
  ]

  const groups: OpportunityAssessmentGroup[] = [
    {
      key: 'grant-101',
      opportunityId: 'grant-101',
      opportunityTitle: 'Grant 101',
      source: 'grants.gov',
      opportunityType: 'funding',
      assessments: [assessments[0], assessments[1], assessments[2]],
    },
    {
      key: 'tender-202',
      opportunityId: 'tender-202',
      opportunityTitle: 'Tender 202',
      source: 'ted.europa.eu',
      opportunityType: 'procurement',
      assessments: [assessments[3]],
    },
  ]

  const companies = extractDistinctCompanies(groups)
  assert.deepEqual(companies, ['Comp A', 'Comp B', 'Comp C'])

  const rows = buildMatrixRows(groups, companies)
  assert.equal(rows.length, 2)

  // Total opportunities matches
  assert.equal(rows.length, groups.length)

  // Total non-null assessments across matrix cells matches input assessments count
  let totalAssessedCells = 0
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.assessment !== null) totalAssessedCells++
    }
  }
  assert.equal(totalAssessedCells, assessments.length)
})
