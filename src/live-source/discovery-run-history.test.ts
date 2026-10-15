/**
 * Phase 15B run-history aggregation tests — fully offline.
 *
 * The aggregator only READS store histories. Fixture-store runs (pure,
 * offline) supply the recorded runs; a throwing global fetch proves lookups
 * never touch the network.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { discoveryFixtureStore } from '../automation/discovery-fixture'
import { findDiscoveryRun, listDiscoveryRuns } from './discovery-run-history'

function runFixture(keyword: string, requestedAt: string): string {
  const context = discoveryFixtureStore.beginRun({ domain: 'funding', scenario: 'standard', keyword, requestedAt })
  const outcome = discoveryFixtureStore.finishRun(context, [discoveryFixtureStore.runCompany(context, 'Aavo')])
  return outcome.runId
}

test('history lists newest runs with demo flags and finds by exact id', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('history lookup must never fetch')
  }) as unknown as typeof globalThis.fetch
  try {
    discoveryFixtureStore.reset()
    const first = runFixture('solar', '2026-10-01T00:00:00.000Z')
    const second = runFixture('wind', '2026-10-02T00:00:00.000Z')
    assert.notEqual(first, second)

    const runs = listDiscoveryRuns()
    assert.ok(runs.length >= 2)
    const ids = runs.map((entry) => entry.outcome.runId)
    assert.ok(ids.indexOf(second) < ids.indexOf(first), 'newest run lists first')
    for (const entry of runs) assert.equal(entry.demo, entry.outcome.scenario !== 'live')

    const found = findDiscoveryRun(second)
    assert.ok(found !== undefined)
    assert.equal(found.outcome.runId, second)
    assert.equal(found.outcome.keyword, 'wind')
    assert.deepEqual(found.outcome.companyIds, ['Aavo'])
    assert.equal(findDiscoveryRun('RUN-NOPE-9999'), undefined)
    assert.equal(findDiscoveryRun('   '), undefined)
  } finally {
    globalThis.fetch = realFetch
    discoveryFixtureStore.reset()
  }
})

test('opening a historical run performs no source requests', async () => {
  let calls = 0
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    calls += 1
    throw new Error('must not fetch')
  }) as unknown as typeof globalThis.fetch
  try {
    discoveryFixtureStore.reset()
    runFixture('solar', '2026-10-01T00:00:00.000Z')
    listDiscoveryRuns()
    const only = listDiscoveryRuns()[0]
    findDiscoveryRun(only.outcome.runId)
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = realFetch
    discoveryFixtureStore.reset()
  }
})

test('persisted runs survive a store reset and merge without duplicating live runs', async () => {
  const { persistRunOutcome, loadPersistedRuns } = await import('./persisted-runs')
  const values = new Map<string, string>()
  const realSession = (globalThis as Record<string, unknown>)['sessionStorage']
  ;(globalThis as Record<string, unknown>)['sessionStorage'] = {
    getItem: (key: string) => (values.has(key) ? values.get(key) ?? null : null),
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  } as unknown as Storage
  try {
    discoveryFixtureStore.reset()
    const context = discoveryFixtureStore.beginRun({ domain: 'funding', scenario: 'standard', keyword: 'solar', requestedAt: '2026-10-01T00:00:00.000Z' })
    const outcome = discoveryFixtureStore.finishRun(context, [discoveryFixtureStore.runCompany(context, 'Aavo')])
    persistRunOutcome(outcome)
    assert.equal(loadPersistedRuns().length, 1)

    // A reload-equivalent: live stores are empty, but the persisted run lists.
    discoveryFixtureStore.reset()
    const runs = listDiscoveryRuns()
    assert.ok(runs.some((entry) => entry.outcome.runId === outcome.runId))
    // Re-persisting the same run never duplicates it.
    persistRunOutcome(outcome)
    assert.equal(loadPersistedRuns().length, 1)
    // Corrupt storage is ignored, never guessed.
    values.set('tvb.discovery.runs.v1', 'not-json{{{')
    assert.deepEqual(loadPersistedRuns(), [])
  } finally {
    if (realSession === undefined) delete (globalThis as Record<string, unknown>)['sessionStorage']
    else (globalThis as Record<string, unknown>)['sessionStorage'] = realSession
    values.clear()
    discoveryFixtureStore.reset()
  }
})
