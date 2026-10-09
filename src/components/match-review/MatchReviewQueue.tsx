import { Link, useSearchParams } from 'react-router-dom'
import SegmentedTabs from '../navigation/SegmentedTabs'
import type { MatchReviewItem, MatchReviewStatus } from '../../automation/match-review'
import { MATCH_REVIEW_STATUSES } from '../../automation/match-review'
import {
  MATCH_REVIEW_DEMO_PARAM,
  MATCH_REVIEW_DEMO_VALUE,
  resolveMatchReviewSource,
} from '../../automation/match-review-source'
import { MatchReviewStatusBadge } from './MatchReviewStatusBadge'
import {
  MATCH_REVIEW_FILTERS,
  MATCH_SIGNAL_LABEL,
  PROPOSAL_STATUS_LABEL,
  resolveMatchReviewFilter,
  sourceKindLabel,
} from './labels'

/**
 * Match review queue (Phase M).
 *
 * A scan list over the match review fixture items: deterministic Pending /
 * Approved / Rejected counts, a status filter (Pending by default), and the
 * fields a reviewer needs to triage a row — company, source record, proposal
 * status, matched signals, missing evidence, rule version, review status.
 * Every row links to its detail view. No scores appear anywhere.
 */
export default function MatchReviewQueue() {
  const [params] = useSearchParams()
  const filter = resolveMatchReviewFilter(params.get('status'))
  const source = resolveMatchReviewSource(params.get(MATCH_REVIEW_DEMO_PARAM))

  const items: readonly MatchReviewItem[] = source.items
  const visible = filter === 'all' ? items : items.filter((entry) => entry.reviewStatus === filter)

  const counts = {} as Record<MatchReviewStatus, number>
  for (const status of MATCH_REVIEW_STATUSES) counts[status] = 0
  for (const entry of items) counts[entry.reviewStatus] += 1

  const queuePath = (segment: { slug: string }): string => {
    const query = new URLSearchParams()
    if (segment.slug !== 'all') query.set('status', segment.slug)
    if (source.demo) query.set(MATCH_REVIEW_DEMO_PARAM, MATCH_REVIEW_DEMO_VALUE)
    const qs = query.toString()
    return qs ? `/match-review?${qs}` : '/match-review'
  }

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Match review</h1>
        <p className="page__description">
          Human verdicts on deterministic match proposals. Approving a proposal only marks it
          eligible for a future Match record — nothing is created or written here.
        </p>
      </header>

      {source.demo ? (
        <div className="mr-demo" role="note" data-testid="match-review-demo-banner">
          <strong className="mr-demo__label">Demo data.</strong> These fixture proposals use
          demonstration companies and opportunities. They are not real matches and appear only in
          demo mode.
        </div>
      ) : null}

      <div className="statgrid review-stats" role="group" aria-label="Match review summary">
        {MATCH_REVIEW_FILTERS.filter((f) => f.status !== null).map((f) => (
          <div key={f.slug} className="stat">
            <div className="stat__count">{counts[f.status as MatchReviewStatus]}</div>
            <div className="stat__label">{f.label}</div>
          </div>
        ))}
      </div>

      <div className="rv-filters">
        <SegmentedTabs
          label="Match review filter"
          current={params.get('status') ?? 'pending'}
          segments={MATCH_REVIEW_FILTERS.map((f) => ({
            key: f.slug,
            label: f.label,
            to: queuePath(f),
          }))}
        />
      </div>

      {visible.length === 0 && !source.demo ? (
        <div className="empty" data-testid="match-review-empty">
          <p className="empty__headline">No real match proposals yet</p>
          <p className="empty__body">
            A real proposal needs a genuine company record and a genuine opportunity record with
            available provenance, plus matching evidence to evaluate. The imported snapshot holds
            no company records, so no real proposals can be generated. Fixtures are never
            substituted here.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <p className="empty__headline">Nothing here needs this filter</p>
          <p className="empty__body">
            No match proposals are available.
          </p>
        </div>
      ) : (
        <div className="tablewrap">
          <table className="table review-table">
            <caption>Match review queue</caption>
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Source</th>
                <th scope="col">Proposal</th>
                <th scope="col">Matched signals</th>
                <th scope="col">Missing evidence</th>
                <th scope="col">Rules</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <MatchReviewRow key={entry.proposal.proposalId} entry={entry} demo={source.demo} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function MatchReviewRow({ entry, demo }: { entry: MatchReviewItem; demo: boolean }) {
  const matched = entry.proposal.matchedSignals.map((signal) => MATCH_SIGNAL_LABEL[signal])
  const missing = entry.proposal.missingSignals.map((signal) => MATCH_SIGNAL_LABEL[signal])
  const detailPath = `/match-review/${encodeURIComponent(entry.proposal.proposalId)}${
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
      <td data-label="Source">
        {entry.sourceName ?? entry.proposal.sourceRecordId}{' '}
        <code className="idbadge">{entry.proposal.sourceRecordId}</code>{' '}
        <span className="mr-kind">{sourceKindLabel(entry.proposal.sourceRecordType)}</span>
      </td>
      <td data-label="Proposal">{PROPOSAL_STATUS_LABEL[entry.proposal.status]}</td>
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
