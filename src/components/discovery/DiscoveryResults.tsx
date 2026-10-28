import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { loadImportedTargetCompanies } from '../../target-companies/store'
import { csvPreviewToTargetCompanies } from '../../target-companies/profiles'
import { recommendOpportunitiesForTargetCompanies } from '../../target-companies/recommendations'
import type { TargetOpportunityInput } from '../../target-companies/matching'
import type { DiscoveryCandidate } from '../../automation/candidate'
import type { DiscoveryCompanyResult, DiscoveryRunOutcome } from '../../automation/discovery-fixture'
import {
  EU_SEDIA_SOURCE_ID,
  FTS_SOURCE_ID,
  GRANTS_GOV_SOURCE_ID,
  TED_SOURCE_ID,
  USA_SPENDING_SOURCE_ID,
} from '../../automation/registry'
import { classifyOpportunityState } from '../../automation/opportunity-status'
import { EU_PORTAL_SEARCH_URL } from '../../automation/eu-sedia-adapter'
import type { OpportunityState } from '../../automation/opportunity-status'
import AutomationWorkflow from './AutomationWorkflow'
import {
  COMPANY_STATE_FOR_OUTCOME,
  DOMAIN_SUMMARY_LABEL,
  LOCATION_LABEL,
  OUTCOME_LABEL,
  SECTOR_LABEL,
  SOURCE_KIND_LABEL,
  companyNameFor,
  sourceKindFor,
} from './labels'

/** The run summary cells: the Phase G nine plus the Phase H request filters. */
const SUMMARY_METRICS = [
  { key: 'companies', label: 'Companies processed' },
  { key: 'domain', label: 'Domain' },
  { key: 'sector', label: 'Sector' },
  { key: 'keyword', label: 'Keyword' },
  { key: 'location', label: 'Location' },
  { key: 'sources', label: 'Sources attempted' },
  { key: 'candidates', label: 'Candidates found' },
  { key: 'needsReview', label: 'Candidates requiring review' },
  { key: 'duplicates', label: 'Duplicates' },
  { key: 'blocked', label: 'Blocked sources' },
  { key: 'failed', label: 'Failed sources' },
  { key: 'outcome', label: 'Overall outcome' },
] as const

function summaryValue(outcome: DiscoveryRunOutcome, key: (typeof SUMMARY_METRICS)[number]['key']): string {
  switch (key) {
    case 'companies':
      return String(outcome.companyIds.length)
    case 'domain':
      return DOMAIN_SUMMARY_LABEL[outcome.domain]
    case 'sector':
      return SECTOR_LABEL[outcome.sector]
    case 'keyword':
      return outcome.keyword === '' ? '—' : outcome.keyword
    case 'location':
      return LOCATION_LABEL[outcome.location]
    case 'sources':
      return String(outcome.counts.totalSources)
    case 'candidates':
      return String(outcome.counts.candidatesCreated)
    case 'needsReview':
      return String(outcome.needsReview)
    case 'duplicates':
      return String(outcome.counts.duplicates)
    case 'blocked':
      return String(outcome.counts.blockedSources)
    case 'failed':
      return String(outcome.counts.failedSources)
    case 'outcome':
      return OUTCOME_LABEL[outcome.outcome]
  }
}

/**
 * Phase 18: distinguishes "the search completed with no matching results" from
 * "the source request failed" (and from a blocked source). A completed empty
 * search is a real answer, not an error, and never proves opportunities are
 * absent.
 */
function emptyMessage(company: DiscoveryCompanyResult): string {
  if (company.outcome === 'NO_RESULTS') {
    return 'Search completed with no matching results. Try a relevant keyword or adjust the supported filters. No matches does not prove no opportunities exist.'
  }
  if (company.outcome === 'FAILED') {
    return 'The source request failed — this is not an empty result. See the source errors above.'
  }
  return 'This company run produced no candidates.'
}

/**
 * Phase 20D: the Grants.gov run issues ONE search for the whole run and shows
 * the same source pool for every selected company. The note states the shared,
 * NOT-company-matched pool plainly, and distinguishes broad vs keyword mode.
 */
function grantsGovNote(outcome: DiscoveryRunOutcome): string {
  const lead =
    outcome.keyword === ''
      ? 'This run queried the real Grants.gov source. A blank keyword runs ONE broad search of posted opportunities for the whole run; the same source pool is shown for every selected company and is NOT company-matched.'
      : `This run queried the real Grants.gov source. The keyword “${outcome.keyword}” is searched ONCE for the run and the same results are shown for every selected company (not company-matched).`
  const tail =
    'Each opportunity shows its agency, status, close date, and official link; the open-opportunity gate marks a record Open (confirmed) only when the status is posted, the close date is in the future, the URL is official, and provenance is present. Canonical review items are handed off once per run.'
  return `${lead} ${tail}`
}

/**
 * Phase 34: describes exactly which procurement sources a live run queried.
 * A blank keyword skips TED as insufficiently specified (no company-name
 * fallback), so the note must not claim a TED search that never happened.
 */
function liveProcurementNote(outcome: DiscoveryRunOutcome): string {
  const queried = new Set<string>()
  for (const company of outcome.companies) {
    for (const result of company.sourceResults) queried.add(result.sourceId)
  }
  const ted = queried.has(TED_SOURCE_ID)
  const fts = queried.has(FTS_SOURCE_ID)
  if (ted && fts) {
    return 'This run queried the real TED source. It also queried the real UK Find a Tender Service (one broad latest-notices search per run, shared by all selected companies). Canonical listings and review items are shown once per run.'
  }
  if (ted) {
    return 'This run queried the real TED source. Canonical listings and review items are shown once per run.'
  }
  return 'This run did not query TED (no procurement keyword was entered) and queried the real UK Find a Tender Service (one broad latest-notices search per run, shared by all selected companies). Canonical listings and review items are shown once per run.'
}

/** Phase U: marks whether a run's source is a real verified source or a fixture. */
function SourceKindChip({ sourceId }: { sourceId: string | null }) {
  const kind = sourceKindFor(sourceId)
  if (kind === null) return null
  return <span className={`dg-chip dg-chip--source-${kind}`}>{SOURCE_KIND_LABEL[kind]}</span>
}

/**
 * The run result (Phase G brief §8; Phase H §8): the summary straight from the
 * run outcome — the nine engine counts plus the recorded request filters — a
 * per-company list (expandable to source/run details), and the review handoff
 * into the Phase F queue.
 */
/** Phase 20B: the live funding banner states the ACTUAL source, never a hardcoded one. */
function liveFundingBanner(outcome: DiscoveryRunOutcome): { sourceId: string; name: string; text: string } | null {
  const result = outcome.companies.flatMap((company) => company.sourceResults)[0]
  if (result === undefined) return null
  const name = result.sourceName ?? 'Unknown source'
  if (result.sourceId === GRANTS_GOV_SOURCE_ID) {
    return {
      sourceId: result.sourceId,
      name,
      text: `${name} (${result.sourceId}) — US federal grant opportunities. A record is marked Open (confirmed) only when the open-opportunity gate passes: status posted, a future close date, an official URL, and provenance.`,
    }
  }
  if (result.sourceId === USA_SPENDING_SOURCE_ID) {
    return {
      sourceId: result.sourceId,
      name,
      text: `${name} (${result.sourceId}) — US federal awards, not open grant solicitations.`,
    }
  }
  if (result.sourceId === EU_SEDIA_SOURCE_ID) {
    return {
      sourceId: result.sourceId,
      name,
      text: `${name} (${result.sourceId}) — EU grant topics and cascade funding calls. A record is marked Open (confirmed) only when the open-call gate passes: status open for submission, a future deadline, an official EU link, and provenance.`,
    }
  }
  return { sourceId: result.sourceId, name, text: `${name} (${result.sourceId}) — live source results.` }
}

/**
 * Phase 21C: the EU SEDIA run issues ONE search for the whole run and shows the
 * same source pool for every selected company (NOT company-matched).
 */
function euSediaNote(outcome: DiscoveryRunOutcome): string {
  const lead =
    outcome.keyword === ''
      ? 'This run queried the real EU Funding & Tenders Portal. A blank keyword runs ONE broad search of requested grant topics and cascade funding calls for the whole run; the same source pool is shown for every selected company and is NOT company-matched.'
      : `This run queried the real EU Funding & Tenders Portal. The keyword “${outcome.keyword}” is searched ONCE for the run and the same results are shown for every selected company (not company-matched).`
  const tail =
    'Each record shows its award type, source status, deadline, and official EU link; the open-call gate marks a record Open (confirmed) only when the status is open for submission, the deadline is in the future, the link is official, and provenance is present. Tenders (type 0) are not requested in this phase. Canonical review items are handed off once per run.'
  return `${lead} ${tail}`
}

interface SourceCounts {
  retrieved: number
  open: number
  excluded: number
}

/**
 * Phase 22: retrieved / passed the shared open-opportunity classifier / not
 * open. One classifier for grants, EU, TED and USAspending keeps the counts and
 * the per-record chips consistent.
 */
function sourceCounts(company: DiscoveryCompanyResult, now: string): SourceCounts {
  let open = 0
  for (const candidate of company.candidates) {
    if (classifyOpportunityState(candidate, now).state === 'open') open += 1
  }
  const retrieved = company.candidates.length
  return { retrieved, open, excluded: retrieved - open }
}

/** Official link label per source; unknown sources fall back to a neutral label. */
const LINK_LABEL: Record<string, string> = {
  [GRANTS_GOV_SOURCE_ID]: 'Official Grants.gov record',
  [EU_SEDIA_SOURCE_ID]: 'Official EU portal record',
  [TED_SOURCE_ID]: 'Official TED notice',
  [FTS_SOURCE_ID]: 'Official Find a Tender notice',
  [USA_SPENDING_SOURCE_ID]: 'Official USAspending award',
}

/**
 * Phase 09: source-backed requirement evidence for one candidate. Only
 * evidenced facts render, each traceable to its source; gaps are stated once
 * via the first note. Never an eligibility claim.
 */
function OpportunityEvidence({ candidate }: { candidate: DiscoveryCandidate }): ReactNode {
  const evidence = candidate.sourceEvidence ?? null
  if (evidence === null) return null
  const facts: string[] = []
  if (evidence.programmes !== null) facts.push(`Programmes: ${evidence.programmes.slice(0, 3).join('; ')}`)
  if (evidence.sectors !== null) facts.push(`Sectors: ${evidence.sectors.slice(0, 3).join('; ')}`)
  if (evidence.categories !== null) facts.push(`Categories: ${evidence.categories.slice(0, 3).join('; ')}`)
  if (evidence.budget !== null) facts.push(`Budget: ${evidence.budget.slice(0, 120)}`)
  if (evidence.value !== null) facts.push(`Value: ${evidence.value}`)
  for (const note of evidence.lifecycleNotes.slice(0, 2)) facts.push(note.slice(0, 160))
  if (facts.length === 0 && evidence.notes.length === 0 && evidence.documents.length === 0) return null
  return (
    <>
      {facts.length > 0 ? <span className="dg-candidate__meta">{facts.join(' · ')}</span> : null}
      {evidence.documents.slice(0, 3).map((doc) => (
        <a key={doc.url} className="dg-candidate__link" href={doc.url} target="_blank" rel="noreferrer">
          Official document: {doc.label.slice(0, 80)}
        </a>
      ))}
      {evidence.documentFindings.slice(0, 2).map((finding, index) => (
        <span key={index} className="dg-candidate__meta">
          Official excerpt{finding.section ? ` (${finding.section.slice(0, 80)})` : ''}: “
          {finding.excerpt.slice(0, 200)}” — pointers only, not an eligibility verdict.
        </span>
      ))}
      {evidence.notes.length > 0 ? (
        <span className="dg-candidate__meta">Evidence gaps: {evidence.notes[0].slice(0, 160)}</span>
      ) : null}
    </>
  )
}

/**
 * Phase 15A: the open verdict is scoped to the run's observation time — an
 * approval or a later viewing never re-proves current openness. The
 * `Open (confirmed)` prefix is preserved verbatim for existing assertions.
 */
function OpportunityChip({ state, reason, asOf }: { state: OpportunityState; reason: string; asOf: string }) {
  if (state === 'open')
    return <span className="dg-chip dg-chip--completed">Open (confirmed, as of {asOf.slice(0, 10)})</span>
  if (state === 'forthcoming') return <span className="dg-chip dg-chip--running">Forthcoming</span>
  return <span className="dg-chip dg-chip--failed">Excluded: {reason}</span>
}

/**
 * Phase 22: the shared opportunity list. Open records are listed first; a record
 * is never claimed to match the company (the pool is shared, not matched).
 */
function OpportunityCandidates({
  candidates,
  now,
  companyContexts,
}: {
  candidates: readonly DiscoveryCandidate[]
  now: string
  companyContexts: ReadonlyMap<string, readonly string[]>
}) {
  const ordered = [...candidates].sort((a, b) => {
    const ra = classifyOpportunityState(a, now).state === 'open' ? 0 : 1
    const rb = classifyOpportunityState(b, now).state === 'open' ? 0 : 1
    return ra - rb
  })
  return (
    <ul className="dg-candidates">
      {ordered.map((candidate) => {
        const verdict = classifyOpportunityState(candidate, now)
        return (
          <li key={candidate.candidateId} className="dg-candidate">
            <a className="dg-candidate__title" href={candidate.sourceUrl} target="_blank" rel="noreferrer">
              {candidate.sourceTitle}
            </a>
            {companyContexts.get(candidateIdentity(candidate))?.length ? (
              <span className="dg-candidate__meta">
                Search context (not a company match):{' '}
                {companyContexts.get(candidateIdentity(candidate))?.slice(0, 5).join(', ')}
                {(companyContexts.get(candidateIdentity(candidate))?.length ?? 0) > 5
                  ? ` and ${(companyContexts.get(candidateIdentity(candidate))?.length ?? 0) - 5} more`
                  : ''}
              </span>
            ) : null}
            <span className="dg-candidate__meta">
              <code>{candidate.sourceId}</code>
              {candidate.sourceRecordId ? ` · ${candidate.sourceRecordId}` : ''}
              {candidate.sourceOrganization ? ` · ${candidate.sourceOrganization}` : ''}
              {candidate.sourcePublicationDate ? ` · published ${candidate.sourcePublicationDate}` : ''}
              {candidate.provenance.runId ? ` · run ${candidate.provenance.runId}` : ''}
              {' · '}
              {candidate.sourceRawType ?? 'UNKNOWN'} · status {candidate.sourceStatus ?? 'unknown'} · deadline{' '}
              {candidate.sourceDeadline ?? '—'}
            </span>
            <OpportunityEvidence candidate={candidate} />
            <a className="dg-candidate__link" href={candidate.sourceUrl} target="_blank" rel="noreferrer">
              {LINK_LABEL[candidate.sourceId] ?? 'Official record'}
              {candidate.sourceLinkValidation === 'constructed-unverified' ? ' — destination unverified' : ''}
            </a>
            {candidate.sourceLinkValidation === 'constructed-unverified' ? (
              <a className="dg-candidate__link" href={EU_PORTAL_SEARCH_URL} target="_blank" rel="noreferrer">
                Official EU search (locate by topic ID — detail page not verified)
              </a>
            ) : null}
            <OpportunityChip state={verdict.state} reason={verdict.reason} asOf={now} />
          </li>
        )
      })}
    </ul>
  )
}

/** Phase 23: records that FAILED the ingest gate — preserved, never presented as open. */
function ExcludedCandidates({
  candidates,
  now,
  companyContexts,
}: {
  candidates: readonly DiscoveryCandidate[]
  now: string
  companyContexts: ReadonlyMap<string, readonly string[]>
}) {
  if (candidates.length === 0) return null
  return (
    <details className="dg-excluded" data-testid="excluded-candidates">
      <summary>Excluded at ingest: {candidates.length} not actionable</summary>
      <ul className="dg-candidates">
        {candidates.map((candidate) => {
          const verdict = classifyOpportunityState(candidate, now)
          return (
            <li key={candidate.candidateId} className="dg-candidate">
              <span className="dg-candidate__title">{candidate.sourceTitle}</span>
              {companyContexts.get(candidateIdentity(candidate))?.length ? (
                <span className="dg-candidate__meta">
                  Search context (not a company match):{' '}
                  {companyContexts.get(candidateIdentity(candidate))?.slice(0, 5).join(', ')}
                  {(companyContexts.get(candidateIdentity(candidate))?.length ?? 0) > 5
                    ? ` and ${(companyContexts.get(candidateIdentity(candidate))?.length ?? 0) - 5} more`
                    : ''}
                </span>
              ) : null}
              <span className="dg-candidate__meta">
                <code>{candidate.sourceId}</code>
                {candidate.sourceRecordId ? ` · ${candidate.sourceRecordId}` : ''}
                {' · '}
                {candidate.sourceRawType ?? 'UNKNOWN'} · status {candidate.sourceStatus ?? 'unknown'} · deadline{' '}
                {candidate.sourceDeadline ?? '—'}
              </span>
              {candidate.sourceUrl ? (
                <a className="dg-candidate__link" href={candidate.sourceUrl} target="_blank" rel="noreferrer">
                  {LINK_LABEL[candidate.sourceId] ?? 'Official record'}
                </a>
              ) : null}
              <OpportunityChip state={verdict.state} reason={verdict.reason} asOf={now} />
            </li>
          )
        })}
      </ul>
    </details>
  )
}

/** The one source a live run queried, read from the run provenance. */
function runSourceId(outcome: DiscoveryRunOutcome): string | null {
  for (const company of outcome.companies) {
    for (const result of company.sourceResults) {
      if (result.sourceId !== '') return result.sourceId
    }
  }
  return null
}

function uniqueCandidates(candidates: readonly DiscoveryCandidate[]): DiscoveryCandidate[] {
  const byIdentity = new Map<string, DiscoveryCandidate>()
  for (const candidate of candidates) {
    const identity = candidateIdentity(candidate)
    if (!byIdentity.has(identity)) byIdentity.set(identity, candidate)
  }
  return [...byIdentity.values()]
}

function candidateIdentity(candidate: DiscoveryCandidate): string {
  const recordId = candidate.sourceRecordId?.trim()
  const stableSourceKey =
    recordId || candidate.normalization?.canonicalUrl?.trim() || candidate.sourceUrl.trim() || candidate.candidateId
  return `${candidate.sourceId}:${stableSourceKey}`
}

function companyContextsFor(
  companies: readonly DiscoveryCompanyResult[],
): ReadonlyMap<string, readonly string[]> {
  const contexts = new Map<string, Set<string>>()
  for (const company of companies) {
    for (const candidate of [
      ...company.candidates,
      ...(company.actionableCandidates ?? []),
      ...(company.excludedCandidates ?? []),
    ]) {
      const identity = candidateIdentity(candidate)
      const names = contexts.get(identity) ?? new Set<string>()
      names.add(companyNameFor(company.companyId))
      contexts.set(identity, names)
    }
  }
  return new Map([...contexts].map(([identity, names]) => [identity, [...names]]))
}

export default function DiscoveryResults({ outcome }: { outcome: DiscoveryRunOutcome }) {
  const isLiveFunding = outcome.scenario === 'live' && outcome.domain === 'funding'
  const banner = isLiveFunding ? liveFundingBanner(outcome) : null
  const sourceId = runSourceId(outcome)
  const isHistoricalSource = sourceId === USA_SPENDING_SOURCE_ID
  const companyContexts = companyContextsFor(outcome.companies)

  const importedPreview = loadImportedTargetCompanies()
  const targetCompanies = importedPreview ? csvPreviewToTargetCompanies(importedPreview) : []
  const actionableCandidates = uniqueCandidates(
    outcome.companies.flatMap((company) => company.actionableCandidates ?? company.candidates),
  )
  const actionableIdentities = new Set(actionableCandidates.map(candidateIdentity))
  const excludedCandidates = uniqueCandidates(outcome.companies.flatMap((company) => company.excludedCandidates ?? []))
    .filter((candidate) => !actionableIdentities.has(candidateIdentity(candidate)))
  const targetOpportunities: TargetOpportunityInput[] = actionableCandidates.map((candidate) => ({
    opportunityId: candidate.candidateId,
    opportunityType: outcome.domain === 'funding' ? 'funding' : 'procurement',
    title: candidate.sourceTitle,
    description: candidate.sourceSummary ?? candidate.sourceOrganization ?? null,
    country: null,
    sectors: candidate.sourceEvidence?.sectors ?? null,
    requirements: candidate.sourceEvidence?.lifecycleNotes ?? null,
    applicantTypes: null,
    deadline: candidate.sourceDeadline,
    status: candidate.sourceStatus,
    sourceUrl: candidate.sourceUrl,
  }))
  const targetRecommendations =
    targetCompanies.length > 0 && targetOpportunities.length > 0
      ? recommendOpportunitiesForTargetCompanies(targetCompanies, targetOpportunities)
      : []
  const recommendationsByOpportunity = new Map<string, typeof targetRecommendations>()
  for (const recommendation of targetRecommendations) {
    const group = recommendationsByOpportunity.get(recommendation.opportunityId) ?? []
    group.push(recommendation)
    recommendationsByOpportunity.set(recommendation.opportunityId, group)
  }
  const recommendationGroups = [...recommendationsByOpportunity.values()]

  return (
    <section className="card dg-panel" aria-label="Discovery result">
      <h2 className="dg-panel__title">Run result</h2>

      {banner !== null ? (
        <p className="dg-note dg-banner" role="note">
          Live source: {banner.text}
        </p>
      ) : null}

      <div className="statgrid dg-stats" role="group" aria-label="Run summary">
        {SUMMARY_METRICS.map((metric) => (
          <div key={metric.key} className="stat">
            <div className="stat__count">{summaryValue(outcome, metric.key)}</div>
            <div className="stat__label">{metric.label}</div>
          </div>
        ))}
      </div>

      <p className="dg-note">
        {outcome.scenario === 'live' && outcome.domain === 'funding'
          ? banner !== null && banner.sourceId === USA_SPENDING_SOURCE_ID
            ? 'This run queried the real USAspending source: official public US federal spending data. Results are federal award records — obligated grants, not open grant solicitations. Canonical award records and review items are shown once per run.'
            : banner !== null && banner.sourceId === EU_SEDIA_SOURCE_ID
              ? euSediaNote(outcome)
              : grantsGovNote(outcome)
          : outcome.scenario === 'live'
            ? liveProcurementNote(outcome)
            : 'Findings come from the local scenario sources only. A listing found by several company searches is shown once per run, and canonical review items land in the Human review queue.'}
      </p>

      <AutomationWorkflow outcome={outcome} />

      <h3 className="dg-subtitle">Company results</h3>
      <ul className="dg-results">
        {outcome.companies.map((company) => {
          const state = COMPANY_STATE_FOR_OUTCOME[company.outcome]
          const hasOpportunityRecords =
            sourceId !== null &&
            [GRANTS_GOV_SOURCE_ID, EU_SEDIA_SOURCE_ID, TED_SOURCE_ID, FTS_SOURCE_ID, USA_SPENDING_SOURCE_ID].includes(
              sourceId,
            )
          const gv = hasOpportunityRecords ? sourceCounts(company, outcome.requestedAt) : null
          return (
            <li key={company.companyId}>
              <details className="dg-result">
                <summary className="dg-result__summary">
                  <span className="dg-result__name">{companyNameFor(company.companyId)}</span>
                  <span className={`dg-chip dg-chip--${state}`}>{OUTCOME_LABEL[company.outcome]}</span>
                  <span className="dg-result__counts">
                    Candidates: {company.candidates.length} · Needs review: {company.needsReview}
                    {gv !== null
                      ? ` · Retrieved: ${gv.retrieved} · Open (passed gate): ${gv.open} · Excluded: ${gv.excluded}`
                      : ''}
                  </span>
                </summary>
                <div className="dg-result__body">
                  <ul className="dg-source-list">
                    {(company.sourceResults ?? []).map((result) => (
                      <li key={result.sourceId} className="dg-source">
                        <code className="idbadge">{result.sourceId}</code>
                        <span>{result.sourceName ?? 'Unknown source'}</span>
                        <SourceKindChip sourceId={result.sourceId} />
                        <span className={`dg-chip dg-chip--${COMPANY_STATE_FOR_OUTCOME[result.outcome]}`}>
                          {OUTCOME_LABEL[result.outcome]}
                        </span>
                        <span className="dg-source__meta">
                          candidates {result.candidatesCreated} · errors {result.errors?.length ?? 0} · warnings{' '}
                          {result.warnings?.length ?? 0}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {company.candidates.length === 0 ? (
                    <p className="dg-empty">{emptyMessage(company)}</p>
                  ) : (
                    <p className="dg-note">
                      Company-level source results are shown above. Each canonical source record is listed once below;
                      imported-company relevance assessments are grouped by record.
                    </p>
                  )}
                </div>
              </details>
            </li>
          )
        })}
      </ul>

      {actionableCandidates.length > 0 || excludedCandidates.length > 0 ? (
        <>
          <h3 id="discovered-source-records" className="dg-subtitle">
            Discovered source records
          </h3>
          {isHistoricalSource ? (
            <p className="dg-note" role="note">
              Historical context — obligated federal award records, NOT open grant solicitations. This shows what has
              already been awarded, not what is available to apply for.
            </p>
          ) : null}
          {actionableCandidates.length > 0 ? (
            <OpportunityCandidates
              candidates={actionableCandidates}
              now={outcome.requestedAt}
              companyContexts={companyContexts}
            />
          ) : null}
          <ExcludedCandidates
            candidates={excludedCandidates}
            now={outcome.requestedAt}
            companyContexts={companyContexts}
          />
        </>
      ) : null}

      {targetRecommendations.length > 0 ? (
        <>
          <h3 className="dg-subtitle">Target company recommendations</h3>
          <p className="dg-note" role="note">
            Recommendations are generated from the imported target-company CSV and the discovered source records.
            Relevance is not eligibility, approval, or application readiness.
          </p>
          <ul className="dg-results">
            {recommendationGroups.map((companyResults) => {
              const recommendation = companyResults[0]
              if (recommendation === undefined) return null
              return (
                <li key={recommendation.opportunityId}>
                  <details className="dg-result">
                    <summary className="dg-result__summary">
                      <span className="dg-result__name">{recommendation.opportunityTitle}</span>
                      <span className="dg-result__counts">
                        {companyResults.length} company assessment{companyResults.length === 1 ? '' : 's'}
                      </span>
                    </summary>
                    <div className="dg-result__body">
                      <ul className="dg-candidates">
                        {companyResults.map((result) => (
                          <li key={result.companyId} className="dg-candidate">
                            <span className="dg-candidate__meta">
                              <strong>{result.companyName}</strong> · {result.outcome} · deadline{' '}
                              {result.deadline ?? '—'} · status {result.status ?? 'unknown'}
                            </span>
                            <span className="dg-candidate__meta">{result.reasons.join(' ')}</span>
                            {result.matchedFields.length > 0 ? (
                              <span className="dg-candidate__meta">Matched: {result.matchedFields.join(', ')}</span>
                            ) : null}
                            {result.missingFields.length > 0 ? (
                              <span className="dg-candidate__meta">Missing: {result.missingFields.join(', ')}</span>
                            ) : null}
                            {result.uncertainty.length > 0 ? (
                              <span className="dg-candidate__meta">Uncertainty: {result.uncertainty.join(' ')}</span>
                            ) : null}
                            {result.mismatchedFields.length > 0 ? (
                              <span className="dg-candidate__meta">Mismatches: {result.mismatchedFields.join(', ')}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <span className="dg-candidate__meta">
                        {recommendation.opportunityId} · source record is linked in Discovered source records above
                      </span>
                    </div>
                  </details>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}

      <h3 className="dg-subtitle">Review handoff</h3>
      <div className="dg-handoff">
        <Link to="/discovery?view=human-review" className="btn">
          View Review Queue
        </Link>
        {outcome.needsReview > 0 ? (
          <Link
            to={`/review?run=${encodeURIComponent(outcome.runId)}`}
            className="btn"
          >
            Review {outcome.needsReview} {outcome.needsReview === 1 ? 'candidate' : 'candidates'}
          </Link>
        ) : null}
      </div>
    </section>
  )
}