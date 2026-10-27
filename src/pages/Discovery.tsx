import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ReviewQueue from '../components/review/ReviewQueue'
import type {
  DiscoveryFixtureScenario,
  DiscoveryLocation,
  DiscoveryRunOutcome,
  DiscoverySector,
} from '../automation/discovery-fixture'
import { discoveryFixtureStore } from '../automation/discovery-fixture'
import {
  DISCOVERY_DEMO_PARAM,
  resolveDiscoverySource,
} from '../automation/discovery-source'
import type { DiscoveryDomain } from '../automation/types'
import { liveDiscoveryStore } from '../live-source/live-discovery'
import { persistRunOutcome } from '../live-source/persisted-runs'
import { liveGrantsGovDiscoveryStore } from '../live-source/live-grantsgov-discovery'
import { liveEuSediaDiscoveryStore } from '../live-source/live-eu-sedia-discovery'
import { liveUsaSpendingDiscoveryStore } from '../live-source/live-funding-discovery'
import { listDiscoveryRuns } from '../live-source/discovery-run-history'
import { reviewFixtureStore } from '../automation/review-fixture'

import { loadImportedTargetCompanies, subscribeImportedTargetCompanies } from '../target-companies/store'
import { csvPreviewToTargetCompanies } from '../target-companies/profiles'
import { COMPANY_DIRECTORY_NAMES } from '../data/company-directory-names'
import TargetCompaniesUpload from '../components/target-companies/TargetCompaniesUpload'
import TargetCompanyLiveDiscovery from '../components/target-companies/TargetCompanyLiveDiscovery'
import CompanySelector from '../components/discovery/CompanySelector'
import DiscoveryControls from '../components/discovery/DiscoveryControls'
import DiscoveryResults from '../components/discovery/DiscoveryResults'
import RunHistory from '../components/discovery/RunHistory'

export default function Discovery() {
  const [params] = useSearchParams()
  const source = resolveDiscoverySource(params.get(DISCOVERY_DEMO_PARAM))
  const view = params.get('view') ?? 'discovery'

  const [importedPreview, setImportedPreview] = useState(() => loadImportedTargetCompanies())
  useEffect(
    () => subscribeImportedTargetCompanies(() => setImportedPreview(loadImportedTargetCompanies())),
    [],
  )

  const importedCompanies = useMemo(
    () => (importedPreview && importedPreview.rows.length > 0 ? csvPreviewToTargetCompanies(importedPreview) : []),
    [importedPreview],
  )

  const companies = useMemo(
    () =>
      importedCompanies.length > 0
        ? importedCompanies.map((company) => company.name)
        : [...COMPANY_DIRECTORY_NAMES],
    [importedCompanies],
  )

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    if (importedCompanies.length === 0) return
    setSelected(new Set(importedCompanies.map((company) => company.name)))
  }, [importedCompanies])

  const [domain, setDomain] = useState<DiscoveryDomain>('funding')
  const [scenario, setScenario] = useState<DiscoveryFixtureScenario>('standard')
  const [sector, setSector] = useState<DiscoverySector>('all')
  const [keyword, setKeyword] = useState('')
  const [location, setLocation] = useState<DiscoveryLocation>('all')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<DiscoveryRunOutcome | null>(null)

  const [history, setHistory] = useState<DiscoveryRunOutcome[]>(() => [
    ...liveEuSediaDiscoveryStore.history(),
    ...liveGrantsGovDiscoveryStore.history(),
    ...liveUsaSpendingDiscoveryStore.history(),
    ...liveDiscoveryStore.history(),
    ...discoveryFixtureStore.history(),
  ])

  // Overview metrics from real state
  const totalRuns = listDiscoveryRuns().length
  const pendingReviews = reviewFixtureStore.items().filter((item) => item.reviewStatus === 'NEEDS_REVIEW').length

  function toggle(companyId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(companyId)) next.delete(companyId)
      else next.add(companyId)
      return next
    })
  }

  function selectAllVisible(names: readonly string[]) {
    setSelected((prev) => new Set([...prev, ...names]))
  }

  function clearSelection() {
    setSelected(new Set())
  }

  // Demo fixture run for ?demo=1 tests
  function runDiscovery(runDomain: DiscoveryDomain) {
    if (selected.size === 0 || running) return
    setRunning(true)
    setRunError(null)
    setOutcome(null)

    try {
      const context = discoveryFixtureStore.beginRun({
        domain: runDomain,
        scenario,
        sector,
        keyword,
        location,
      })
      const companyResults = []
      for (const companyName of selected) {
        companyResults.push(discoveryFixtureStore.runCompany(context, companyName))
      }
      const completed = discoveryFixtureStore.finishRun(context, companyResults)
      persistRunOutcome(completed)
      setOutcome(completed)
      setHistory([
        ...liveEuSediaDiscoveryStore.history(),
        ...liveGrantsGovDiscoveryStore.history(),
        ...liveUsaSpendingDiscoveryStore.history(),
        ...liveDiscoveryStore.history(),
        ...discoveryFixtureStore.history(),
      ])
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
    }
  }

  async function runLiveDiscovery() {
    if (selected.size === 0 || running) return
    const selectedNames = [...selected]
    setRunning(true)
    setRunError(null)

    const yieldToRender = (delay = 0) => new Promise<void>((resolve) => window.setTimeout(resolve, delay))
    try {
      await yieldToRender(150)
      const context = liveDiscoveryStore.beginRun({ sector, keyword, location })
      const companyResults = []
      for (const companyName of selectedNames) {
        await yieldToRender()
        companyResults.push(await liveDiscoveryStore.runCompany(context, companyName))
      }
      const completed = liveDiscoveryStore.finishRun(context, companyResults)
      persistRunOutcome(completed)
      setOutcome(completed)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
    }
  }

  async function runLiveFundingDiscovery() {
    if (selected.size === 0 || running) return
    const selectedNames = [...selected]
    setRunning(true)
    setRunError(null)

    const yieldToRender = (delay = 0) => new Promise<void>((resolve) => window.setTimeout(resolve, delay))
    try {
      await yieldToRender(150)
      const context = liveGrantsGovDiscoveryStore.beginRun({ sector, keyword, location })
      const companyResults = []
      for (const companyName of selectedNames) {
        await yieldToRender()
        companyResults.push(await liveGrantsGovDiscoveryStore.runCompany(context, companyName))
      }
      const completed = liveGrantsGovDiscoveryStore.finishRun(context, companyResults)
      persistRunOutcome(completed)
      setOutcome(completed)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
    }
  }

  async function runLiveEuFundingDiscovery() {
    if (selected.size === 0 || running) return
    const selectedNames = [...selected]
    setRunning(true)
    setRunError(null)

    const yieldToRender = (delay = 0) => new Promise<void>((resolve) => window.setTimeout(resolve, delay))
    try {
      await yieldToRender(150)
      const context = liveEuSediaDiscoveryStore.beginRun({ sector, keyword, location })
      const companyResults = []
      for (const companyName of selectedNames) {
        await yieldToRender()
        companyResults.push(await liveEuSediaDiscoveryStore.runCompany(context, companyName))
      }
      const completed = liveEuSediaDiscoveryStore.finishRun(context, companyResults)
      persistRunOutcome(completed)
      setOutcome(completed)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
    }
  }

  // Sub-routes for review workspaces
  if (view === 'human-review') {
    return <ReviewQueue basePath="/discovery" workspaceView={view} title="Human Review" />
  }
  if (view === 'funding-review') {
    return (
      <ReviewQueue
        basePath="/discovery"
        workspaceView={view}
        domainFilter="funding"
        title="Funding Review"
      />
    )
  }
  if (view === 'procurement-review') {
    return (
      <ReviewQueue
        basePath="/discovery"
        workspaceView={view}
        domainFilter="procurement"
        title="Procurement Review"
      />
    )
  }
  if (view === 'approved') {
    return (
      <ReviewQueue
        basePath="/discovery"
        workspaceView={view}
        fixedStatus="APPROVED"
        title="Approved"
      />
    )
  }

  return (
    <section className="page" aria-labelledby="discovery-page-title">
      <header className="page__header">
        <h1 className="page__title" id="discovery-page-title">
          TVB Opportunity Intelligence
          <span className="sn-brand-badge" title="SafarNav Discovery Engine">
            SafarNav
          </span>
        </h1>
        <p className="page__description">
          Opportunity intelligence and discovery automation for your target portfolio companies.
        </p>
      </header>

      {/* Executive Overview Cards */}
      <div className="sn-overview-grid">
        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Total Companies</span>
            <span className="sn-stat-card__icon">🏢</span>
          </div>
          <span className="sn-stat-card__value">189</span>
          <span className="sn-stat-card__meta">
            {importedCompanies.length > 0 ? `${importedCompanies.length} active imported profiles` : 'Protected company directory'}
          </span>
        </div>

        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Discovery Runs</span>
            <span className="sn-stat-card__icon">🚀</span>
          </div>
          <span className="sn-stat-card__value">{totalRuns}</span>
          <span className="sn-stat-card__meta">Recorded in this session</span>
        </div>

        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Needing Review</span>
            <span className="sn-stat-card__icon" style={{ color: pendingReviews > 0 ? 'var(--accent)' : 'inherit' }}>
              ⚖️
            </span>
          </div>
          <span className="sn-stat-card__value">{pendingReviews}</span>
          <span className="sn-stat-card__meta">Candidates awaiting decision</span>
        </div>

        <div className="sn-stat-card">
          <div className="sn-stat-card__header">
            <span className="sn-stat-card__title">Integrated Sources</span>
            <span className="sn-stat-card__icon">🌐</span>
          </div>
          <span className="sn-stat-card__value">4</span>
          <span className="sn-stat-card__meta">Grants.gov · EU SEDIA · TED · USA</span>
        </div>
      </div>

      {/* Action Shortcuts */}
      <div className="sn-quick-actions">
        <div className="sn-quick-actions__intro">
          <h2 className="sn-quick-actions__title">Discovery &amp; Portfolio Shortcuts</h2>
          <p className="sn-quick-actions__desc">
            Import your target company CSV, execute automated discovery across government grants and procurement notices, or evaluate candidates in the human review queues.
          </p>
        </div>
        <div className="sn-quick-actions__buttons">
          <Link to="/companies" className="btn btn--outline">
            Browse Companies
          </Link>
          <Link to="/discovery?view=human-review" className="btn btn--outline">
            Review Queue
          </Link>
          <Link to="/history" className="btn btn--outline">
            Run History
          </Link>
          <Link to="/logs" className="btn btn--outline">
            Execution Logs
          </Link>
        </div>
      </div>

      {/* Demo Mode Banner (only when ?demo=1) */}
      {source.demo ? (
        <div className="mr-demo" role="note" data-testid="discovery-demo-banner" style={{ marginBottom: '16px' }}>
          <strong className="mr-demo__label">Demo mode active.</strong> Fixture scenarios below use demonstration
          records, not live discoveries. <Link to="/discovery">Exit demo mode</Link> to run against real target companies.
        </div>
      ) : null}

      {/* When in Demo Mode: Show CompanySelector and DiscoveryControls for demo test compatibility */}
      {source.demo ? (
        <div className="dg-grid" style={{ marginBottom: '24px' }}>
          <CompanySelector
            companies={companies}
            importedCompanies={importedCompanies.length > 0}
            selected={selected}
            demo={source.demo}
            onToggle={toggle}
            onSelectAllVisible={selectAllVisible}
            onClear={clearSelection}
          />
          <DiscoveryControls
            selectedCount={selected.size}
            running={running}
            demo={source.demo}
            domain={domain}
            scenario={scenario}
            sector={sector}
            keyword={keyword}
            location={location}
            onDomainChange={setDomain}
            onScenarioChange={setScenario}
            onSectorChange={setSector}
            onKeywordChange={setKeyword}
            onLocationChange={setLocation}
            onRun={runDiscovery}
            onRunLive={runLiveDiscovery}
            onRunLiveFunding={runLiveFundingDiscovery}
            onRunLiveEu={runLiveEuFundingDiscovery}
          />
        </div>
      ) : null}

      {/* CSV Target Companies Upload Area */}
      <TargetCompaniesUpload heading="Upload your company list" importLabel="Browse your computer" />

      {/* Live Discovery & Interactive Opportunity Cards */}
      <TargetCompanyLiveDiscovery />

      {/* Legacy Developer API Action Buttons (only visible in ?demo=1 test harness) */}
      {source.demo ? (
        <>
          <div className="listbar" style={{ marginTop: '20px' }}>
            <button
              type="button"
              className="btn"
              onClick={() => void runLiveDiscovery()}
              disabled={running || selected.size === 0}
            >
              Live TD
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void runLiveFundingDiscovery()}
              disabled={running || selected.size === 0}
            >
              Live FU
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void runLiveEuFundingDiscovery()}
              disabled={running || selected.size === 0}
            >
              Live EU
            </button>
          </div>

          {running ? <p role="status">Running discovery...</p> : null}

          {runError !== null ? (
            <p className="dg-empty" role="alert">
              Discovery run failed: {runError}
            </p>
          ) : null}

          {outcome !== null ? (
            <div className="listbar" style={{ marginTop: '16px' }}>
              <span>
                Run complete: {outcome.counts.candidatesCreated} candidates, {outcome.needsReview} needing review.
              </span>
            </div>
          ) : null}

          {outcome !== null ? <DiscoveryResults outcome={outcome} /> : null}

          <RunHistory runs={history} />
        </>
      ) : null}
    </section>
  )
}