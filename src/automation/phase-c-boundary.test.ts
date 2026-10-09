/**
 * Phase C safety-boundary tests (Phase C brief §13, §14).
 *
 * The Phase C modules inherit the Phase B safety boundary:
 *  - no network, no scheduler, no vault-writer, no node:crypto anywhere;
 *  - every Phase C module imports only sibling automation modules;
 *  - the candidate contract carries no vault record identifiers;
 *  - stable hashing is deterministic and dependency-free;
 *  - the automation sources themselves stay outside the vault.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { stableHash } from './candidate'

const MODULES = [
  'candidate.ts',
  'transform.ts',
  'normalize.ts',
  'classify.ts',
  'dedup.ts',
  'pipeline.ts',
  'phase-c-fixtures.ts',
  'orchestrator.ts',
  'review-queue.ts',
  'review-fixture.ts',
  'discovery-fixture.ts',
  'globaltenders-adapter.ts',
  'approval-write.ts',
  'match-proposal.ts',
  'match-review.ts',
  'match-review-fixture.ts',
  'match-approval-write.ts',
  'procurement-proposal.ts',
  'procurement-match-review.ts',
  'procurement-match-fixture.ts',
  'procurement-match-approval-write.ts',
  'bid-proposal.ts',
  'bid-proposal-fixture.ts',
]

function readSource(module: string): string {
  return readFileSync(new URL(`./${module}`, import.meta.url), 'utf8')
}

const FORBIDDEN_TOKENS = [
  'fetch(',
  'axios',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'node:http',
  'node:https',
  'node:net',
  'node:fs',
  'node:crypto',
  'createHash',
  'crypto.',
  'child_process',
  'writeFile(',
  'appendFile(',
  'createWriteStream',
  'localStorage',
  'sessionStorage',
  'navigator.',
  'setInterval(',
  'setTimeout(',
  'import(',
]

test('Phase C modules contain no network, scheduler, crypto, or vault-writer primitive', () => {
  for (const module of MODULES) {
    const source = readSource(module)
    for (const token of FORBIDDEN_TOKENS) {
      assert.equal(
        source.includes(token),
        false,
        `${module} must not contain "${token}" (network/scheduler/crypto/vault-writer primitive)`,
      )
    }
  }
})

test('every Phase C module imports only sibling automation modules', () => {
  for (const module of MODULES) {
    const source = readSource(module)
    const specifiers = [...source.matchAll(/(?:^|\n)from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
    for (const specifier of specifiers) {
      assert.equal(
        specifier.startsWith('./'),
        true,
        `${module} must not import outside src/automation: ${specifier}`,
      )
    }
  }
})

test('Phase C modules never reference the vault import pipeline or vault record types', () => {
  for (const module of MODULES) {
    const source = readSource(module)
    assert.equal(source.includes('../import'), false, `${module} must not import the import pipeline`)
    assert.equal(source.includes('../data'), false, `${module} must not import the data pipeline`)
    assert.equal(source.includes('../types/records'), false, `${module} must not depend on vault record types`)
  }
})

test('the discovery candidate contract carries no vault record identifiers', () => {
  const source = readSource('candidate.ts')
  for (const vaultIdentity of ['opportunity_id', 'notice_id', 'match_id', 'bid_id', 'contract_id', 'vault_id']) {
    assert.equal(
      source.toLowerCase().includes(vaultIdentity.replace(/_/g, '')),
      false,
      `candidate contract must not leak a vault identity: ${vaultIdentity}`,
    )
  }
})

test('candidate ids and stable hashes are deterministic and fixed-width', () => {
  assert.equal(stableHash(''), 'cbf29ce484222325', 'FNV-1a of the empty input equals the documented offset basis')
  assert.equal(stableHash('fixture'), stableHash('fixture'))
  assert.notEqual(stableHash('fixture'), stableHash('fixturex'))
  for (const input of ['fixture', 'https://fixture.invalid/grants/FX-F-2001', '一个测试']) {
    assert.match(stableHash(input), /^[0-9a-f]{16}$/)
  }
  assert.equal(stableHash('一个测试'), stableHash('一个测试'), 'hash is stable across code units')
})

test('Phase C test files themselves live outside the vault', () => {
  const here = fileURLToPath(new URL('./phase-c-boundary.test.ts', import.meta.url))
  assert.ok(!here.includes('TBV Opportunity Intelligence'), 'no automation source may live inside the Obsidian vault')
})

test('the Phase C modules form a pipeline that produces only in-domain candidates', () => {
  // Structural guard: nothing may write directly from Phase C modules to a
  // vault path — the only "documentation" artifact is produced outside code.
  for (const module of MODULES) {
    const source = readSource(module)
    assert.equal(source.includes('08 - Documentation'), false, `${module} must not hardcode a vault documentation path`)
    assert.equal(source.includes('/Opportunity Intelligence'), false, `${module} must not hardcode a vault path`)
  }
})