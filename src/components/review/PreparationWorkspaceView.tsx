/**
 * Phase 33 application preparation workspace view (read + update).
 *
 * Loads the workspace for one APPROVED review item and lets the reviewer tick
 * checklist states and record notes. Everything displayed comes from the
 * review item and its evidence; readiness is computed preparation
 * bookkeeping, never eligibility. Missing/unapproved items render honest
 * error states instead of guessing.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { installReviewPersistence } from '../../live-source/review-persistence'
import {
  loadWorkspace,
  setChecklistState,
  setWorkspaceNotes,
} from '../../live-source/preparation-workspace'
import type { ChecklistItemState } from '../../live-source/preparation-workspace'
import { companyLabelForReview, deadlineOf } from './labels'
import { FTS_LIVE_POOL_COMPANY_ID } from '../../live-source/live-discovery'
import { reviewFixtureStore } from '../../automation/review-fixture'

const READINESS_LABEL: Record<string, string> = {
  ready: 'Ready for application',
  in_progress: 'In progress',
  blocked: 'Blocked by missing information',
  unknown: 'Unknown — nothing started',
}

export default function PreparationWorkspaceView({ reviewId }: { reviewId: string }) {
  const [refresh, setRefresh] = useState(0)
  const [notesDraft, setNotesDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  void refresh
  // Phase 33: restore persisted review state on direct entry (e.g. after reload).
  useEffect(() => {
    const uninstall = installReviewPersistence()
    setRefresh((version) => version + 1)
    return uninstall
  }, [reviewId])

  const loaded = loadWorkspace(reviewId.trim())
  if (!loaded.ok) {
    return (
      <section className="page">
        <h1 className="page__title">Preparation unavailable</h1>
        <div className="empty" role="alert" data-testid="prepare-missing">
          <p className="empty__headline">{loaded.error}</p>
          <p className="empty__body">
            Only an approved review item can enter application preparation. Nothing was
            created or guessed.
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
  const { workspace } = loaded
  const item = reviewFixtureStore.item(reviewId.trim())

  const mutate = (action: () => { readonly ok: true } | { readonly ok: false; readonly error: string }) => {
    const outcome = action()
    if (!outcome.ok) setError(outcome.error)
    else setError(null)
    setRefresh((version) => version + 1)
  }

  const cycleState = (state: ChecklistItemState): ChecklistItemState =>
    state === 'pending' ? 'done' : state === 'done' ? 'blocked' : 'pending'

  return (
    <section className="page">
      <nav className="crumbs" aria-label="Back">
        <Link to={`/review/${encodeURIComponent(workspace.reviewId)}`}>Back to review item</Link>{' '}
        <Link to="/companies">Back to Companies</Link>
      </nav>
      <header className="page__header">
        <h1 className="page__title">Application preparation</h1>
        <p className="page__description">
          {companyLabelForReview(workspace.companyId, FTS_LIVE_POOL_COMPANY_ID)} ·{' '}
          {item?.sourceTitle || workspace.reviewId} · readiness:{' '}
          <strong data-testid="prepare-readiness">{READINESS_LABEL[workspace.readiness] ?? workspace.readiness}</strong>
        </p>
        <p className="dg-note" role="note">
          Preparation bookkeeping only — readiness never means eligibility, and TVB never
          submits applications. {workspace.updatedAt !== null ? `Last updated ${workspace.updatedAt.slice(0, 10)}.` : 'Not started yet.'}
        </p>
      </header>

      {error !== null ? (
        <p className="rv-message rv-message--error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="card" aria-label="Preparation checklist">
        <h2 className="card__title">Checklist</h2>
        <ul className="dg-candidates">
          {workspace.items.map((check) => (
            <li key={check.id} className="dg-candidate">
              <span className="dg-candidate__title">{check.label}</span>
              {check.evidenceUrl !== null ? (
                <a className="dg-candidate__link" href={check.evidenceUrl} target="_blank" rel="noreferrer">
                  Official source
                </a>
              ) : null}
              <span className="dg-candidate__meta">State: {check.state}</span>
              <button
                type="button"
                className="btn"
                aria-label={`Advance ${check.label}`}
                onClick={() =>
                  mutate(() => setChecklistState(workspace.reviewId, check.id, cycleState(check.state)))
                }
              >
                Mark {cycleState(check.state)}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-label="Preparation notes">
        <h2 className="card__title">Notes</h2>
        <label className="rv-field" htmlFor="prepare-notes">
          <span className="rv-field__label">Preparation notes (kept with this workspace only)</span>
          <textarea
            id="prepare-notes"
            className="input rv-field__input rv-field__textarea"
            rows={3}
            value={notesDraft ?? workspace.notes}
            onChange={(event) => setNotesDraft(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          onClick={() =>
            mutate(() => {
              const next = notesDraft ?? workspace.notes
              const saved = setWorkspaceNotes(workspace.reviewId, next)
              if (saved.ok) setNotesDraft(null)
              return saved
            })
          }
        >
          Save notes
        </button>
      </section>

      {item !== undefined ? (
        <section className="card" aria-label="Official application route">
          <h2 className="card__title">Official application route</h2>
          <p>
            <a href={item.sourceUrl} target="_blank" rel="noreferrer noopener" className="urllink">
              Open the official {item.domain === 'funding' ? 'application' : 'submission'} page
            </a>
          </p>
          <p className="dg-note">Deadline on record: {deadlineOf(item) ?? 'unknown — verify at the source'}.</p>
        </section>
      ) : null}
    </section>
  )
}
