import { useState } from 'react'
import { GRANTS_GOV_BRIDGE_SEARCH_PATH } from '../../live-source/grantsgov-bridge/contract'
import type { GrantsGovBridgeSearchResponse } from '../../live-source/grantsgov-bridge/contract'
import { EU_SEDIA_BRIDGE_SEARCH_PATH } from '../../live-source/eu-sedia-bridge/contract'
import { EU_PORTAL_SEARCH_URL } from '../../automation/eu-sedia-adapter'
import type { EuSediaBridgeSearchResponse } from '../../live-source/eu-sedia-bridge/contract'
import { loadImportedTargetCompanies } from '../../target-companies/store'
import { csvPreviewToTargetCompanies } from '../../target-companies/profiles'
import { runTargetCompanyDiscovery } from '../../target-companies/live-discovery'
import type { TargetCompanyLiveDiscoveryResult } from '../../target-companies/live-discovery'

export default function TargetCompanyLiveDiscovery() {
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
      const grantsRequester = async (term: string): Promise<GrantsGovBridgeSearchResponse> => {
        const response = await fetch(GRANTS_GOV_BRIDGE_SEARCH_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            runId: 'target-company-live',
            companyId: profile.companyId,
            keyword: term,
            oppStatuses: 'posted',
            limit: 100,
            requestedAt: new Date().toISOString(),
          }),
        })
        return (await response.json()) as GrantsGovBridgeSearchResponse
      }
      const euRequester = async (term: string): Promise<EuSediaBridgeSearchResponse> => {
        const response = await fetch(EU_SEDIA_BRIDGE_SEARCH_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            runId: 'target-company-live',
            companyId: profile.companyId,
            keyword: term,
            limit: 100,
            requestedAt: new Date().toISOString(),
          }),
        })
        return (await response.json()) as EuSediaBridgeSearchResponse
      }
      const next = await runTargetCompanyDiscovery(profile, grantsRequester, euRequester)
      nextResults.push(next)
    }
    setResults(nextResults)
    setRunning(false)
  }

  return (
    <section className="page" aria-labelledby="target-live-discovery-heading">
      <h2 className="page__title page__title--sub" id="target-live-discovery-heading">
        Target company live discovery
      </h2>
      <p className="page__description">
        Searches Grants.gov and EU SEDIA. TED and UK Find a Tender are not yet wired into this target-company action.
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
        Discover Opportunities
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
              <p role="status">
                Expired/closed records:{' '}
                {result.records.filter((record) => record.deadline && record.deadline < new Date().toISOString().slice(0, 10)).length}
              </p>
              <ul>
                {result.sourceResults.map((sourceResult) => (
                  <li key={sourceResult.source}>
                    {sourceResult.source}: {sourceResult.recordCount} records
                    {sourceResult.errors.length > 0 ? ` (${sourceResult.errors.join('; ')})` : ''}
                  </li>
                ))}
              </ul>
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
                    {recommendation.matchedFields.length > 0 ? (
                      <span className="dg-candidate__meta">Matched: {recommendation.matchedFields.join(', ')}</span>
                    ) : null}
                    {recommendation.missingFields.length > 0 ? (
                      <span className="dg-candidate__meta">Missing: {recommendation.missingFields.join(', ')}</span>
                    ) : null}
                    {recommendation.uncertainty.length > 0 ? (
                      <span className="dg-candidate__meta">Uncertainty: {recommendation.uncertainty.join(' ')}</span>
                    ) : null}
                    {recommendation.mismatchedFields.length > 0 ? (
                      <span className="dg-candidate__meta">Mismatches: {recommendation.mismatchedFields.join(', ')}</span>
                    ) : null}
                    <a className="dg-candidate__link" href={recommendation.sourceUrl} target="_blank" rel="noreferrer">
                      Official source record
                    </a>
                    {recommendation.sourceUrl.includes('competitive-calls-cs') ? (
                      <a className="dg-candidate__link" href={EU_PORTAL_SEARCH_URL} target="_blank" rel="noreferrer">
                        Official EU search (locate by topic ID — detail page not verified)
                      </a>
                    ) : null}
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