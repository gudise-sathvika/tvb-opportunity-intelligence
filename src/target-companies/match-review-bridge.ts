import { proposeMatch } from '../automation/match-proposal'
import type { MatchReviewItem, MatchReviewItemOptions } from '../automation/match-review'
import { reviewFixtureStore } from '../automation/review-fixture'
import { isActionableOpen } from '../automation/opportunity-status'
import type { DiscoveryCandidate } from '../automation/candidate'
import type { ReviewItem } from '../automation/review-queue'
import { loadImportedTargetCompanies } from './store'
import { csvPreviewToTargetCompanies } from './profiles'

function candidateForReviewItem(item: ReviewItem): DiscoveryCandidate {
  const normalization = item.normalization
  return {
    candidateId: item.candidateId,
    discoveryRunId: item.discoveryRunId,
    companyId: item.companyId,
    discoveryProfileId: item.discoveryProfileId,
    sourceId: item.sourceId,
    sourceRecordId: item.sourceRecordId,
    sourceUrl: item.sourceUrl,
    sourceTitle: item.sourceTitle,
    sourceSummary: normalization?.summary.normalized ?? null,
    sourcePublicationDate: normalization?.publicationDate.normalized ?? null,
    sourceDeadline: normalization?.deadline.normalized ?? null,
    sourceOrganization: normalization?.organization.normalized ?? null,
    sourceCountry: normalization?.country.normalized ?? null,
    sourceRawType: normalization?.rawType.normalized ?? null,
    sourceStatus: normalization?.sourceStatus.normalized ?? null,
    domain: item.domain,
    candidateType: item.candidateType,
    candidateStatus: item.candidateStatus,
    provenance: item.provenance,
    sourceEvidence: item.sourceEvidence,
    normalization: item.normalization,
    classification: item.classification,
    duplicate: item.duplicate,
  }
}

export function approvedActionableReviewItems(
  items: readonly ReviewItem[],
  domain: 'funding' | 'procurement',
  now: string,
): ReviewItem[] {
  const seenSources = new Set<string>()
  const approved: ReviewItem[] = []
  for (const item of items) {
    if (item.reviewStatus !== 'APPROVED' || item.domain !== domain) continue
    const identity = `${item.sourceId}:${item.sourceRecordId ?? item.sourceUrl}`
    if (seenSources.has(identity)) continue
    if (!isActionableOpen(candidateForReviewItem(item), now)) continue
    seenSources.add(identity)
    approved.push(item)
  }
  return approved
}

export function buildTargetCompanyMatchReviewItems(
  createdAt: string,
  now = createdAt,
  reviewItems: readonly ReviewItem[] = reviewFixtureStore.suppliedItems(),
  imported = loadImportedTargetCompanies(),
): MatchReviewItem[] {
  if (!imported) return []
  const approved = approvedActionableReviewItems(reviewItems, 'funding', now)
  if (approved.length === 0) return []

  const companies = csvPreviewToTargetCompanies(imported)
  const items: MatchReviewItem[] = []

  for (const approvedItem of approved) {
    for (const company of companies) {
      const proposal = proposeMatch(
        {
          recordId: approvedItem.sourceRecordId ?? approvedItem.candidateId,
          recordType: 'opportunity',
          name: approvedItem.sourceTitle,
          country: approvedItem.normalization?.country.normalized ?? null,
          industries: approvedItem.sourceEvidence?.sectors ?? approvedItem.sourceEvidence?.categories ?? null,
          description: approvedItem.normalization?.summary.normalized ?? approvedItem.sourceTitle,
        },
        {
          companyId: company.companyId,
          name: company.name,
          country: company.country,
          industries: company.sector ? [company.sector] : null,
          description: company.description,
          capabilities: company.capabilities,
        },
      )
      const options: MatchReviewItemOptions = {
        companyName: company.name,
        sourceName: approvedItem.sourceTitle,
        sourceUrl: approvedItem.sourceUrl,
        createdAt,
      }
      items.push({
        proposal,
        companyName: options.companyName ?? null,
        sourceName: options.sourceName ?? null,
        sourceUrl: options.sourceUrl ?? null,
        reviewStatus: 'PENDING',
        audit: [],
        createdAt: options.createdAt,
        updatedAt: options.createdAt,
      })
    }
  }

  return items
}