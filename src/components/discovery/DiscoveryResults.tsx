import { Link } from 'react-router-dom'
import type { DiscoveryCompanyResult, DiscoveryRunOutcome } from '../../automation/discovery-fixture'
import { EU_SEDIA_SOURCE_ID, GRANTS_GOV_SOURCE_ID, USA_SPENDING_SOURCE_ID } from '../../automation/registry'
import { evaluateOpenOpportunity } from '../../automation/grantsgov-gate'
import { evaluateEuOpenOpportunity } from '../../automation/eu-sedia-gate'
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
    'Each opportunity shows its agency, status, close date, and official link; the open-opportunity gate marks a record Open (confirmed) only when the status is posted, the close date is in the future, the URL is official, and provenance is present. Review items are produced per company run.'
  return `${lead} ${tail}`
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
    'Each record shows its award type, source status, deadline, and official EU link; the open-call gate marks a record Open (confirmed) only when the status is open for submission, the deadline is in the future, the link is official, and provenance is present. Tenders (type 0) are not requested in this phase. Review items are produced per company run.'
  return `${lead} ${tail}`
}

interface GrantsGovCounts {
  retrieved: number
  open: number
  excluded: number
}

/** Phase 20C counts: retrieved, passed the open gate, and excluded with a reason. */
function grantsGovCounts(company: DiscoveryCompanyResult, now: string): GrantsGovCounts {
  let open = 0
  for (const candidate of company.candidates) {
    if (evaluateOpenOpportunity(candidate, now).open) open += 1
  }
  const retrieved = company.candidates.length
  return { retrieved, open, excluded: retrieved - open }
}

/** Phase 20C: real opportunity detail — title, agency, status, close date, official link, gate verdict. */
function GrantsGovCandidates({ company, now }: { company: DiscoveryCompanyResult; now: string }) {
  return (
    <ul className="dg-candidates">
      {company.candidates.map((candidate) => {
        const verdict = evaluateOpenOpportunity(candidate, now)
        return (
          <li key={candidate.candidateId} className="dg-candidate">
            <a className="dg-candidate__title" href={candidate.sourceUrl} target="_blank" rel="noreferrer">
              {candidate.sourceTitle}
            </a>
            <span className="dg-candidate__meta">
              {candidate.sourceOrganization ?? 'Unknown agency'} · status {candidate.sourceStatus ?? 'unknown'} · closes{' '}
              {candidate.sourceDeadline ?? '—'}
            </span>
            <a className="dg-candidate__link" href={candidate.sourceUrl} target="_blank" rel="noreferrer">
              Official Grants.gov record
            </a>
            <span className={`dg-chip dg-chip--${verdict.open ? 'completed' : 'failed'}`}>
              {verdict.open ? 'Open (confirmed)' : `Excluded: ${verdict.reasons[0] ?? 'failed gate'}`}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Phase 21C EU counts: retrieved, passed the open-call gate, and excluded. */
function euSediaCounts(company: DiscoveryCompanyResult, now: string): GrantsGovCounts {
  let open = 0
  for (const candidate of company.candidates) {
    if (evaluateEuOpenOpportunity(candidate, now).open) open += 1
  }
  const retrieved = company.candidates.length
  return { retrieved, open, excluded: retrieved - open }
}

/** Phase 21C: real EU record detail — title, award type, status, deadline, official link, gate verdict. */
function EuSediaCandidates({ company, now }: { company: DiscoveryCompanyResult; now: string }) {
  return (
    <ul className="dg-candidates">
      {company.candidates.map((candidate) => {
        const verdict = evaluateEuOpenOpportunity(candidate, now)
        return (
          <li key={candidate.candidateId} className="dg-candidate">
            <a className="dg-candidate__title" href={candidate.sourceUrl} target="_blank" rel="noreferrer">
              {candidate.sourceTitle}
            </a>
            <span className="dg-candidate__meta">
              {candidate.sourceRawType ?? 'UNKNOWN'} · status {candidate.sourceStatus ?? 'unknown'} · deadline{' '}
              {candidate.sourceDeadline ?? '—'}
            </span>
            <a className="dg-candidate__link" href={candidate.sourceUrl} target="_blank" rel="noreferrer">
              Official EU portal record
            </a>
            <span className={`dg-chip dg-chip--${verdict.open ? 'completed' : 'failed'}`}>
              {verdict.open ? 'Open (confirmed)' : `Excluded: ${verdict.reasons[0] ?? 'failed gate'}`}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export default function DiscoveryResults({ outcome }: { outcome: DiscoveryRunOutcome }) {
  const isLiveFunding = outcome.scenario === 'live' && outcome.domain === 'funding'
  const banner = isLiveFunding ? liveFundingBanner(outcome) : null
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
            ? 'This run queried the real USAspending source: official public US federal spending data. Results are federal award records — obligated grants, not open grant solicitations. Each award is stored once per company run, and review items land in the Human review queue.'
            : banner !== null && banner.sourceId === EU_SEDIA_SOURCE_ID
              ? euSediaNote(outcome)
              : grantsGovNote(outcome)
          : outcome.scenario === 'live'
            ? 'This run queried the real TED source. Each listing is stored once per company run, and review items land in the Human review queue.'
            : 'Findings come from the local scenario sources only. A listing found for several companies stays listed once per company run, and review items land in the Human review queue.'}
      </p>

      <AutomationWorkflow outcome={outcome} />

      <h3 className="dg-subtitle">Company results</h3>
      <ul className="dg-results">
        {outcome.companies.map((company) => {
          const state = COMPANY_STATE_FOR_OUTCOME[company.outcome]
          const isGrantsGov = banner?.sourceId === GRANTS_GOV_SOURCE_ID
          const isEuSedia = banner?.sourceId === EU_SEDIA_SOURCE_ID
          const gv = isGrantsGov
            ? grantsGovCounts(company, outcome.requestedAt)
            : isEuSedia
              ? euSediaCounts(company, outcome.requestedAt)
              : null
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
                    {company.sourceResults.map((result) => (
                      <li key={result.sourceId} className="dg-source">
                        <code className="idbadge">{result.sourceId}</code>
                        <span>{result.sourceName ?? 'Unknown source'}</span>
                        <SourceKindChip sourceId={result.sourceId} />
                        <span className={`dg-chip dg-chip--${COMPANY_STATE_FOR_OUTCOME[result.outcome]}`}>
                          {OUTCOME_LABEL[result.outcome]}
                        </span>
                        <span className="dg-source__meta">
                          candidates {result.candidatesCreated} · errors {result.errors.length} · warnings{' '}
                          {result.warnings.length}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {company.candidates.length === 0 ? (
                    <p className="dg-empty">{emptyMessage(company)}</p>
                  ) : isGrantsGov ? (
                    <GrantsGovCandidates company={company} now={outcome.requestedAt} />
                  ) : isEuSedia ? (
                    <EuSediaCandidates company={company} now={outcome.requestedAt} />
                  ) : (
                    <ul className="dg-candidates">
                      {company.candidates.map((candidate) => (
                        <li key={candidate.candidateId}>{candidate.sourceTitle}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            </li>
          )
        })}
      </ul>

      <h3 className="dg-subtitle">Review handoff</h3>
      <div className="dg-handoff">
        <Link to="/review" className="btn">
          View Review Queue
        </Link>
        {outcome.needsReview > 0 ? (
          <Link to="/review" className="btn">
            Review {outcome.needsReview} {outcome.needsReview === 1 ? 'candidate' : 'candidates'}
          </Link>
        ) : null}
      </div>
    </section>
  )
}