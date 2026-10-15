/**
 * Phase 06 live match check panel (real mode only).
 *
 * Runs `runLiveMatchCheck` — one bounded GLEIF search plus one broad
 * Grants.gov search plus one broad Find a Tender search through the
 * same-origin bridges — and renders the explainable proposals inline.
 * Results live in component state: they are never persisted, never enter the
 * review queue, and a PROPOSED badge is a relevance proposal, not an
 * eligibility determination.
 */

import { useState } from 'react'
import { runLiveMatchCheck } from '../../live-source/live-match-workflow'
import type { LiveMatchCheckResult } from '../../live-source/live-match-workflow'
import type { DiscoveryCandidate } from '../../automation/candidate'
import { explainProposal } from '../../automation/proposal-explanation'
import { classifyRelevance } from '../../automation/relevance-gate'

/**
 * Phase 27: opportunity evidence already carried by the evaluated candidate
 * (programmes, sectors, categories, document findings), rendered here so
 * reviewers see what the engine could and could not use. Read-only display;
 * engines never read this component.
 */
function OpportunityEvidenceLine({ candidate }: { candidate: DiscoveryCandidate | undefined }) {
  const evidence = candidate?.sourceEvidence ?? null
  if (evidence === null) return null
  const parts: string[] = []
  if (evidence.programmes !== null) parts.push(`Programmes: ${evidence.programmes.slice(0, 3).join('; ')}`)
  if (evidence.sectors !== null) parts.push(`Sectors: ${evidence.sectors.slice(0, 3).join('; ')}`)
  if (evidence.categories !== null) parts.push(`Categories: ${evidence.categories.slice(0, 3).join('; ')}`)
  if (evidence.documentFindings.length > 0) {
    parts.push(`${evidence.documentFindings.length} official excerpt(s), e.g. ${evidence.documentFindings[0].section ?? 'untitled section'}`)
  }
  if (parts.length === 0) return null
  return <span className="dg-candidate__meta">Opportunity evidence (not engine inputs): {parts.join(' · ')}</span>
}

/**
 * Phase 12 context-appropriate next action. Only actions the app can perform:
 * retry the search, inspect missing evidence, or leave the temporary results
 * alone. Never invents a company, a match, or a persistence action.
 */
/**
 * Phase 29 relevance display. Proposals in this workflow exist only for
 * gate-actionable (open) opportunities — assembly skips the rest — so
 * eligibility is passed as open here. The gate output is display-only: engine
 * verdicts, thresholds, and versions are untouched.
 */
function RelevanceLine({
  proposal,
}: {
  proposal: { status: string; matchedSignals: readonly string[]; evidence: readonly { outcome: string; signal: string }[] }
}) {
  const mismatched = proposal.evidence.filter((entry) => entry.outcome === 'mismatched').map((entry) => entry.signal)
  const verdict = classifyRelevance({
    engineStatus: proposal.status as 'PROPOSED' | 'NOT_A_MATCH' | 'INSUFFICIENT_EVIDENCE',
    matchedSignals: [...proposal.matchedSignals],
    mismatchedSignals: mismatched,
    opportunityEligibility: 'open',
  })
  return (
    <span className="dg-candidate__meta">
      Relevance: {verdict.outcome} — {verdict.reason}
    </span>
  )
}

function NextStep({ result }: { result: LiveMatchCheckResult }) {
  if (result.companies.length === 0) {
    return (
      <p className="dg-empty">
        Next: retry with the exact registered legal name, or look the entity up in the
        official GLEIF search (gleif.org) and confirm it holds an ACTIVE LEI record before
        searching again. Nothing here can be matched, saved, or approved.
      </p>
    )
  }
  const proposed = [...result.fundingProposals, ...result.procurementProposals].filter(
    (proposal) => proposal.status === 'PROPOSED',
  ).length
  if (proposed === 0) {
    const missing = [
      ...result.fundingProposals,
      ...result.procurementProposals,
    ].flatMap((proposal) => [...proposal.missingSignals])
    const top = [...new Set(missing)].slice(0, 3).join(', ') || 'all evaluated signals'
    return (
      <p className="dg-empty">
        Next: {result.companies.length} verified{" "}
        {result.companies.length === 1 ? 'company was' : 'companies were'} evaluated against{' '}
        {result.fundingActionable.length + result.procurementActionable.length} actionable{' '}
        {"opportunities, but the evidence most often missing was: "}{top}. These are negative
        outcomes, not positive recommendations — no proposal is saved or approved. Broaden the
        evidence (e.g. SEC enrichment) or wait for sources that publish it.
      </p>
    )
  }
  return (
    <p className="dg-note" role="note">
      Next: {proposed} live, temporary {"proposal(s)"} above merit a human look. They are not
      saved, queued, or approved — review the matched and missing evidence here, then decide
      in the persisted queue workflow.
    </p>
  )
}

export default function LiveMatchCheck() {
  const [query, setQuery] = useState('')
  const [enrich, setEnrich] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<LiveMatchCheckResult | null>(null)
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null)
  const [selected, setSelected] = useState<readonly string[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  async function run(): Promise<void> {
    if (query.trim() === '' || running) return
    setRunning(true)
    setFailure(null)
    // Phase 12: never show a previous search's results as the current answer.
    setResult(null)
    setSubmittedQuery(null)
    try {
      // Phase 12A: only user-confirmed entities are evaluated; null keeps the
      // default of every verified hit for the first run of a search.
      const completed = await runLiveMatchCheck({ companyQuery: query, enrich, confirmedCompanyIds: selected ?? undefined })
      setResult(completed)
      setSubmittedQuery(query.trim())
      setSelected([...completed.companies, ...completed.unconfirmedCompanies].map((company) => company.companyId))
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
    }
  }

  function enrichmentFor(companyId: string) {
    return result?.enrichments.find((entry) => entry.companyId === companyId)?.enrichment ?? null
  }

  return (
    <section className="card dg-panel" aria-label="Live match check">
      <h2 className="dg-panel__title">Live match check</h2>
      <p className="dg-note" role="note">
        Read-only and non-persistent: searches the official GLEIF LEI registry for the legal
        name below, evaluates broad live funding and procurement notices against verified
        profiles only, and shows explainable proposals here. Nothing is saved, queued, or
        approved. PROPOSED means relevant evidence matched — never eligibility.
      </p>
      <div className="dg-options">
        <label className="dg-option" htmlFor="live-match-query">
          Company legal name
        </label>
        <input
          id="live-match-query"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="e.g. General Electric"
          disabled={running}
        />
        <button type="button" className="btn dg-run--live" disabled={query.trim() === '' || running} onClick={() => void run()}>
          {running ? 'Checking…' : 'Run live match check'}
        </button>
        <label className="dg-option" htmlFor="live-match-enrich">
          <input
            id="live-match-enrich"
            type="checkbox"
            checked={enrich}
            onChange={(event) => setEnrich(event.target.checked)}
            disabled={running}
          />
          Enrich via SEC EDGAR (official filings; industry, website, locations only — never invented)
        </label>
      </div>

      {failure !== null ? <p className="dg-empty" role="alert">Live match check failed: {failure}</p> : null}

      {result !== null ? (
        <div data-testid="live-match-result">
          <h3 className="dg-subtitle">A. Search submitted</h3>
          <p className="dg-note" role="note">
            Live, non-persistent evaluation for legal-name search term “{submittedQuery ?? ''}”
            checked {result.requestedAt.slice(0, 10)}. The term is a search string, not a
            verified entity — only the GLEIF records listed below count as verified. These
            evaluations are not saved and never enter the persisted queue.
          </p>
          {result.errors.length > 0 ? (
            <ul className="dg-agent__errors">
              {result.errors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          ) : null}

          <h3 className="dg-subtitle">
            B. Entity confirmation — {result.companies.length + result.unconfirmedCompanies.length} GLEIF
            search hits, {result.companies.length} confirmed for evaluation
            {result.gleifRejected.length > 0 ? ` (${result.gleifRejected.length} registry records rejected)` : ''}
          </h3>
          <p className="dg-note" role="note">
            These are registry records whose legal names matched your search text — not proof
            they are your company, and no corporate affiliation is claimed. Uncheck any entity
            that is not the intended legal entity, then run again; only checked entities are
            evaluated. Directory names alone are never sufficient, and SEC EDGAR enrichment
            cannot proceed without a verified profile and never replaces GLEIF verification.
          </p>
          {result.companies.length === 0 ? (
            <div className="dg-empty" role="status">
              {result.gleifRawRecords === 0 ? (
                <p>
                  The official registry returned zero records for this search (a successful
                  lookup with nothing matching). No company-level matching was performed.
                </p>
              ) : (
                <p>
                  The registry returned {result.gleifRawRecords} record
                  {result.gleifRawRecords === 1 ? '' : 's'}, but none qualified as an ACTIVE
                  legal entity — no company-level matching was performed. Rejection reasons:
                </p>
              )}
              {result.gleifRejected.length > 0 ? (
                <ul>
                  {result.gleifRejected.slice(0, 3).map((rejection, index) => (
                    <li key={index}>
                      {rejection.lei ?? 'unidentified record'} — {rejection.reason}
                    </li>
                  ))}
                  {result.gleifRejected.length > 3 ? (
                    <li>…and {result.gleifRejected.length - 3} further rejected records.</li>
                  ) : null}
                </ul>
              ) : null}
              <p>
                This does not establish that the business does not exist — an exact
                registered legal name or official LEI lookup may be needed. Correct the legal
                name above and run again, or consult the official company registry. Directory
                names alone are never sufficient, and SEC EDGAR enrichment cannot proceed
                without a verified profile and never replaces GLEIF verification.
              </p>
            </div>
          ) : (
            <ul className="dg-candidates">
              {[...result.companies, ...result.unconfirmedCompanies].map((company) => {
                const enrichment = enrichmentFor(company.companyId)
                const evaluated = result.companies.some((entry) => entry.companyId === company.companyId)
                const checked = selected?.includes(company.companyId) ?? evaluated
                return (
                  <li key={company.companyId} className="dg-candidate">
                    <label className="dg-option" htmlFor={`live-match-entity-${company.companyId}`}>
                      <input
                        id={`live-match-entity-${company.companyId}`}
                        type="checkbox"
                        checked={checked}
                        disabled={running}
                        onChange={() => {
                          const current = new Set(selected ?? [])
                          if (current.has(company.companyId)) current.delete(company.companyId)
                          else current.add(company.companyId)
                          setSelected([...current])
                        }}
                      />
                      Confirm as the intended legal entity{evaluated ? '' : ' (not evaluated)'}
                    </label>
                    <span className="dg-candidate__title">{company.name}</span>
                    <span className="dg-candidate__meta">
                      {company.companyId} · country {company.country ?? 'unknown (reported as missing evidence)'}
                      {company.industry ? ` · industry ${company.industry.join('; ')}` : ''}
                    </span>
                    <a className="dg-candidate__link" href={company.provenance.source} target="_blank" rel="noreferrer">
                      Official GLEIF record
                    </a>
                    {enrichment !== null ? (
                      <span className="dg-candidate__meta">
                        Enrichment {enrichment.status} · checked {enrichment.checkedAt.slice(0, 10)}
                        {enrichment.website ? ` · website ${enrichment.website}` : ''}
                        {enrichment.locations ? ` · ${enrichment.locations.join('; ')}` : ''}
                        {enrichment.notes.length > 0 ? ` · ${enrichment.notes.join('; ')}` : ''}
                      </span>
                    ) : null}
                    {enrichment !== null
                      ? enrichment.evidence.map((item, index) => (
                          <a
                            key={`${item.attribute}:${index}`}
                            className="dg-candidate__link"
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Evidence: {item.attribute} — {item.value} ({item.sourceName})
                          </a>
                        ))
                      : null}
                  </li>
                )
              })}
            </ul>
          )}

          <h3 className="dg-subtitle">
            C. Opportunity evaluation — funding: {result.fundingActionable.length} actionable of{' '}
            {result.fundingEvaluated} evaluated, {result.fundingExcluded} excluded ·{' '}
            {result.fundingProposals.length} company-opportunity evaluations (
            {result.fundingProposals.filter((p) => p.status === 'PROPOSED').length} PROPOSED
            positive · {result.fundingProposals.filter((p) => p.status === 'NOT_A_MATCH').length}{' '}
            NOT_A_MATCH negative — negatives are outcomes, not recommendations)
          </h3>
          {result.fundingProposals.length === 0 ? (
            <p className="dg-empty">
              No funding proposal supported by the evidence
              {result.companies.length === 0 ? ' (no verified company to evaluate)' : ''}
              {result.fundingActionable.length === 0 ? ' (no actionable open opportunity retrieved)' : ''}.
            </p>
          ) : (
            <ul className="dg-candidates">
              {result.fundingProposals.map((proposal) => {
                const company = result.companies.find((entry) => entry.companyId === proposal.companyId) ?? null
                const explanation = explainProposal(proposal, {
                  companyProvenance: company?.provenance ?? null,
                  companyIndustryEvidenced: (company?.industry?.length ?? 0) > 0,
                  // No current opportunity source publishes industries: always unverifiable.
                  opportunityIndustryEvidenced: false,
                })
                const candidate = result.fundingActionable.find(
                  (entry) => entry.sourceRecordId === proposal.sourceRecordId,
                )
                return (
                  <li key={proposal.proposalId} className="dg-candidate">
                    <span className="dg-candidate__title">
                      {proposal.companyId} × {proposal.sourceRecordId}
                    </span>
                    <OpportunityEvidenceLine candidate={candidate} />
                    <span className="dg-candidate__meta">
                      matched: {proposal.matchedSignals.join(', ') || 'none'} · missing:{' '}
                      {proposal.missingSignals.join(', ') || 'none'}
                      {explanation.contradictory.length > 0
                        ? ` · contradicts: ${explanation.contradictory.map((entry) => entry.signal).join(', ')}`
                        : ''}
                    </span>
                    {explanation.unverified.map((entry) => (
                      <span key={entry.signal} className="dg-candidate__meta">
                        Unverified: {entry.detail}
                      </span>
                    ))}
                    <span className="dg-candidate__meta">{explanation.ruleNote}</span>
                    <RelevanceLine proposal={proposal} />
                    <span className={`dg-chip dg-chip--${proposal.status === 'PROPOSED' ? 'completed' : 'failed'}`}>
                      {proposal.status}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          <h3 className="dg-subtitle">
            C. Opportunity evaluation — procurement: {result.procurementActionable.length} actionable
            of {result.procurementEvaluated} evaluated, {result.procurementExcluded} excluded ·{' '}
            {result.procurementProposals.length} company-opportunity evaluations (
            {result.procurementProposals.filter((p) => p.status === 'PROPOSED').length} PROPOSED
            positive · {result.procurementProposals.filter((p) => p.status === 'NOT_A_MATCH').length}{' '}
            NOT_A_MATCH negative — negatives are outcomes, not recommendations)
          </h3>
          {result.procurementExcludedDetails.length > 0 ? (
            <ul className="dg-candidates" data-testid="live-match-excluded">
              {result.procurementExcludedDetails.slice(0, 5).map((item) => (
                <li key={item.recordId} className="dg-candidate">
                  <span className="dg-candidate__title">{item.title.slice(0, 90)}</span>
                  <span className="dg-candidate__meta">
                    {item.recordId} · {item.state}: {item.reason}
                  </span>
                </li>
              ))}
              {result.procurementExcludedDetails.length > 5 ? (
                <li className="dg-candidate">
                  <span className="dg-candidate__meta">
                    …and {result.procurementExcludedDetails.length - 5} further excluded notices with the same
                    recorded reasons.
                  </span>
                </li>
              ) : null}
            </ul>
          ) : null}
          {result.procurementProposals.length === 0 ? (
            <p className="dg-empty">
              No procurement proposal supported by the evidence
              {result.companies.length === 0 ? ' (no verified company to evaluate)' : ''}
              {result.procurementActionable.length === 0 ? ' (no actionable open notice retrieved)' : ''}.
              Historical, cancelled, expired and unknown-status notices are never actionable.
            </p>
          ) : (
            <ul className="dg-candidates">
              {result.procurementProposals.map((proposal) => {
                const company = result.companies.find((entry) => entry.companyId === proposal.companyId) ?? null
                const explanation = explainProposal(proposal, {
                  companyProvenance: company?.provenance ?? null,
                  companyIndustryEvidenced: (company?.industry?.length ?? 0) > 0,
                  opportunityIndustryEvidenced: false,
                })
                const candidate = result.procurementActionable.find(
                  (entry) => entry.sourceRecordId === proposal.noticeId,
                )
                return (
                  <li key={proposal.proposalId} className="dg-candidate">
                    <span className="dg-candidate__title">
                      {proposal.companyId} × {proposal.noticeId}
                    </span>
                    <OpportunityEvidenceLine candidate={candidate} />
                    <span className="dg-candidate__meta">
                      matched: {proposal.matchedSignals.join(', ') || 'none'} · missing:{' '}
                      {proposal.missingSignals.join(', ') || 'none'}
                      {explanation.contradictory.length > 0
                        ? ` · contradicts: ${explanation.contradictory.map((entry) => entry.signal).join(', ')}`
                        : ''}
                    </span>
                    {explanation.unverified.map((entry) => (
                      <span key={entry.signal} className="dg-candidate__meta">
                        Unverified: {entry.detail}
                      </span>
                    ))}
                    <span className="dg-candidate__meta">{explanation.ruleNote}</span>
                    <RelevanceLine proposal={proposal} />
                    <span className={`dg-chip dg-chip--${proposal.status === 'PROPOSED' ? 'completed' : 'failed'}`}>
                      {proposal.status}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          <h3 className="dg-subtitle">D. Next step</h3>
          <NextStep result={result} />
        </div>
      ) : null}
    </section>
  )
}
