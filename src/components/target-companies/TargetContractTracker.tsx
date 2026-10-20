import { useState } from 'react'
import {
  loadTargetContracts,
  updateTargetContractStatus,
  type TargetContractRecord,
} from '../../target-companies/contract-selection'

export default function TargetContractTracker() {
  const [contracts, setContracts] = useState(loadTargetContracts())
  const [error, setError] = useState<string | null>(null)

  const refresh = () => setContracts(loadTargetContracts())

  return (
    <section className="page">
      <h2 className="page__title page__title--sub">Target contract tracking</h2>
      <p className="dg-note" role="note">
        Browser-persisted contracts created after an explicit award confirmation are listed here separately from the imported Vault snapshot records above.
      </p>
      {error ? <p className="rv-message rv-message--error" role="alert">{error}</p> : null}
      {contracts.length === 0 ? (
        <p>No target contracts have been created.</p>
      ) : (
        <ul>
          {contracts.map((contract) => (
            <li key={contract.contractId}>
              {contract.companyName} — {contract.opportunityTitle} — {contract.status}
              <select
                value={contract.status}
                onChange={(event) => {
                  const updated = updateTargetContractStatus(
                    contract.contractId,
                    event.target.value as TargetContractRecord['status'],
                  )
                  if (!updated) {
                    setError('The contract status could not be saved in browser storage.')
                    return
                  }
                  setError(null)
                  refresh()
                }}
              >
                <option value="draft">Draft</option>
                <option value="confirmed">Confirmed</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}