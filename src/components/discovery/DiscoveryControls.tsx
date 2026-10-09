import type {
  DiscoveryFixtureScenario,
  DiscoveryLocation,
  DiscoverySector,
} from '../../automation/discovery-fixture'
import type { DiscoveryDomain } from '../../automation/types'
import DiscoveryFilters from './DiscoveryFilters'
import { DOMAIN_OPTIONS, SCENARIO_LABEL, SCENARIO_OPTIONS } from './labels'

interface DiscoveryControlsProps {
  selectedCount: number
  running: boolean
  domain: DiscoveryDomain
  scenario: DiscoveryFixtureScenario
  sector: DiscoverySector
  keyword: string
  location: DiscoveryLocation
  onDomainChange(domain: DiscoveryDomain): void
  onScenarioChange(scenario: DiscoveryFixtureScenario): void
  onSectorChange(sector: DiscoverySector): void
  onKeywordChange(keyword: string): void
  onLocationChange(location: DiscoveryLocation): void
  onRun(domain: DiscoveryDomain): void
  onRunLive(): void
  onRunLiveFunding(): void
  onRunLiveEu(): void
}

/**
 * Discovery controls (Phase G brief §5; Phase H §1–§2).
 *
 * Two modes — Grants and RFPs — and the two action buttons that each run their
 * own domain. The domain radios declare the mode; the matching run button is
 * shown as the primary action while the other stays available. The optional
 * Phase H filters (sector, keyword, location) are recorded on the discovery
 * request. Both buttons are disabled until at least one company is selected,
 * with an instruction instead of a dead control.
 */
export default function DiscoveryControls({
  selectedCount,
  running,
  domain,
  scenario,
  sector,
  keyword,
  location,
  onDomainChange,
  onScenarioChange,
  onSectorChange,
  onKeywordChange,
  onLocationChange,
  onRun,
  onRunLive,
  onRunLiveFunding,
  onRunLiveEu,
}: DiscoveryControlsProps) {
  const canRun = selectedCount > 0 && !running

  return (
    <section className="card dg-panel" aria-label="Discovery controls">
      <h2 className="dg-panel__title">Discovery</h2>

      <fieldset className="dg-fieldset">
        <legend className="dg-legend">What to look for</legend>
        <div className="dg-options">
          {DOMAIN_OPTIONS.map((option) => (
            <label key={option.key} className="dg-option">
              <input
                type="radio"
                name="dg-domain"
                value={option.key}
                checked={domain === option.key}
                onChange={() => onDomainChange(option.key)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <DiscoveryFilters
        sector={sector}
        keyword={keyword}
        location={location}
        onSectorChange={onSectorChange}
        onKeywordChange={onKeywordChange}
        onLocationChange={onLocationChange}
      />

      {selectedCount === 0 ? (
        <p className="dg-instruction">Select at least one company to enable a discovery run.</p>
      ) : (
        <p className="dg-instruction">
          {selectedCount} {selectedCount === 1 ? 'company is' : 'companies are'} selected. Pick a scenario for a
          fixture run, or run a live source search.
        </p>
      )}

      <div className="dg-actions" role="group" aria-label="Start discovery">
        <button
          type="button"
          className={domain === 'funding' ? 'btn dg-run--primary' : 'btn'}
          disabled={!canRun}
          onClick={() => onRun('funding')}
        >
          Run Grant Discovery
        </button>
        <button
          type="button"
          className={domain === 'procurement' ? 'btn dg-run--primary' : 'btn'}
          disabled={!canRun}
          onClick={() => onRun('procurement')}
        >
          Run RFP Discovery
        </button>
        <button
          type="button"
          className="btn dg-run--live"
          disabled={!canRun}
          onClick={onRunLiveFunding}
        >
          Run Live Funding Search
        </button>
        <button
          type="button"
          className="btn dg-run--live"
          disabled={!canRun}
          onClick={onRunLiveEu}
        >
          Run Live EU Funding Search
        </button>
        <button
          type="button"
          className="btn dg-run--live"
          disabled={!canRun}
          onClick={onRunLive}
        >
          Run Live TED Search
        </button>
      </div>
      <p className="dg-scenario-note">
        Live Funding Search sends one real read-only request per selected company to Grants.gov
        (api.grants.gov), the official public US federal grants portal, and returns grant
        <strong> opportunities</strong>. With no keyword it runs a broad search of <strong>posted</strong> opportunities
        (not the company name); with a keyword it uses that keyword. A record is marked Open (confirmed)
        only when the open-opportunity gate passes (posted status, future close date, official URL, provenance).
      </p>
      <p className="dg-scenario-note">
        Live EU Funding Search sends one real read-only request per run to the EU Funding &amp; Tenders Portal
        (api.tech.ec.europa.eu, the official European Commission search API). It returns Horizon <strong>grant
        topics</strong> and <strong>cascade funding calls</strong>. Blank keyword runs a broad search of requested
        grant/funding calls; a record is marked Open (confirmed) only when the open-call gate passes (status open for
        submission, a future deadline, an official EU link, and provenance). EU tenders are not requested in this phase.
      </p>
      <p className="dg-scenario-note">
        Live TED Search sends one real read-only request to the EU Tenders Electronic Daily source per selected
        company.
      </p>
      <p className="dg-scenario-note dg-scope-note" role="note">
        {keyword.trim() === ''
          ? 'No keyword entered: Live TED uses each company’s own name as its search term; Live Funding (Grants.gov) runs a broad search of posted opportunities instead.'
          : `Keyword “${keyword.trim()}” is used as the search term for every selected company instead of the company name.`}{' '}
        Live TED matches tender titles only — not buyer names, supplier names, or every tender field. Live Funding
        (Grants.gov) matches federal grant-opportunity records.
      </p>

      <fieldset className="dg-fieldset">
        <legend className="dg-legend">Scenario</legend>
        <div className="dg-options">
          {SCENARIO_OPTIONS.map((option) => (
            <label key={option.key} className="dg-option">
              <input
                type="radio"
                name="dg-scenario"
                value={option.key}
                checked={scenario === option.key}
                onChange={() => onScenarioChange(option.key)}
              />
              {option.label}
            </label>
          ))}
        </div>
        <p className="dg-scenario-note">
          Scenario {SCENARIO_LABEL[scenario]} runs the local source adapter — never a live source.
        </p>
      </fieldset>
    </section>
  )
}