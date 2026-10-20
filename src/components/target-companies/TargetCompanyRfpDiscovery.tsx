import { useState } from 'react'
import { TED_BRIDGE_SEARCH_PATH } from '../../live-source/ted-bridge/contract'
import type { TedBridgeSearchResponse } from '../../live-source/ted-bridge/contract'
import { loadImportedTargetCompanies } from '../../target-companies/store'
import { csvPreviewToTargetCompanies } from '../../target-companies/profiles'
import { runTargetCompanyTedDiscovery } from '../../target-companies/live-discovery'
import type { TargetCompanyLiveDiscoveryResult } from '../../target-companies/live-discovery'

export default function TargetCompanyRfpDiscovery() {
  const imported = loadImportedTargetCompanies()
  const profiles = imported ? csvPreviewToTargetCompanies(imported) : []
  const [selected, setSelected] = useState<Set<string>>(() => new Set(profiles.map((profile) => profile.companyId)))
  const [results, setResults] = useState<TargetCompanyLiveDiscoveryResult[]>([])
  const [running, setRunning] = useState(false)

  if (profiles.length === 0) return null

  const toggle = (companyId: string) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(companyId)) next.delete(companyId)
      else next.add(companyId)
      return next
    })
  }

  const run = async () => {
    setRunning(true)
    const nextResults: TargetCompanyLiveDiscoveryResult[] = []
    for (const profile of profiles.filter((item) => selected.has(item.companyId))) {
      const requester = async (term: string): Promise<TedBridgeSearchResponse> => {
        const response = await fetch(TED_BRIDGE_SEARCH_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            runId: 'target-company-rfp-live',
            companyId: profile.companyId,
            keyword: term,
            publishedSince: '20250101',
            limit: 10,
            requestedAt: new Date().toISOString(),
          }),
        })
        return (await response.json()) as TedBridgeSearchResponse
      }
      const next = await runTargetCompanyTedDiscovery(profile, requester)
      nextResults.push(next)
    }
    setResults(nextResults)
    setRunning(false)
  }

  return (
    <section className="page" aria-labelledby="target-rfp-discovery-heading">
      <h2 className="page__title page__title--sub" id="target-rfp-discovery-heading">
        Target company RFP discovery
      </h2>
      <p className="page__description">
        Searches TED. Grants.gov and EU SEDIA are handled by the Grants discovery action.
      </p>
      <div>
        {profiles.map((profile) => (
          <label key={profile.companyId}>
            <input type="checkbox" checked={selected.has(profile.companyId)} onChange={() => toggle(profile.companyId)} />
            {profile.name}
          </label>
        ))}
      </div>
      <button type="button" className="btn" onClick={() => void run()} disabled={running || selected.size === 0}>
        Discover RFP Opportunities
      </button>
      {results.length > 0 ? (
        <>
          {results.map((result) => (
            <div key={result.profile.companyId}>
              <h3>{result.profile.name}</h3>
              <p role="status">Queries: {result.queries.join(', ') || '(broad search)'}</p>
              <p role="status">Records: {result.records.length}</p>
              <p role="status">New records: {result.newRecordCount}</p>
              <p role="status">
                Active records:{' '}
                {result.records.filter((record) => !record.deadline || record.deadline >= new Date().toISOString().slice(0, 10)).length}
              </p>
              {result.errors.length > 0 ? <p role="alert">{result.errors.join('; ')}</p> : null}
              <ul className="dg-candidates">
                {result.recommendations.map((recommendation) => (
                  <li key={recommendation.opportunityId} className="dg-candidate">
                    <a className="dg-candidate__title" href={recommendation.sourceUrl} target="_blank" rel="noreferrer">
                      {recommendation.opportunityTitle}
                    </a>
                    <span className="dg-candidate__meta">
                      {recommendation.opportunityId} · {recommendation.outcome} · deadline {recommendation.deadline ?? '—'} · status{' '}
                      {recommendation.status ?? 'unknown'}
                    </span>
                    <span className="dg-candidate__meta">{recommendation.reasons.join(' ')}</span>
                    <a className="dg-candidate__link" href={recommendation.sourceUrl} target="_blank" rel="noreferrer">
                      Official source record
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : null}
    </section>
  )
}