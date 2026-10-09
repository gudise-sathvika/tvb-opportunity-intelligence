import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import SegmentedTabs from '../navigation/SegmentedTabs'
import type { ReviewStatus } from '../../automation/review-queue'
import { REVIEW_STATUSES, filterReviewItemsByRun } from '../../automation/review-queue'
import { reviewFixtureStore } from '../../automation/review-fixture'
import { ReviewStatusBadge } from './ReviewStatusBadge'
import { rfpDisplay } from '../vocabulary'
import {
  REVIEW_FILTERS,
  deadlineOf,
  publicationDateOf,
  resolveReviewFilter,
} from './labels'
import type { ReviewItem } from '../../automation/review-queue'
import { getRecord, titleOf } from '../../data/selectors'

/**
 * Human review queue (Phase F brief §2, §3, §4).
 *
 * The queue is a scan list over the Phase E review items. It shows the five
 * deterministic status counts straight from the store, a status filter
 * (Needs review by default), and the fields a reviewer needs to triage a row:
 * title, company, domain, source, candidate type, status, dates, and any
 * duplicate evidence. Every row links to its review detail.
 */
export default function ReviewQueue() {
  const [params] = useSearchParams()
  const filter = resolveReviewFilter(params.get('status'))
  const runId = params.get('run')

  const allItems: readonly ReviewItem[] = reviewFixtureStore.items()
  const items: readonly ReviewItem[] = runId !== null && runId.trim() !== ''
    ? filterReviewItemsByRun(allItems, runId)
    : allItems

  const visible = filter === 'all' ? items : items.filter((entry) => entry.reviewStatus === filter)

  const counts = useMemo(() => {
    const start = {} as Record<ReviewStatus, number>
    for (const status of REVIEW_STATUSES) start[status] = 0
    for (const entry of items) start[entry.reviewStatus] += 1
    return start
  }, [items])

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Human review</h1>
        <p className="page__description">
          Decisions recorded here come from the local review store — candidates are reviewed
          against their discovery evidence, and nothing is written to any record or vault file.
        </p>
      </header>

      {runId !== null && runId.trim() !== '' ? (
        <p className="dg-note dg-banner" role="note">
          Scoped to discovery run <code className="idbadge">{runId}</code>. Seeded test fixtures and
          other runs are hidden here; remove the <code>run</code> parameter to see the full queue.
        </p>
      ) : null}

      <div className="statgrid review-stats" role="group" aria-label="Review queue summary">
        {REVIEW_FILTERS.filter((f) => f.status !== null).map((f) => (
          <div key={f.slug} className="stat">
            <div className="stat__count">{counts[f.status as ReviewStatus]}</div>
            <div className="stat__label">{f.label}</div>
          </div>
        ))}
      </div>

      <div className="rv-filters">
        <SegmentedTabs
          label="Review queue filter"
          current={params.get('status') ?? 'needs-review'}
          segments={REVIEW_FILTERS.map((f) => ({
            key: f.slug,
            label: f.label,
            to: f.slug === 'all' ? '/review' : `/review?status=${f.slug}`,
          }))}
        />
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <p className="empty__headline">Nothing here needs this filter</p>
          <p className="empty__body">
            No review items are available.
          </p>
        </div>
      ) : (
        <div className="tablewrap">
          <table className="table review-table">
            <caption>Human review queue</caption>
            <thead>
              <tr>
                <th scope="col">Candidate</th>
                <th scope="col">Company</th>
                <th scope="col">Domain</th>
                <th scope="col">Type</th>
                <th scope="col">Source</th>
                <th scope="col">Published</th>
                <th scope="col">Deadline</th>
                <th scope="col">Duplicate</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <ReviewRow key={entry.reviewId} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ReviewRow({ entry }: { entry: ReviewItem }) {
  const published = publicationDateOf(entry)
  const deadline = deadlineOf(entry)
  const duplicate = entry.duplicate?.verdict !== 'DISTINCT' ? entry.duplicate : null
  const company = getRecord(entry.companyId)
  return (
    <tr>
      <td data-label="Candidate">
        <span className="recordlink">
          <Link to={`/review/${encodeURIComponent(entry.reviewId)}`} className="recordlink__name">
            {entry.sourceTitle || '(untitled)'}
          </Link>
        </span>
      </td>
      <td data-label="Company">{company ? titleOf(company) : 'Unavailable'}</td>
      <td data-label="Domain">{entry.domain === 'funding' ? 'Funding' : 'Procurement'}</td>
      <td data-label="Type">{rfpDisplay(entry.classification?.type) ?? '—'}</td>
      <td data-label="Source">{entry.provenance.sourceName ?? entry.sourceId}</td>
      <td data-label="Published">{published ?? '—'}</td>
      <td data-label="Deadline">{deadline ?? '—'}</td>
      <td data-label="Duplicate">
        {duplicate ? (
          <span className="rv-dupe">{duplicate.verdict === 'EXACT_DUPLICATE' ? 'Exact duplicate' : 'Possible duplicate'}</span>
        ) : (
          <span aria-hidden="true">—</span>
        )}
      </td>
      <td data-label="Status">
        <ReviewStatusBadge status={entry.reviewStatus} />
      </td>
    </tr>
  )
}