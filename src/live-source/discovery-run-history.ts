/**
 * Phase 15B unified Discovery run history — read-only aggregation.
 *
 * The five discovery stores each keep their own in-memory run history. This
 * module only READS those histories (never triggers a run, a bridge call, or
 * a mutation) and presents them newest-first for the History view. A run
 * lookup by id is a pure in-memory search: opening a historical run never
 * reruns discovery.
 *
 * Demo isolation: fixture runs (`scenario !== 'live'`) are flagged `demo` so
 * the UI can separate them from real runs; nothing is relabeled.
 *
 * Session boundary: histories live in module memory, so a full page refresh
 * or server restart empties them. `findDiscoveryRun` then returns undefined
 * and the UI must say so honestly instead of inventing history.
 */

import type { DiscoveryRunOutcome } from '../automation/discovery-fixture'
import { discoveryFixtureStore } from '../automation/discovery-fixture'
import { liveDiscoveryStore } from './live-discovery'
import { liveGrantsGovDiscoveryStore } from './live-grantsgov-discovery'
import { liveEuSediaDiscoveryStore } from './live-eu-sedia-discovery'
import { liveUsaSpendingDiscoveryStore } from './live-funding-discovery'
import { loadPersistedRuns } from './persisted-runs'

export interface RunHistoryEntry {
  readonly outcome: DiscoveryRunOutcome
  /** True for fixture (demo-mode) runs; false for real live-source runs. */
  readonly demo: boolean
}

function entriesOf(outcomes: readonly DiscoveryRunOutcome[]): readonly RunHistoryEntry[] {
  return outcomes.map((outcome) => ({ outcome, demo: outcome.scenario !== 'live' }))
}

/**
 * Every recorded run across all stores, newest-first by completion. Pure read;
 * performs no bridge calls and mutates nothing.
 */
export function listDiscoveryRuns(): readonly RunHistoryEntry[] {
  const liveById = new Set<string>()
  const live: RunHistoryEntry[] = []
  for (const entry of [
    ...entriesOf(liveDiscoveryStore.history()),
    ...entriesOf(liveGrantsGovDiscoveryStore.history()),
    ...entriesOf(liveEuSediaDiscoveryStore.history()),
    ...entriesOf(liveUsaSpendingDiscoveryStore.history()),
    ...entriesOf(discoveryFixtureStore.history()),
  ]) {
    liveById.add(entry.outcome.runId)
    live.push(entry)
  }
  // Session-restored runs fill gaps left by a reload; live memory always wins.
  const restored = entriesOf(loadPersistedRuns()).filter((entry) => !liveById.has(entry.outcome.runId))
  const all: RunHistoryEntry[] = [...live, ...restored]
  return all
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      if (a.entry.outcome.requestedAt !== b.entry.outcome.requestedAt) {
        return a.entry.outcome.requestedAt < b.entry.outcome.requestedAt ? 1 : -1
      }
      return b.index - a.index
    })
    .map(({ entry }) => entry)
}

/** Finds one recorded run by its exact run id. Never reruns discovery. */
export function findDiscoveryRun(runId: string): RunHistoryEntry | undefined {
  const trimmed = runId.trim()
  if (trimmed === '') return undefined
  return listDiscoveryRuns().find((entry) => entry.outcome.runId === trimmed)
}
