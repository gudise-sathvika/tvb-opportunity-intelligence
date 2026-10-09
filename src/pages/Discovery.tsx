import { useMemo, useState } from 'react'
import type { DiscoveryDomain } from '../automation/types'
import { discoveryFixtureStore } from '../automation/discovery-fixture'
import type {
  DiscoveryFixtureScenario,
  DiscoveryLocation,
  DiscoveryRunOutcome,
  DiscoverySector,
} from '../automation/discovery-fixture'
import { liveDiscoveryStore } from '../live-source/live-discovery'
import { liveUsaSpendingDiscoveryStore } from '../live-source/live-funding-discovery'
import { liveGrantsGovDiscoveryStore } from '../live-source/live-grantsgov-discovery'
import { liveEuSediaDiscoveryStore } from '../live-source/live-eu-sedia-discovery'
import { COMPANY_DIRECTORY_NAMES } from '../data/company-directory-names'
import CompanySelector from '../components/discovery/CompanySelector'
import DiscoveryControls from '../components/discovery/DiscoveryControls'
import DiscoveryResults from '../components/discovery/DiscoveryResults'
import RunHistory from '../components/discovery/RunHistory'
import { PROGRESS_LABEL } from '../components/discovery/labels'

type CompanyProgress = {
  name: string
  state: 'pending' | 'running' | 'completed'
}

export default function Discovery() {
  const companies = useMemo(() => [...COMPANY_DIRECTORY_NAMES], [])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [domain, setDomain] = useState<DiscoveryDomain>('funding')
  const [scenario, setScenario] = useState<DiscoveryFixtureScenario>('standard')
  const [sector, setSector] = useState<DiscoverySector>('all')
  const [keyword, setKeyword] = useState('')
  const [location, setLocation] = useState<DiscoveryLocation>('all')
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<DiscoveryRunOutcome | null>(null)
  const [progress, setProgress] = useState<CompanyProgress[]>([])
  const [runError, setRunError] = useState<string | null>(null)
  const [history, setHistory] = useState<readonly DiscoveryRunOutcome[]>(() => [
    ...liveEuSediaDiscoveryStore.history(),
    ...liveGrantsGovDiscoveryStore.history(),
    ...liveUsaSpendingDiscoveryStore.history(),
    ...liveDiscoveryStore.history(),
    ...discoveryFixtureStore.history(),
  ])

  function toggle(companyId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(companyId)) next.delete(companyId)
      else next.add(companyId)
      return next
    })
  }

  function selectAllVisible(companyNames: readonly string[]) {
    setSelected((previous) => new Set([...previous, ...companyNames]))
  }
  const clearSelection = () => setSelected(new Set())

  async function runDiscovery(runDomain: DiscoveryDomain) {
    if (selected.size === 0 || running) return

    const selectedNames = [...selected]
    setRunning(true)
    setOutcome(null)
    setRunError(null)
    setProgress(selectedNames.map((name) => ({ name, state: 'pending' })))

    const yieldToRender = (delay = 0) => new Promise<void>((resolve) => window.setTimeout(resolve, delay))

    try {
      await yieldToRender(150)
      const context = discoveryFixtureStore.beginRun({
        domain: runDomain,
        scenario,
        sector,
        keyword,
        location,
      })
      const companyResults = []

      for (const [index, companyName] of selectedNames.entries()) {
        setProgress((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, state: 'running' } : item,
          ),
        )
        await yieldToRender()
        companyResults.push(discoveryFixtureStore.runCompany(context, companyName))
        setProgress((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, state: 'completed' } : item,
          ),
        )
      }

      const completed = discoveryFixtureStore.finishRun(context, companyResults)
      setOutcome(completed)
      setHistory([
        ...liveEuSediaDiscoveryStore.history(),
        ...liveGrantsGovDiscoveryStore.history(),
        ...liveDiscoveryStore.history(),
        ...discoveryFixtureStore.history(),
      ])
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
      setProgress([])
    }
  }

  async function runLiveDiscovery() {
    if (selected.size === 0 || running) return

    const selectedNames = [...selected]
    setRunning(true)
    setOutcome(null)
    setRunError(null)
    setProgress(selectedNames.map((name) => ({ name, state: 'pending' })))

    const yieldToRender = (delay = 0) => new Promise<void>((resolve) => window.setTimeout(resolve, delay))

    try {
      await yieldToRender(150)
      const context = liveDiscoveryStore.beginRun({ sector, keyword, location })
      const companyResults = []

      for (const [index, companyName] of selectedNames.entries()) {
        setProgress((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, state: 'running' } : item,
          ),
        )
        await yieldToRender()
        companyResults.push(await liveDiscoveryStore.runCompany(context, companyName))
        setProgress((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, state: 'completed' } : item,
          ),
        )
      }

      const completed = liveDiscoveryStore.finishRun(context, companyResults)
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
      setProgress([])
    }
  }

  async function runLiveFundingDiscovery() {
    if (selected.size === 0 || running) return

    const selectedNames = [...selected]
    setRunning(true)
    setOutcome(null)
    setRunError(null)
    setProgress(selectedNames.map((name) => ({ name, state: 'pending' })))

    const yieldToRender = (delay = 0) => new Promise<void>((resolve) => window.setTimeout(resolve, delay))

    try {
      await yieldToRender(150)
      const context = liveGrantsGovDiscoveryStore.beginRun({ sector, keyword, location })
      const companyResults = []

      for (const [index, companyName] of selectedNames.entries()) {
        setProgress((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, state: 'running' } : item,
          ),
        )
        await yieldToRender()
        companyResults.push(await liveGrantsGovDiscoveryStore.runCompany(context, companyName))
        setProgress((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, state: 'completed' } : item,
          ),
        )
      }

      const completed = liveGrantsGovDiscoveryStore.finishRun(context, companyResults)
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
      setProgress([])
    }
  }

  async function runLiveEuFundingDiscovery() {
    if (selected.size === 0 || running) return

    const selectedNames = [...selected]
    setRunning(true)
    setOutcome(null)
    setRunError(null)
    setProgress(selectedNames.map((name) => ({ name, state: 'pending' })))

    const yieldToRender = (delay = 0) => new Promise<void>((resolve) => window.setTimeout(resolve, delay))

    try {
      await yieldToRender(150)
      const context = liveEuSediaDiscoveryStore.beginRun({ sector, keyword, location })
      const companyResults = []

      for (const [index, companyName] of selectedNames.entries()) {
        setProgress((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, state: 'running' } : item,
          ),
        )
        await yieldToRender()
        companyResults.push(await liveEuSediaDiscoveryStore.runCompany(context, companyName))
        setProgress((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, state: 'completed' } : item,
          ),
        )
      }

      const completed = liveEuSediaDiscoveryStore.finishRun(context, companyResults)
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
      setProgress([])
    }
  }

  return (
    <section className="page">
      <header className="page__header">
        <h1 className="page__title">Discovery</h1>
        <p className="page__description">
          Find grants and RFPs for TVB companies.
        </p>
      </header>

      <div className="dg-grid">
        <CompanySelector
          companies={companies}
          selected={selected}
          onToggle={toggle}
          onSelectAllVisible={selectAllVisible}
          onClear={clearSelection}
        />
        <DiscoveryControls
          selectedCount={selected.size}
          running={running}
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

      <p className="dg-note dg-banner" role="note">
        Scenario mode — runs against local source adapters
      </p>

      {runError !== null ? (
        <p className="dg-empty" role="alert">
          Discovery run failed: {runError}
        </p>
      ) : null}

      {progress.length > 0 ? (
        <section className="card dg-panel dg-progress" aria-label="Discovery progress">
          <h2 className="dg-panel__title">Running discovery</h2>
          <ul className="dg-progress__list">
            {progress.map((item) => (
              <li className="dg-progress__row" key={item.name}>
                <span className={`dg-chip dg-chip--${item.state}`}>{PROGRESS_LABEL[item.state]}</span>
                <span>{item.name}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {outcome !== null ? <DiscoveryResults outcome={outcome} /> : null}
      <RunHistory runs={history} />
    </section>
  )
}