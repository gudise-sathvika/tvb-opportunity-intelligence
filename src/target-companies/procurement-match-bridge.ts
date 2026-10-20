import type { ProcurementCompanyRecord, ProcurementSourceRecord } from '../automation/procurement-proposal'
import { proposeProcurementMatch } from '../automation/procurement-proposal'
import type { ProcurementMatchReviewItem } from '../automation/procurement-match-review'
import { createProcurementMatchReviewItem } from '../automation/procurement-match-review'
import { reviewFixtureStore } from '../automation/review-fixture'
import type { ReviewItem } from '../automation/review-queue'
import { approvedActionableReviewItems } from './match-review-bridge'
import { loadImportedTargetCompanies } from './store'
import { csvPreviewToTargetCompanies } from './profiles'

function procurementCompany(
  company: ReturnType<typeof csvPreviewToTargetCompanies>[number],
): ProcurementCompanyRecord {
  return {
    companyId: company.companyId,
    name: company.name,
    country: company.country,
    industries: company.sector ? [company.sector] : null,
    description: company.description,
    capabilities: company.capabilities,
  }
}

function procurementSource(item: ReviewItem): ProcurementSourceRecord | null {
  if (!item.sourceRecordId) return null
  return {
    recordId: item.sourceRecordId,
    recordType: 'notice',
    name: item.sourceTitle,
    country: item.normalization?.country.normalized ?? null,
    industries: item.sourceEvidence?.sectors ?? item.sourceEvidence?.categories ?? null,
    description: item.normalization?.summary.normalized ?? item.sourceTitle,
  }
}

export function buildTargetCompanyProcurementMatchReviewItems(
  createdAt: string,
  now = createdAt,
  reviewItems: readonly ReviewItem[] = reviewFixtureStore.suppliedItems(),
  imported = loadImportedTargetCompanies(),
): ProcurementMatchReviewItem[] {
  if (!imported) return []
  const approved = approvedActionableReviewItems(reviewItems, 'procurement', now)
  const companies = csvPreviewToTargetCompanies(imported).map(procurementCompany)
  const proposals: ProcurementMatchReviewItem[] = []

  for (const item of approved) {
    const source = procurementSource(item)
    if (!source) continue
    for (const company of companies) {
      const proposal = proposeProcurementMatch(source, company)
      proposals.push(
        createProcurementMatchReviewItem(proposal, {
          noticeName: item.sourceTitle,
          companyName: company.name ?? null,
          noticeSourceUrl: item.sourceUrl,
          createdAt,
        }),
      )
    }
  }

  return proposals
}
