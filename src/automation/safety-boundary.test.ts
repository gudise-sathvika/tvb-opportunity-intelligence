/**
 * Safety-boundary tests (Phase B brief §10, §13, §14).
 *
 * These tests verify the architecture boundary at the source level, not just
 * object existence:
 *  - the adapter layer has no dependency on a vault writer (there is no
 *    Adapter → Vault Writer connection), and no network, scheduling, or
 *    browser-automation primitive anywhere in the framework;
 *  - every module in the framework imports only sibling automation modules;
 *  - adapter results carry raw candidates only — no vault record identifiers.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { DEFAULT_SOURCE_REGISTRY } from './registry'
import { createFixtureAdapter } from './fixture-adapter'
import { runDiscovery } from './discovery-run'
import { createDiscoveryRequest } from './request'
import type { DiscoveryRequest } from './request'

const MODULES = [
  'types.ts',
  'request.ts',
  'registry.ts',
  'adapter.ts',
  'discovery-run.ts',
  'fixture-adapter.ts',
  'ted-adapter.ts',
]

function readSource(module: string): string {
  return readFileSync(new URL(`./${module}`, import.meta.url), 'utf8')
}

const FORBIDDEN_NETWORK_AND_WRITER_TOKENS = [
  'fetch(',
  'axios',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'node:http',
  'node:https',
  'node:net',
  'node:fs',
  'child_process',
  'writeFile(',
  'appendFile(',
  'createWriteStream',
  'localStorage',
  'sessionStorage',
  'navigator.',
  'setInterval(',
  'setTimeout(',
]

test('the adapter layer has no vault-writer or network dependency', () => {
  for (const module of MODULES) {
    const source = readSource(module)
    for (const token of FORBIDDEN_NETWORK_AND_WRITER_TOKENS) {
      assert.equal(
        source.includes(token),
        false,
        `${module} must not contain "${token}" (network/scheduler/vault-writer primitive)`,
      )
    }
  }
})

test('every framework module imports only sibling automation modules', () => {
  for (const module of MODULES) {
    const source = readSource(module)
    const specifiers = [...source.matchAll(/(?:^|\n)from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    for (const specifier of specifiers) {
      assert.equal(
        specifier.startsWith('./'),
        true,
        `${module} must not import outside src/automation: ${specifier}`,
      )
    }
  }
})

test('the framework never references the vault import pipeline or record types', () => {
  for (const module of MODULES) {
    const source = readSource(module)
    assert.equal(source.includes('../import'), false, `${module} must not import the import pipeline`)
    assert.equal(source.includes('../data'), false, `${module} must not import the data pipeline`)
    assert.equal(source.includes('../types/records'), false, `${module} must not depend on vault record types`)
  }
})

test('adapter results carry raw candidates only — never vault record identifiers', () => {
  const request: DiscoveryRequest = createDiscoveryRequest({
    runId: 'RUN-BOUNDARY',
    companyId: 'COM-001',
    discoveryProfileId: 'DP-COM-001-v1',
    sourceId: 'SU-FX-001',
    domain: 'procurement',
    queryTerms: ['fixture construction'],
    exclusions: [],
    requestedAt: '2026-10-07T00:00:00.000Z',
  })
  const registry = DEFAULT_SOURCE_REGISTRY
  const result = runDiscovery(request, { registry, adapter: createFixtureAdapter('SU-FX-001') })

  assert.equal(result.status, 'SUCCESS')
  const rawKeys = Object.keys(result.results[0] ?? {})
  assert.deepEqual(
    rawKeys,
    [
      'sourceRecordId',
      'sourceUrl',
      'title',
      'description',
      'publicationDate',
      'deadline',
      'issuingOrganization',
      'country',
      'rawType',
      'rawPayload',
      'rawProvenance',
    ],
  )

  for (const vaultIdentity of ['opportunity_id', 'notice_id', 'match_id', 'bid_id', 'contract_id', 'vaultId']) {
    for (const key of rawKeys) {
      assert.equal(key.toLowerCase().includes(vaultIdentity.replace(/_/g, '')), false, `raw candidate is not a vault record (${vaultIdentity})`)
    }
  }
})

test('the framework performs no filesystem writes at runtime (no fs imports)', () => {
  for (const module of MODULES) {
    const source = readSource(module)
    for (const line of source.split('\n')) {
      if (line.includes("from 'node:fs'") || line.includes("from 'fs'")) {
        assert.fail(`${module} imports the filesystem`)
      }
    }
  }
})

test('source domains are hosts only — no URL can be dereferenced by accident in this phase', () => {
  for (const definition of DEFAULT_SOURCE_REGISTRY.list()) {
    assert.equal(definition.domain.includes('://'), false, `${definition.sourceId} records a host, never a URL to fetch`)
  }
  const registrySource = readSource('registry.ts')
  assert.equal(registrySource.includes('fixture.invalid'), true, 'fixture domain is the reserved non-resolvable TLD')
  assert.equal(registrySource.includes('globaltenders.com'), true, 'GlobalTenders records a real portal as metadata only')
})

test('the vault stayed untouched: this test file itself lives outside the vault', () => {
  const here = fileURLToPath(new URL('./safety-boundary.test.ts', import.meta.url))
  assert.ok(!here.includes('TBV Opportunity Intelligence'), 'no automation source may live inside the Obsidian vault')
})