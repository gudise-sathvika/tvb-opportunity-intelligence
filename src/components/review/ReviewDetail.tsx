import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import BackNavigation from '../navigation/BackNavigation'
import { reviewFixtureStore } from '../../automation/review-fixture'
import type { ReviewItem, ReviewDecisionKind } from '../../automation/review-queue'
import { TERMINAL_REVIEW_STATUSES } from '../../automation/review-queue'
import { ReviewStatusBadge } from './ReviewStatusBadge'
import VaultWritePanel from './VaultWritePanel'
import { rfpDisplay } from '../vocabulary'
import { DOMAIN_LABEL, REVIEW_STATUS_LABEL, companyNameFor, deadlineOf, publicationDateOf } from './labels'

/**
 * Review detail (Phase F brief §5, §6, §7, §8).
 *
 * Shows everything the review item actually carries — identity, source, dates,
 * classification, normalization, duplicate evidence, provenance, and decision
 * history — and, for NEEDS_REVIEW items, the Phase E decision actions
 * (Approve / Reject / Mark Duplicate / Block). Decisions are routed through the
 * real Phase E `applyReviewDecision` via the same store the queue reads, so the
 * list and the detail can never disagree. Terminal items show no actions.
 */
export default function ReviewDetailView() {
  const { reviewId } = useParams<{ reviewId: string }>()
  const [item, setItem] = useState<ReviewItem | undefined>(() => reviewFixtureStore.item(reviewId ?? ''))
  const [saved, setSaved] = useState<string | null>(null)

  const onDecided = (updated: ReviewItem, label: string) => {
    setItem(updated)
    setSaved(`Saved: ${label} — the item moved to “${label}”.`)
  }

  if (!item) {
    return (
      <section className="page">
        <h1 className="page__title">Review item not found</h1>
        <div className="empty" role="alert">
          <p className="empty__headline">No review item with ID “{reviewId}”</p>
          <p className="empty__body">
            This review id is not in the local review store. No item was created or guessed.
          </p>
          <p>
            <Link to="/review" className="btn">
              Back to Human review
            </Link>
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="page">
      <nav className="crumbs" aria-label="Back">
        <BackNavigation to="/review" label="Review queue" />
      </nav>

      <header className="page__header">
        <h1 className="page__title">{item.sourceTitle || '(untitled)'}</h1>
        <p className="page__badges">
          <ReviewStatusBadge status={item.reviewStatus} />
          <span className="badge badge--neutral">{DOMAIN_LABEL[item.domain]}</span>
          <span className="idbadge">{item.reviewId}</span>
        </p>
      </header>

      {saved ? (
        <p className="rv-message rv-message--saved page__note" role="status">
          {saved}
        </p>
      ) : null}

      <div className="cardgrid">
        <section className="card">
          <h2 className="card__title">Identity</h2>
          <dl className="fields">
            <FieldRow label="Source title" value={item.sourceTitle || '(untitled)'} />
            <FieldRow label="Company" value={companyNameFor(item.companyId)} />
            <FieldRow label="Domain" value={DOMAIN_LABEL[item.domain]} />
            <FieldRow label="Requirement type" value={rfpDisplay(item.classification?.type) ?? 'Not classified'} />
          </dl>
        </section>

        <section className="card">
          <h2 className="card__title">Source</h2>
          <dl className="fields">
            <FieldRow label="Source name" value={item.provenance.sourceName ?? item.sourceId} />
            <FieldRow label="Source record ID" value={item.sourceRecordId ?? '(none)'} />
            <div className="fields__row">
              <dt className="fields__key">Source URL</dt>
              <dd className="fields__value">
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="urllink"
                >
                  {item.sourceUrl}
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h2 className="card__title">Provenance</h2>
          <dl className="fields">
            <FieldRow label="Discovery run ID" value={item.provenance.runId} />
            <FieldRow label="Company ID" value={item.provenance.companyId} />
            <FieldRow label="Discovery profile ID" value={item.provenance.discoveryProfileId} />
            <FieldRow label="Source ID" value={item.provenance.sourceId} />
            <FieldRow label="Access state" value={item.provenance.accessState ?? '(unknown)'} />
            <FieldRow label="Observed" value={item.provenance.observedAt} />
            <FieldRow label="Stage history" value={item.provenance.stageHistory.join(', ')} />
          </dl>
        </section>

        {item.classification ? (
          <section className="card">
            <h2 className="card__title">Classification</h2>
            <dl className="fields">
              <FieldRow label="Result" value={rfpDisplay(item.classification.type) ?? 'Needs review'} />
              <FieldRow label="Confidence" value={item.classification.certainty ?? '(none)'} />
              <FieldRow label="Matched rule" value={item.classification.evidence.matchedRule} />
              <FieldRow label="Rule version" value={item.classification.evidence.ruleVersion} />
              <div className="fields__row">
                <dt className="fields__key">Title hints</dt>
                <dd className="fields__value">
                  {item.classification.evidence.titleHints.length > 0
                    ? item.classification.evidence.titleHints.join(', ')
                    : '(none)'}
                </dd>
              </div>
            </dl>
          </section>
        ) : null}

        {item.normalization ? (
          <section className="card">
            <h2 className="card__title">Normalization</h2>
            <dl className="fields">
              <FieldRow label="Status" value={item.normalization.status} />
              <FieldRow label="Rule version" value={item.normalization.ruleVersion} />
              <div className="fields__row">
                <dt className="fields__key">Changed fields</dt>
                <dd className="fields__value">
                  {item.normalization.changedFields.length > 0
                    ? item.normalization.changedFields.join(', ')
                    : '(none)'}
                </dd>
              </div>
              <div className="fields__row">
                <dt className="fields__key">Warnings</dt>
                <dd className="fields__value">
                  {item.normalization.warnings.length > 0 ? item.normalization.warnings.join('; ') : '(none)'}
                </dd>
              </div>
            </dl>
            {item.normalization.changedFields.length > 0 ? (
              <dl className="fields">
                {item.normalization.changedFields.map((name) => {
                  const pair = normalizationPairFor(item, name)
                  if (!pair) return null
                  return (
                    <FieldRow
                      key={name}
                      label={`Original ${name.replace(/^source/, '').toLowerCase()}`}
                      value={`${pair.original ?? '(blank)'} → ${pair.normalized ?? '(blank)'}`}
                    />
                  )
                })}
              </dl>
            ) : null}
          </section>
        ) : null}

        {!datesShown(item) ? null : (
          <section className="card">
            <h2 className="card__title">Dates</h2>
            <dl className="fields">
              {publicationDateOf(item) ? (
                <FieldRow label="Publication date" value={publicationDateOf(item) ?? ''} />
              ) : null}
              {deadlineOf(item) ? <FieldRow label="Deadline" value={deadlineOf(item) ?? ''} /> : null}
            </dl>
          </section>
        )}

        {item.duplicate ? (
          <section className="card">
            <h2 className="card__title">Duplicate evidence</h2>
            <dl className="fields">
              <FieldRow label="Verdict" value={item.duplicate.verdict} />
              <FieldRow label="Tier" value={String(item.duplicate.evidence.tier)} />
              <FieldRow label="Matched on" value={item.duplicate.evidence.matchedOn} />
              <FieldRow label="Other candidate ID" value={item.duplicate.evidence.otherCandidateId ?? '(none)'} />
              <FieldRow label="Title key" value={item.duplicate.evidence.titleKey ?? '(none)'} />
              <div className="fields__row">
                <dt className="fields__key">Supporting signals</dt>
                <dd className="fields__value">
                  {item.duplicate.evidence.corroboratingSignals.length > 0
                    ? item.duplicate.evidence.corroboratingSignals.join(', ')
                    : '(none)'}
                </dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section className="card">
          <h2 className="card__title">Decision history</h2>
          {item.audit.length === 0 ? (
            <p className="value value--absent">No decisions recorded yet.</p>
          ) : (
            <ul className="rv-audit">
              {item.audit.map((entry, index) => (
                <li key={index} className="rv-audit__entry">
                  <div className="rv-audit__move">
                    {REVIEW_STATUS_LABEL[entry.previousStatus]} → {REVIEW_STATUS_LABEL[entry.newStatus]}
                  </div>
                  <div className="rv-audit__meta">
                    Reviewer: {entry.reviewerId || '(blank)'} · Decided: {entry.decidedAt}
                  </div>
                  {entry.reason ? <div className="rv-audit__note">Reason: {entry.reason}</div> : null}
                  {entry.evidenceNotes ? (
                    <div className="rv-audit__note">Evidence note: {entry.evidenceNotes}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {item.reviewStatus === 'NEEDS_REVIEW' ? (
          <DecisionPanel item={item} onDecided={onDecided} />
        ) : (
          <section className="card card--muted">
            <h2 className="card__title">Decision</h2>
            <p className="rv-terminal">
              This item is {REVIEW_STATUS_LABEL[item.reviewStatus].toLowerCase()}. {TERMINAL_REVIEW_STATUSES.includes(item.reviewStatus) ? 'Terminal — no further actions.' : ''}
            </p>
          </section>
        )}

        {item.reviewStatus === 'APPROVED' ? <VaultWritePanel item={item} /> : null}
      </div>
    </section>
  )
}

function datesShown(item: ReviewItem): boolean {
  return Boolean(publicationDateOf(item) || deadlineOf(item))
}

function normalizationPairFor(
  item: ReviewItem,
  field: string,
): { original: string | null; normalized: string | null } | null {
  const n = item.normalization
  if (!n) return null
  switch (field) {
    case 'sourceTitle':
      return n.title
    case 'sourceUrl':
      return n.sourceUrl
    case 'sourceSummary':
      return n.summary
    case 'sourcePublicationDate':
      return n.publicationDate
    case 'sourceDeadline':
      return n.deadline
    case 'sourceOrganization':
      return n.organization
    case 'sourceCountry':
      return n.country
    case 'sourceRawType':
      return n.rawType
    default:
      return null
  }
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="fields__row">
      <dt className="fields__key">{label}</dt>
      <dd className="fields__value">{value || <span className="value--blank">(blank)</span>}</dd>
    </div>
  )
}

function DecisionPanel({
  item,
  onDecided,
}: {
  item: ReviewItem
  onDecided: (item: ReviewItem, label: string) => void
}) {
  const [reviewerId, setReviewerId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const decide = (decision: ReviewDecisionKind) => {
    const reviewer = reviewerId.trim()
    if (!reviewer) {
      setError('Enter a reviewer ID before recording a decision.')
      return
    }
    const evidence = note.trim() || null
    try {
      const updated = reviewFixtureStore.apply({
        reviewId: item.reviewId,
        decision,
        reviewerId: reviewer,
        decidedAt: new Date().toISOString(),
        reason: decision === 'APPROVED' ? null : evidence,
        evidenceNotes: decision === 'APPROVED' ? evidence : null,
      })
      onDecided(updated, REVIEW_STATUS_LABEL[decision])
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The decision could not be recorded.')
    }
  }

  return (
    <section className="card rv-decide">
      <h2 className="card__title">Decision</h2>
      <p className="card__note">
        A reviewer identity is required before a decision is committed. The optional note is
        preserved verbatim in the decision history.
      </p>

      <div className="rv-form">
        <label className="rv-field" htmlFor="rv-reviewer">
          <span className="rv-field__label">Reviewer ID</span>
          <input
            id="rv-reviewer"
            className="input rv-field__input"
            type="text"
            autoComplete="off"
            placeholder="e.g. your name or initials"
            value={reviewerId}
            onChange={(event) => setReviewerId(event.target.value)}
          />
        </label>
        <label className="rv-field" htmlFor="rv-note">
          <span className="rv-field__label">Reason or evidence note (optional)</span>
          <textarea
            id="rv-note"
            className="input rv-field__input rv-field__textarea"
            rows={3}
            placeholder="Why is this decision being made?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>

      <div className="rv-actions" role="group" aria-label="Record a decision">
        <button type="button" className="btn rv-btn rv-btn--approve" onClick={() => decide('APPROVED')}>
          Approve
        </button>
        <button type="button" className="btn rv-btn rv-btn--reject" onClick={() => decide('REJECTED')}>
          Reject
        </button>
        <button type="button" className="btn rv-btn rv-btn--duplicate" onClick={() => decide('DUPLICATE')}>
          Mark Duplicate
        </button>
        <button type="button" className="btn rv-btn rv-btn--block" onClick={() => decide('BLOCKED')}>
          Block
        </button>
      </div>

      {error ? (
        <p className="rv-message rv-message--error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}