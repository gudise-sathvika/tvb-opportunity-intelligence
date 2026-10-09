import type { DiscoveryCandidate } from '../../automation/candidate'
import type { DiscoveryRunOutcome } from '../../automation/discovery-fixture'
import type { SourceRunResult } from '../../automation/orchestrator'
import {
  CANDIDATE_STATUS_LABEL,
  COMPANY_STATE_FOR_OUTCOME,
  DOMAIN_SUMMARY_LABEL,
  KIND_LABEL,
  LOCATION_LABEL,
  NORMALIZATION_STATUS_LABEL,
  OUTCOME_LABEL,
  SECTOR_LABEL,
  SOURCE_KIND_LABEL,
  companyNameFor,
  sourceKindFor,
} from './labels'

/**
 * Transparent agent workflow (Phase I brief §1–§7).
 *
 * UI/observability only: the three founder-requested stages rendered from the
 * run outcome's real values. Agent 1 reads the per-company source results,
 * Agent 2 reads the run counts and classified candidates, and Agent 3 is shown
 * honestly as not run — matching is a later phase and nothing here pretends
 * otherwise. No scores, no model names, no timings, no invented metrics.
 */

function isAccessBlocked(result: SourceRunResult): boolean {
  return (
    result.outcome === 'BLOCKED' && (result.accessState === 'RESTRICTED' || result.accessState === 'UNAVAILABLE')
  )
}

function AgentStatus({ done, runLabel, idleLabel }: { done: boolean; runLabel: string; idleLabel: string }) {
  return done ? (
    <span className="dg-chip dg-chip--completed">&#10003; {runLabel}</span>
  ) : (
    <span className="dg-chip">&#9675; {idleLabel}</span>
  )
}

function SourceDetail({ companyId, result }: { companyId: string; result: SourceRunResult }) {
  const kind = sourceKindFor(result.sourceId)
  return (
    <li className="dg-agent__item">
      <span className="dg-agent__item-title">{companyNameFor(companyId)}</span>{' '}
      <span>
        {result.sourceName ?? 'Unknown source'} <code className="idbadge">{result.sourceId}</code>
      </span>
      {kind !== null ? (
        <span className={`dg-chip dg-chip--source-${kind}`}>{SOURCE_KIND_LABEL[kind]}</span>
      ) : null}{' '}
      {result.accessState !== null ? <span>Access: {result.accessState}</span> : null}{' '}
      <span className={`dg-chip dg-chip--${COMPANY_STATE_FOR_OUTCOME[result.outcome]}`}>
        {OUTCOME_LABEL[result.outcome]}
      </span>{' '}
      <span>
        Results received: {result.candidatesReceived} &middot; Candidates created: {result.candidatesCreated}
      </span>
      {isAccessBlocked(result) ? <span>Blocked &mdash; access required.</span> : null}
      {result.errors.length > 0 ? (
        <ul className="dg-agent__errors">
          {result.errors.map((error, index) => (
            <li key={`${result.sourceId}:${index}`}>{error}</li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function CandidateDetail({ candidate }: { candidate: DiscoveryCandidate }) {
  return (
    <li className="dg-agent__item">
      <span className="dg-agent__item-title">{candidate.sourceTitle}</span>{' '}
      <span>{KIND_LABEL[candidate.domain]}</span> &middot;{' '}
      <span>{CANDIDATE_STATUS_LABEL[candidate.candidateStatus]}</span>
      {candidate.normalization !== null ? (
        <span> &middot; Normalization: {NORMALIZATION_STATUS_LABEL[candidate.normalization.status]}</span>
      ) : null}
    </li>
  )
}

export default function AutomationWorkflow({ outcome }: { outcome: DiscoveryRunOutcome }) {
  const agent1Done = outcome.counts.totalSources > 0
  const agent2Done = outcome.counts.candidatesReceived > 0
  const matched = outcome.companies.reduce((sum, company) => sum + company.candidates.length, 0)
  const companies =
    outcome.companyIds.length === 1
      ? `Company: ${companyNameFor(outcome.companyIds[0])}`
      : `Companies: ${outcome.companyIds.map((id) => companyNameFor(id)).join(', ')}`

  return (
    <section className="card dg-panel" aria-label="Automation workflow">
      <h2 className="dg-panel__title">Automation workflow</h2>
      <p className="dg-workflow__note">
        Automation does not directly create Vault records. Candidates pass through discovery,
        classification, deduplication, and human review before any future write.
      </p>

      <h3 className="dg-subtitle">Requested</h3>
      <ul className="dg-requested">
        <li>{companies}</li>
        <li>Domain: {DOMAIN_SUMMARY_LABEL[outcome.domain]}</li>
        <li>Sector: {SECTOR_LABEL[outcome.sector]}</li>
        <li>Keyword: {outcome.keyword === '' ? '—' : outcome.keyword}</li>
        <li>Location: {LOCATION_LABEL[outcome.location]}</li>
      </ul>

      <div className="dg-agent">
        <p className="dg-agent__eyebrow">Agent 1</p>
        <h3 className="dg-agent__name">Source Discovery</h3>
        <p className="dg-agent__purpose">Find candidate information from configured sources.</p>
        <p>
          <AgentStatus done={agent1Done} runLabel="Completed" idleLabel="Not run" />
        </p>
        <ul className="dg-agent__stats">
          <li>Sources checked: {outcome.counts.totalSources}</li>
          <li>Candidates received: {outcome.counts.candidatesReceived}</li>
          {outcome.counts.blockedSources > 0 ? <li>Blocked sources: {outcome.counts.blockedSources}</li> : null}
          {outcome.counts.failedSources > 0 ? <li>Failed sources: {outcome.counts.failedSources}</li> : null}
        </ul>
        <details className="dg-agent__detail">
          <summary>Show source detail</summary>
          <ul className="dg-agent__list">
            {outcome.companies.map((company) =>
              company.sourceResults.map((result) => (
                <SourceDetail key={`${company.companyId}:${result.sourceId}`} companyId={company.companyId} result={result} />
              )),
            )}
          </ul>
          {outcome.counts.blockedSources > 0 || outcome.counts.failedSources > 0 ? (
            <p className="dg-note">Blocked or failed sources were not queried for listings.</p>
          ) : null}
        </details>
      </div>

      <div className="dg-flow" aria-hidden="true">
        &darr;
      </div>

      <div className="dg-agent">
        <p className="dg-agent__eyebrow">Agent 2</p>
        <h3 className="dg-agent__name">Classification</h3>
        <p className="dg-agent__purpose">
          Classify/extract candidates as Grant or RFP using the existing deterministic pipeline.
        </p>
        <p>
          <AgentStatus done={agent2Done} runLabel="Completed" idleLabel="Not run" />
        </p>
        {agent2Done ? (
          <>
            <ul className="dg-agent__stats">
              <li>Candidates received: {outcome.counts.candidatesReceived}</li>
              <li>Candidates classified: {outcome.counts.candidatesCreated}</li>
              <li>
                {KIND_LABEL[outcome.domain]}: {outcome.counts.candidatesCreated}
              </li>
              <li>Needs review: {outcome.needsReview}</li>
              <li>Duplicates: {outcome.counts.duplicates}</li>
            </ul>
            <details className="dg-agent__detail">
              <summary>Show classification detail</summary>
              <ul className="dg-agent__list">
                {outcome.companies.map((company) =>
                  company.candidates.map((candidate) => (
                    <CandidateDetail key={candidate.candidateId} candidate={candidate} />
                  )),
                )}
              </ul>
              {outcome.keyword !== '' ? (
                <p className="dg-note">
                  Keyword &ldquo;{outcome.keyword}&rdquo; matched {matched} of {outcome.counts.candidatesCreated}{' '}
                  classified candidates; only matched findings proceed.
                </p>
              ) : null}
            </details>
          </>
        ) : (
          <p className="dg-empty">No candidates reached classification.</p>
        )}
      </div>

      <div className="dg-flow" aria-hidden="true">
        &darr;
      </div>

      <div className="dg-agent">
        <p className="dg-agent__eyebrow">Agent 3</p>
        <h3 className="dg-agent__name">Company Matching</h3>
        <p className="dg-agent__purpose">Match approved opportunities to TVB companies.</p>
        <p>
          <AgentStatus done={false} runLabel="Completed" idleLabel="Not run" />
        </p>
        <ul className="dg-agent__stats">
          <li>Not run &mdash; matching is a later phase.</li>
          <li>Not implemented in this phase.</li>
          <li>Runs after approved candidates are available.</li>
        </ul>
      </div>
    </section>
  )
}
