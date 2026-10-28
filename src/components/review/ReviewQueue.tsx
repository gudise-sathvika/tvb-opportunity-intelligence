import { useEffect, useMemo, useReducer } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { reviewFixtureStore } from '../../automation/review-fixture'
import SegmentedTabs from '../navigation/SegmentedTabs'
import type { ReviewStatus } from '../../automation/review-queue'
import type { DiscoveryDomain } from '../../automation/types'
import {
  REVIEW_STATUSES,
  filterReviewItemsByRun,
  paginateList,
  reviewSectionFor,
} from '../../automation/review-queue'
import type { ReviewSectionKey } from '../../automation/review-queue'
import {
  REVIEW_DEMO_PARAM,
  REVIEW_DEMO_VALUE,
  resolveReviewSource,
} from '../../automation/review-source'
import { ReviewStatusBadge } from './ReviewStatusBadge'
import { rfpDisplay } from '../vocabulary'
import {
  REVIEW_FILTERS,
  companyLabelForReview,
  deadlineOf,
  publicationDateOf,
  resolveReviewFilter,
} from './labels'
import type { ReviewItem } from '../../automation/review-queue'
import { FTS_LIVE_POOL_COMPANY_ID } from '../../live-source/live-discovery'
import { listAssociations } from '../../live-source/company-associations'
import { restoreSuppliedReviewState } from '../../live-source/review-persistence'

/** Phase 05 section split helper: canonical domain, never title text. */
function sectionFor(entry: ReviewItem): ReviewSectionKey {
  return reviewSectionFor(entry.domain)
}

const SECTION_META: Record<ReviewSectionKey, { title: string; blurb: string }> = {
  funding: {
    title: 'Funding review',
    blurb: 'Funding calls, grants and funding opportunities.',
  },
  procurement: {
    title: 'Procurement review',
    blurb: 'Tenders, RFPs and procurement notices. Unassigned rows come from shared broad discovery, not from a company match.',
  },
  unclassified: {
    title: 'Unclassified review',
    blurb: 'Records whose domain is neither funding nor procurement. Nothing here is discarded.',
  },
}

/** Phase 05: ten review items per page, per section. */
export const REVIEW_PAGE_SIZE = 10

function pageFromParam(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1
}

function statusCounts(items: readonly ReviewItem[]): Record<ReviewStatus, number> {
  const counts = {} as Record<ReviewStatus, number>
  for (const status of REVIEW_STATUSES) counts[status] = 0
  for (const entry of items) counts[entry.reviewStatus] += 1
  return counts
}

/**
 * Human review queue (Phase F brief §2, §3, §4; Phase 05 sections + pagination).
 *
 * The queue is a scan list over the Phase E review items, split into Funding,
 * Procurement and Unclassified sections by canonical domain. The status filter
 * stays a single global `status` URL parameter (deep links preserved); each
 * section filters its own items, counts every status independently, and
 * paginates independently at ten items per page. Filtering always precedes
 * pagination, and the page is clamped so a decision can never strand the
 * reviewer on an empty page while earlier items remain.
 */
/**
 * Phase 07: per-section status parameters. The legacy global `status` remains
 * honored as the default for every section (old deep links keep working); an
 * explicit section parameter wins for its own section.
 */
const SECTION_STATUS_PARAM: Record<ReviewSectionKey, string> = {
  funding: 'fundingStatus',
  procurement: 'procurementStatus',
  unclassified: 'unclassifiedStatus',
}

const SECTION_PAGE_PARAM: Record<ReviewSectionKey, string> = {
  funding: 'fundingPage',
  procurement: 'procurementPage',
  unclassified: 'unclassifiedPage',
}

/**
 * Phase 36: optional domain scoping for the dedicated Funding/Procurement
 * review routes. Scoping filters the same shared store — decisions, filters,
 * pagination, and counts all stay on one review state. Unscoped (`/review`)
 * behavior is unchanged.
 */
export default function ReviewQueue({
  domainFilter,
  title = 'Human review',
  fixedStatus,
  basePath = '/discovery',
  workspaceView = 'human-review',
}: {
  domainFilter?: DiscoveryDomain
  title?: string
  fixedStatus?: ReviewStatus
  basePath?: string
  workspaceView?: string
}) {
  const [params] = useSearchParams()
  const legacyStatus = params.get('status')
  const runId = params.get('run')
  const source = resolveReviewSource(params.get(REVIEW_DEMO_PARAM))

  // Phase 31: restore previously saved human decisions once per mount; every
  // later store change re-saves automatically and re-renders. Demo fixtures
  // stay ephemeral.
  const [, forceRender] = useReducer((version: number) => version + 1, 0)
  useEffect(() => {
    restoreSuppliedReviewState()
    const unsubscribeTick = reviewFixtureStore.subscribe(() => {
      forceRender()
    })
    forceRender()
    return () => {
      unsubscribeTick()
    }
  }, [])

  const allItems: readonly ReviewItem[] = source.items
  const runScoped: readonly ReviewItem[] = runId !== null && runId.trim() !== ''
    ? filterReviewItemsByRun(allItems, runId)
    : allItems
  const items: readonly ReviewItem[] =
    domainFilter !== undefined ? runScoped.filter((entry) => entry.domain === domainFilter) : runScoped

  const counts = useMemo(() => statusCounts(items), [items])

  const sections = useMemo(() => {
    const grouped: Record<ReviewSectionKey, ReviewItem[]> = { funding: [], procurement: [], unclassified: [] }
    for (const entry of items) grouped[sectionFor(entry)].push(entry)
    return grouped
  }, [items])

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">{title}</h1>
        <p className="page__description">
          Decisions recorded here come from the local review store — candidates are reviewed
          against their discovery evidence, and nothing is written to any record or vault file.
        </p>
      </header>

      {source.demo ? (
        <div className="mr-demo" role="note" data-testid="review-demo-banner">
          <strong className="mr-demo__label">Demo data.</strong> These are demonstration review
          candidates, not real discoveries. They appear only in demo mode.
        </div>
      ) : null}

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

      {items.length === 0 && !source.demo ? (
        <div className="empty" data-testid="review-empty">
          <p className="empty__headline">No review candidates yet</p>
          <p className="empty__body">
            Review candidates appear here after a discovery run hands them over. Demonstration
            fixtures are never shown as real candidates; they are available only in demo mode.
          </p>
        </div>
      ) : (
        <>
          {domainFilter === undefined || domainFilter === 'funding' ? (
            <ReviewSection
              section="funding"
              items={sections.funding}
              statusSlug={params.get(SECTION_STATUS_PARAM.funding) ?? legacyStatus}
              page={pageFromParam(params.get(SECTION_PAGE_PARAM.funding))}
              demo={source.demo}
              basePath={basePath}
              workspaceView={workspaceView}
              fixedStatus={fixedStatus}
            />
          ) : null}
          {domainFilter === undefined || domainFilter === 'procurement' ? (
            <ReviewSection
              section="procurement"
              items={sections.procurement}
              statusSlug={params.get(SECTION_STATUS_PARAM.procurement) ?? legacyStatus}
              page={pageFromParam(params.get(SECTION_PAGE_PARAM.procurement))}
              demo={source.demo}
              basePath={basePath}
              workspaceView={workspaceView}
              fixedStatus={fixedStatus}
            />
          ) : null}
          {domainFilter === undefined ? (
            <ReviewSection
              section="unclassified"
              items={sections.unclassified}
              statusSlug={params.get(SECTION_STATUS_PARAM.unclassified) ?? legacyStatus}
              page={pageFromParam(params.get(SECTION_PAGE_PARAM.unclassified))}
              demo={source.demo}
              basePath={basePath}
              workspaceView={workspaceView}
              fixedStatus={fixedStatus}
            />
          ) : (
            <p className="dg-note" role="note">
              Records that are neither funding nor procurement stay visible under Unclassified
              on the <Link to="/discovery?view=human-review">full Human review queue</Link>.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function ReviewSection({
  section,
  items,
  statusSlug,
  page,
  demo,
  basePath,
  workspaceView,
  fixedStatus,
}: {
  section: ReviewSectionKey
  items: readonly ReviewItem[]
  /** Raw slug for this section (already defaulted to the legacy global); null = default view. */
  statusSlug: string | null
  page: number
  demo: boolean
  basePath: string
  workspaceView: string
  fixedStatus?: ReviewStatus
}) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const meta = SECTION_META[section]
  const statusParam = SECTION_STATUS_PARAM[section]

  const filter = fixedStatus ?? resolveReviewFilter(statusSlug)
  const pageParam = SECTION_PAGE_PARAM[section]
  // Phase 15B: the run scope (if any) travels to detail pages for back-links.
  const runScope = params.get('run')
  const filtered = filter === 'all' ? items : items.filter((entry) => entry.reviewStatus === filter)
  const counts = statusCounts(items)
  const { safePage, totalPages, start, end } = paginateList(filtered.length, page, REVIEW_PAGE_SIZE)
  const pageItems = filtered.slice(start, end)

  function goToPage(next: number): void {
    const query = new URLSearchParams(params.toString())
    query.set('view', workspaceView)
    if (next <= 1) query.delete(pageParam)
    else query.set(pageParam, String(next))
    const qs = query.toString()
    navigate(qs ? `${basePath}?${qs}` : basePath)
  }

  return (
    <section aria-label={meta.title} data-testid={`review-section-${section}`}>
      <h2 className="dg-subtitle">{meta.title}</h2>
      <p className="dg-note">{meta.blurb}</p>
      {fixedStatus === undefined ? (
        <div className="rv-filters">
          <SegmentedTabs
            label={`${meta.title} filter`}
            current={statusSlug ?? 'needs-review'}
            segments={REVIEW_FILTERS.map((f) => {
              const query = new URLSearchParams(params.toString())
              query.set('view', workspaceView)
              query.set(statusParam, f.slug)
              query.delete(pageParam)
              const qs = query.toString()
              return { key: f.slug, label: f.label, to: `${basePath}?${qs}` }
            })}
          />
        </div>
      ) : null}
      <p className="dg-note" data-testid={`review-counts-${section}`}>
        {items.length} {items.length === 1 ? 'item' : 'items'}
        {REVIEW_STATUSES.map((status) => ` · ${counts[status]} ${status.toLowerCase().replace('_', ' ')}`).join('')}
      </p>

      {filtered.length === 0 ? (
        <div className="empty">
          <p className="empty__headline">Nothing here needs this filter</p>
          <p className="empty__body">No {meta.title.toLowerCase()} items are available.</p>
        </div>
      ) : (
        <>
          <div className="tablewrap">
            <table className="table review-table">
              <caption>{`Human review queue — ${meta.title}`}</caption>
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
                {pageItems.map((entry) => (
                  <ReviewRow
                    key={entry.reviewId}
                    entry={entry}
                    demo={demo}
                    runId={runScope}
                    workspaceView={workspaceView}
                    basePath={basePath}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <nav className="rv-pager" aria-label={`${meta.title} pagination`}>
            <span data-testid={`review-range-${section}`}>
              {filtered.length === 0
                ? 'Showing 0 of 0'
                : `Showing ${start + 1}–${end} of ${filtered.length}`}
            </span>
            <span data-testid={`review-page-${section}`}>
              Page {safePage} of {totalPages}
            </span>
            <button
              type="button"
              aria-label={`Previous ${meta.title.toLowerCase()} page`}
              disabled={safePage <= 1}
              onClick={() => goToPage(safePage - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              aria-label={`Next ${meta.title.toLowerCase()} page`}
              disabled={safePage >= totalPages}
              onClick={() => goToPage(safePage + 1)}
            >
              Next
            </button>
          </nav>
        </>
      )}
    </section>
  )
}

function ReviewRow({
  entry,
  demo,
  runId,
  workspaceView,
  basePath = '/discovery',
}: {
  entry: ReviewItem
  demo: boolean
  runId: string | null
  workspaceView: string
  basePath?: string
}) {
  const published = publicationDateOf(entry)
  const deadline = deadlineOf(entry)
  const duplicate = entry.duplicate?.verdict !== 'DISTINCT' ? entry.duplicate : null
  // Phase 15B: preserve the run scope so the detail page can link back to the
  // exact historical run and its run-scoped queue.
  const detailQuery = new URLSearchParams()
  if (runId !== null && runId.trim() !== '') detailQuery.set('run', runId.trim())
  if (workspaceView) detailQuery.set('view', workspaceView)
  if (demo) detailQuery.set(REVIEW_DEMO_PARAM, REVIEW_DEMO_VALUE)
  const detailQueryString = detailQuery.toString()
  const detailBasePath = basePath === '/review' ? '/review' : '/discovery/review'
  const detailPath = `${detailBasePath}/${encodeURIComponent(entry.reviewId)}${detailQueryString ? `?${detailQueryString}` : ''}`
  const association = listAssociations().find((item) => item.reviewId === entry.reviewId)
  const companyId = association?.companyId ?? entry.companyId
  return (
    <tr>
      <td data-label="Candidate">
        <span className="recordlink">
          <Link to={detailPath} className="recordlink__name">
            {entry.sourceTitle || '(untitled)'}
          </Link>
        </span>
      </td>
      <td data-label="Company">{companyLabelForReview(companyId, FTS_LIVE_POOL_COMPANY_ID)}</td>
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
