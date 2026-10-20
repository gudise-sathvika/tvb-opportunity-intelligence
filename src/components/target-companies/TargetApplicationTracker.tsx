import { useState } from 'react'
import {
  loadTargetApplicationSelections,
  updateTargetApplicationStatus,
  type TargetApplicationSelection,
} from '../../target-companies/application-selection'
import { createTargetContract } from '../../target-companies/contract-selection'

export default function TargetApplicationTracker({
  opportunityType,
}: {
  opportunityType: 'funding' | 'procurement'
}) {
  const [selections, setSelections] = useState(() =>
    loadTargetApplicationSelections().filter((selection) => selection.opportunityType === opportunityType),
  )
  const [error, setError] = useState<string | null>(null)

  const refresh = () =>
    setSelections(
      loadTargetApplicationSelections().filter((selection) => selection.opportunityType === opportunityType),
    )

  return (
    <section className="page">
      <h2 className="page__title page__title--sub">
        {opportunityType === 'funding' ? 'Tracked applications' : 'Tracked bids'}
      </h2>
      <p className="dg-note" role="note">
        Browser-persisted pursuits are listed here separately from the imported Vault snapshot records above.
      </p>
      {error ? <p className="rv-message rv-message--error" role="alert">{error}</p> : null}
      {selections.length === 0 ? (
        <p>No target applications or bids have been started.</p>
      ) : (
        <ul>
          {selections.map((selection) => (
            <li key={`${selection.companyId}-${selection.opportunityId}`}>
              {selection.companyName} — {selection.opportunityTitle} — {selection.opportunityType} — {selection.status}
              {selection.status === 'awarded' ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const confirmed = window.confirm('Create a contract record for this awarded application/bid?')
                    if (!confirmed) return
                    const created = createTargetContract({
                      applicationId: `${selection.companyId}:${selection.opportunityId}`,
                      companyId: selection.companyId,
                      companyName: selection.companyName,
                      opportunityId: selection.opportunityId,
                      opportunityTitle: selection.opportunityTitle,
                      sourceUrl: selection.sourceUrl,
                      status: 'draft',
                      awardConfirmedAt: new Date().toISOString(),
                    })
                    if (!created) {
                      setError('The contract could not be created. A contract may already exist for this award, or browser storage may be unavailable.')
                      return
                    }
                    setError(null)
                    refresh()
                  }}
                >
                  Create Contract
                </button>
              ) : null}
              <select
                value={selection.status}
                onChange={(event) => {
                  const updated = updateTargetApplicationStatus(
                    selection.companyId,
                    selection.opportunityId,
                    event.target.value as TargetApplicationSelection['status'],
                  )
                  if (!updated) {
                    setError('The pursuit status could not be saved in browser storage.')
                    return
                  }
                  setError(null)
                  refresh()
                }}
              >
                <option value="planned">Planned</option>
                <option value="in_preparation">In preparation</option>
                <option value="ready">Ready for submission</option>
                <option value="submitted">Submitted</option>
                <option value="awarded">Awarded</option>
                <option value="unsuccessful">Unsuccessful</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}