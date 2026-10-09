import { Link, useSearchParams } from 'react-router-dom'
import SegmentedTabs from '../navigation/SegmentedTabs'
import type { ProcurementMatchReviewItem, ProcurementMatchReviewStatus } from '../../automation/procurement-match-review'
import { PMATCH_REVIEW_STATUSES } from '../../automation/procurement-match-review'
import {
  MATCH_REVIEW_DEMO_PARAM,
  MATCH_REVIEW_DEMO_VALUE,
} from '../../automation/match-review-source'
import { resolveProcurementMatchSource } from '../../automation/procurement-match-source'
import { MatchReviewStatusBadge } from '../match-review/MatchReviewStatusBadge'
import {
  PMATCH_PROPOSAL_STATUS_LABEL,
  PMATCH_REVIEW_FILTERS,
  PMATCH_SIGNAL_LABEL,
  RFP_LABEL,
  resolveProcurementReviewFilter,
} from './labels'

/**
 * Procurement match review queue (Phase Q).
 *
 * A scan list over the procurement match review fixture items, built from the
 * real RFB-001…003 and COMP-001…003 records: deterministic Pending / Approved /
 * Rejected counts, a status filter (Pending by default), and the fields a
 * reviewer needs to triage a row — RFP/Notice, company, proposal status,
 * matched signals, missing evidence, rule version, review status. Every row
 * links to its detail view. No scores appear anywhere.
 */
export default function ProcurementMatchReviewQueue() {
  const [params] = useSearchParams()
  const filter = resolveProcurementReviewFilter(params.get('status'))
  const source = resolveProcurementMatchSource(params.get(MATCH_REVIEW_DEMO_PARAM))

  const items: readonly ProcurementMatchReviewItem[] = source.items
  const visible = filter === 'all' ? items : items.filter((entry) => entry.reviewStatus === filter)

  const counts = {} as Record<ProcurementMatchReviewStatus, number>
  for (const status of PMATCH_REVIEW_STATUSES) counts[status] = 0
  for (const entry of items) counts[entry.reviewStatus] += 1

  const queuePath = (segment: { slug: string }): string => {
    const query = new URLSearchParams()
    if (segment.slug !== 'all') query.set('status', segment.slug)
    if (source.demo) query.set(MATCH_REVIEW_DEMO_PARAM, MATCH_REVIEW_DEMO_VALUE)
    const qs = query.toString()
    return qs ? `/procurement-match-review?${qs}` : '/procurement-match-review'
  }

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Procurement match review</h1>
        <p className="page__description">
          Human verdicts on deterministic RFP-to-company proposals. Approving a proposal only marks it
          eligible for a future Procurement Match record — nothing is created or written here.
        </p>
      </header>

      {source.demo ? (
        <div className="mr-demo" role="note" data-testid="procurement-match-review-demo-banner">
          <strong className="mr-demo__label">Demo data.</strong> These fixture proposals use
          demonstration companies and notices. They are not real matches and appear only in demo
          mode.
        </div>
      ) : null}

      <div className="statgrid review-stats" role="group" aria-label="Procurement match review summary">
        {PMATCH_REVIEW_FILTERS.filter((f) => f.status !== null).map((f) => (
          <div key={f.slug} className="stat">
            <div className="stat__count">{counts[f.status as ProcurementMatchReviewStatus]}</div>
            <div className="stat__label">{f.label}</div>
          </div>
        ))}
      </div>

      <div className="rv-filters">
        <SegmentedTabs
          label="Procurement match review filter"
          current={params.get('status') ?? 'pending'}
          segments={PMATCH_REVIEW_FILTERS.map((f) => ({
            key: f.slug,
            label: f.label,
            to: queuePath(f),
          }))}
        />
      </div>

      {visible.length === 0 && !source.demo ? (
        <div className="empty" data-testid="procurement-match-review-empty">
          <p className="empty__headline">No real procurement match proposals yet</p>
          <p className="empty__body">
            A real proposal needs a genuine company record and a genuine notice with available
            provenance, plus matching evidence to evaluate. The imported snapshot holds no company
            records, so no real proposals can be generated. Fixtures are never substituted here.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <p className="empty__headline">Nothing here needs this filter</p>
          <p className="empty__body">
            No procurement match proposals are available.
          </p>
        </div>
      ) : (
        <div className="tablewrap">
          <table className="table review-table">
            <caption>Procurement match review queue</caption>
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">RFP</th>
                <th scope="col">Proposal</th>
                <th scope="col">Matched signals</th>
                <th scope="col">Missing evidence</th>
                <th scope="col">Rules</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <ProcurementMatchReviewRow
                  key={entry.proposal.proposalId}
                  entry={entry}
                  demo={source.demo}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ProcurementMatchReviewRow({
  entry,
  demo,
}: {
  entry: ProcurementMatchReviewItem
  demo: boolean
}) {
  const matched = entry.proposal.matchedSignals.map((signal) => PMATCH_SIGNAL_LABEL[signal])
  const missing = entry.proposal.missingSignals.map((signal) => PMATCH_SIGNAL_LABEL[signal])
  const detailPath = `/procurement-match-review/${encodeURIComponent(entry.proposal.proposalId)}${
    demo ? `?${MATCH_REVIEW_DEMO_PARAM}=${MATCH_REVIEW_DEMO_VALUE}` : ''
  }`
  return (
    <tr>
      <td data-label="Company">
        <span className="recordlink">
          <Link to={detailPath} className="recordlink__name">
            {entry.companyName ?? entry.proposal.companyId}
          </Link>
        </span>
      </td>
      <td data-label="RFP">
        {entry.noticeName ?? entry.proposal.noticeId}{' '}
        <code className="idbadge">{entry.proposal.noticeId}</code>{' '}
        <span className="mr-kind">{RFP_LABEL}</span>
      </td>
      <td data-label="Proposal">{PMATCH_PROPOSAL_STATUS_LABEL[entry.proposal.status]}</td>
      <td data-label="Matched signals">{matched.length > 0 ? matched.join(', ') : '—'}</td>
      <td data-label="Missing evidence">{missing.length > 0 ? missing.join(', ') : '—'}</td>
      <td data-label="Rules">
        <code className="idbadge">{entry.proposal.ruleVersion}</code>
      </td>
      <td data-label="Status">
        <MatchReviewStatusBadge status={entry.reviewStatus} />
      </td>
    </tr>
  )
}