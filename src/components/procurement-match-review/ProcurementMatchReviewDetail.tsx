import { useState } from 'react'
import { procurementMatchReviewFixtureStore } from '../../automation/procurement-match-fixture'
import type { ProcurementMatchReviewItem } from '../../automation/procurement-match-review'
import { proposeBidDecision } from '../../automation/bid-proposal-fixture'
import type { BidProposalResult } from '../../automation/bid-proposal'
import { MatchReviewStatusBadge } from '../match-review/MatchReviewStatusBadge'
import { PMATCH_PROPOSAL_STATUS_LABEL, PMATCH_SIGNAL_LABEL, RFP_LABEL } from './labels'
import BoundaryNote from '../ui/BoundaryNote'

/**
 * Procurement match proposal detail (Phase Q), extended with the Phase R Bid
 * decision for APPROVED items.
 *
 * Eight sections in the brief's order — RFP, company, procurement match
 * proposal, matched evidence, missing evidence, rule version, decision
 * history, decision controls — with Approve/Reject for pending reviews and a
 * history-only terminal state. A ninth "Bid decision" section appears ONLY on
 * APPROVED items: "Decide to Bid" / "Do Not Bid" produce a deterministic
 * dry-run Bid proposal (Phase R) and never create a Bid or Contract. The
 * business rule is stated on the page: approval means relevance, not intent to
 * bid. No scores, no confidence, no generated text.
 */
export default function ProcurementMatchReviewDetail({
  item,
  onDecided,
}: {
  item: ProcurementMatchReviewItem
  onDecided: (updated: ProcurementMatchReviewItem) => void
}) {
  const [reviewerId, setReviewerId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [deciderId, setDeciderId] = useState('')
  const [bidError, setBidError] = useState<string | null>(null)
  const [bidResult, setBidResult] = useState<BidProposalResult | null>(null)

  const decide = (decision: 'APPROVED' | 'REJECTED') => {
    const reviewer = reviewerId.trim()
    if (!reviewer) {
      setError('Enter a reviewer ID before recording a decision.')
      return
    }
    try {
      const updated = procurementMatchReviewFixtureStore.apply({
        proposalId: item.proposal.proposalId,
        decision,
        reviewerId: reviewer,
        decidedAt: new Date().toISOString(),
      })
      onDecided(updated)
      setConfirmation(`Recorded as ${decision === 'APPROVED' ? 'Approved' : 'Rejected'} by ${reviewer}.`)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The decision could not be recorded.')
    }
  }

  const recordBidDecision = (decision: 'BID' | 'DO_NOT_BID') => {
    const decider = deciderId.trim()
    if (!decider) {
      setBidError('Enter a decision maker ID before recording a bid decision.')
      return
    }
    try {
      setBidResult(
        proposeBidDecision({
          proposalId: item.proposal.proposalId,
          decision,
          deciderId: decider,
          decidedAt: new Date().toISOString(),
        }),
      )
      setBidError(null)
    } catch (cause) {
      setBidError(cause instanceof Error ? cause.message : 'The bid decision could not be recorded.')
    }
  }

  const matched = item.proposal.evidence.filter((entry) => entry.outcome === 'matched')
  const missing = item.proposal.evidence.filter((entry) => entry.outcome !== 'matched')

  return (
    <>
      {confirmation ? (
        <p className="rv-message rv-message--saved" role="status">
          {confirmation}
        </p>
      ) : null}
      <BoundaryNote compact />
      <section className="card" aria-label="RFP">
        <h2 className="card__title">1. RFP</h2>
        <dl className="fields">
          <div className="fields__row">
            <dt className="fields__key">RFP</dt>
            <dd className="fields__value">
              {item.noticeName ?? item.proposal.noticeId} <code className="idbadge">{item.proposal.noticeId}</code>{' '}
              <span className="mr-kind">{RFP_LABEL}</span>
            </dd>
          </div>
        </dl>
      </section>

      <section className="card" aria-label="Company">
        <h2 className="card__title">2. Company</h2>
        <dl className="fields">
          <div className="fields__row">
            <dt className="fields__key">Company</dt>
            <dd className="fields__value">
              {item.companyName ?? item.proposal.companyId} <code className="idbadge">{item.proposal.companyId}</code>
            </dd>
          </div>
        </dl>
      </section>

      <section className="card" aria-label="Match proposal">
        <h2 className="card__title">3. Match proposal</h2>
        <dl className="fields">
          <div className="fields__row">
            <dt className="fields__key">Proposal</dt>
            <dd className="fields__value">
              <code className="idbadge">{item.proposal.proposalId}</code>
            </dd>
          </div>
          <div className="fields__row">
            <dt className="fields__key">Proposal status</dt>
            <dd className="fields__value">{PMATCH_PROPOSAL_STATUS_LABEL[item.proposal.status]}</dd>
          </div>
          <div className="fields__row">
            <dt className="fields__key">Review status</dt>
            <dd className="fields__value">
              <MatchReviewStatusBadge status={item.reviewStatus} />
            </dd>
          </div>
        </dl>
        <p className="card__note">
          An approved proposal becomes eligible for a future Procurement Match record (PMATCH-###)
          for this RFP. No Procurement Match record is created by this review.
        </p>
      </section>

      <section className="card" aria-label="Matched evidence">
        <h2 className="card__title">4. Matched evidence</h2>
        {matched.length === 0 ? (
          <p className="dg-empty">No signal matched for this pair.</p>
        ) : (
          <ul className="mr-evidence">
            {matched.map((entry) => (
              <li key={entry.signal} className="mr-evidence__item">
                <span className="mr-evidence__signal">{PMATCH_SIGNAL_LABEL[entry.signal]}</span>
                <span className="mr-evidence__fields">
                  {entry.sourceField} → {entry.companyField}: {entry.values.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-label="Missing evidence">
        <h2 className="card__title">5. Missing evidence</h2>
        {missing.length === 0 ? (
          <p className="dg-empty">Every evaluated signal produced evidence.</p>
        ) : (
          <ul className="mr-evidence">
            {missing.map((entry) => (
              <li key={entry.signal} className="mr-evidence__item">
                <span className="mr-evidence__signal">{PMATCH_SIGNAL_LABEL[entry.signal]}</span>
                <span className="mr-evidence__fields">
                  {entry.outcome === 'mismatched'
                    ? `compared ${entry.values.join(', ')} — ${entry.note}`
                    : entry.note}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-label="Rule version">
        <h2 className="card__title">6. Rule version</h2>
        <p>
          <code className="idbadge">{item.proposal.ruleVersion}</code>
        </p>
      </section>

      <section className="card" aria-label="Decision history">
        <h2 className="card__title">7. Decision history</h2>
        {item.audit.length === 0 ? (
          <p className="dg-empty">No decisions recorded yet.</p>
        ) : (
          <ul className="mr-audit">
            {item.audit.map((entry, index) => (
              <li key={`${entry.decidedAt}:${index}`}>
                {entry.previousStatus} → {entry.newStatus} · Reviewer: {entry.reviewerId || '(blank)'} · Decided:{' '}
                {entry.decidedAt}
                {entry.reason ? ` · Reason: ${entry.reason}` : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {item.reviewStatus === 'PENDING' ? (
        <section className="card rv-decide" aria-label="Decision controls">
          <h2 className="card__title">8. Decision</h2>
          <p className="card__note">
            A reviewer identity is required before a decision is committed. Approval marks the proposal
            eligible for a future Procurement Match record; it creates nothing.
          </p>
          {error ? (
            <p className="rv-message rv-message--error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="rv-form">
            <label className="rv-field" htmlFor="pmr-reviewer">
              <span className="rv-field__label">Reviewer ID (required)</span>
              <input
                id="pmr-reviewer"
                className="rv-field__input"
                type="text"
                value={reviewerId}
                autoComplete="off"
                onChange={(event) => setReviewerId(event.target.value)}
              />
            </label>
          </div>
          <div className="rv-actions">
            <button type="button" className="btn rv-btn--approve" onClick={() => decide('APPROVED')}>
              Approve
            </button>
            <button type="button" className="btn rv-btn--reject" onClick={() => decide('REJECTED')}>
              Reject
            </button>
          </div>
        </section>
      ) : (
        <section className="card" aria-label="Terminal review">
          <h2 className="card__title">8. Decision</h2>
          <p>
            Terminal — {item.reviewStatus === 'APPROVED' ? 'approved' : 'rejected'}. The history
            above is the complete record; no further decisions are possible.
          </p>
        </section>
      )}

      {item.reviewStatus === 'APPROVED' ? (
        <section className="card rv-decide" aria-label="Bid decision">
          <h2 className="card__title">9. Bid decision</h2>
          <p className="card__note">
            Approval means this RFP is relevant to the company. A separate decision is required
            before creating a Bid. Choosing “Decide to Bid” prepares a dry-run Bid proposal —
            no Bid record and no Contract are created by this decision.
          </p>
          {bidError ? (
            <p className="rv-message rv-message--error" role="alert">
              {bidError}
            </p>
          ) : null}
          {bidResult?.outcome === 'proposed' ? (
            <div role="status">
              <p className="rv-message rv-message--saved">
                Bid proposal <code className="idbadge">{bidResult.bidId}</code> prepared — no Bid
                record was created.
              </p>
              <dl className="fields">
                <div className="fields__row">
                  <dt className="fields__key">Bid ID</dt>
                  <dd className="fields__value">
                    <code className="idbadge">{bidResult.bidId}</code>
                  </dd>
                </div>
                <div className="fields__row">
                  <dt className="fields__key">RFP</dt>
                  <dd className="fields__value">{String(bidResult.payload.notice)}</dd>
                </div>
                <div className="fields__row">
                  <dt className="fields__key">Company</dt>
                  <dd className="fields__value">{String(bidResult.payload.company)}</dd>
                </div>
                <div className="fields__row">
                  <dt className="fields__key">Bid decision</dt>
                  <dd className="fields__value">{String(bidResult.payload.bid_decision)}</dd>
                </div>
                <div className="fields__row">
                  <dt className="fields__key">Eligibility status</dt>
                  <dd className="fields__value">{String(bidResult.payload.eligibility_status)}</dd>
                </div>
                <div className="fields__row">
                  <dt className="fields__key">Bid status</dt>
                  <dd className="fields__value">{String(bidResult.payload.bid_status)}</dd>
                </div>
                <div className="fields__row">
                  <dt className="fields__key">Decision date</dt>
                  <dd className="fields__value">{String(bidResult.payload.bid_decision_date)}</dd>
                </div>
                <div className="fields__row">
                  <dt className="fields__key">Decided by</dt>
                  <dd className="fields__value">{String(bidResult.payload.decided_by)}</dd>
                </div>
              </dl>
              <p className="card__note">
                Still the company's manual work — reported, not invented:{' '}
                {bidResult.manualFields.join(', ')}.
              </p>
            </div>
          ) : null}
          {bidResult?.outcome === 'no_bid' ? (
            <p className="rv-message rv-message--saved" role="status">
              No-bid recorded: no Bid proposal was created for this procurement match.
            </p>
          ) : null}
          {bidResult?.outcome === 'conflict' ? (
            <p className="rv-message rv-message--error" role="alert">
              {bidResult.reason}
            </p>
          ) : null}
          {bidResult?.outcome === 'rejected' ? (
            <p className="rv-message rv-message--error" role="alert">
              {bidResult.reason}
            </p>
          ) : null}
          <div className="rv-form">
            <label className="rv-field" htmlFor="pmr-decider">
              <span className="rv-field__label">Bid decision maker ID (required)</span>
              <input
                id="pmr-decider"
                className="rv-field__input"
                type="text"
                value={deciderId}
                autoComplete="off"
                onChange={(event) => setDeciderId(event.target.value)}
              />
            </label>
          </div>
          <div className="rv-actions">
            <button type="button" className="btn rv-btn--approve" onClick={() => recordBidDecision('BID')}>
              Decide to Bid
            </button>
            <button type="button" className="btn rv-btn--block" onClick={() => recordBidDecision('DO_NOT_BID')}>
              Do Not Bid
            </button>
          </div>
        </section>
      ) : null}
    </>
  )
}