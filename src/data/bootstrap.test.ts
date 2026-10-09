import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = path.join(ROOT, 'scripts', 'ensure-snapshot.mjs')

/** A minimal but structurally valid snapshot fixture. */
const VALID_FIXTURE = JSON.stringify({
  schemaVersion: '1.2.0',
  generator: 'fixture',
  source: {},
  records: {},
  relationships: {},
  unresolvedLinks: [],
})

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tvb-bootstrap-'))
}

function run(env: Record<string, string>) {
  return spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

test('seeds the snapshot from the fixture when it is missing', () => {
  const dir = tempDir()
  const target = path.join(dir, 'generated', 'opportunity-data.json')
  const fixture = path.join(dir, 'fixture.json')
  fs.writeFileSync(fixture, VALID_FIXTURE)

  const result = run({ TVB_SNAPSHOT_TARGET: target, TVB_SNAPSHOT_FIXTURE: fixture })

  assert.equal(result.status, 0, result.stderr)
  assert.ok(fs.existsSync(target), 'target snapshot should be created')
  assert.equal(fs.readFileSync(target, 'utf8'), VALID_FIXTURE, 'target must be a byte copy of the fixture')
})

test('preserves an existing snapshot byte-for-byte', () => {
  const dir = tempDir()
  const target = path.join(dir, 'opportunity-data.json')
  const fixture = path.join(dir, 'fixture.json')
  const existing = '{"records":{"kept":true}}'
  fs.writeFileSync(target, existing)
  fs.writeFileSync(fixture, VALID_FIXTURE)

  const result = run({ TVB_SNAPSHOT_TARGET: target, TVB_SNAPSHOT_FIXTURE: fixture })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(target, 'utf8'), existing, 'existing snapshot must not be overwritten')
})

test('fails clearly when the fixture is missing', () => {
  const dir = tempDir()
  const target = path.join(dir, 'opportunity-data.json')
  const fixture = path.join(dir, 'does-not-exist.json')

  const result = run({ TVB_SNAPSHOT_TARGET: target, TVB_SNAPSHOT_FIXTURE: fixture })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /fixture/i)
  assert.ok(!fs.existsSync(target), 'must not create a snapshot without a fixture')
})

test('fails clearly when the fixture is not valid JSON', () => {
  const dir = tempDir()
  const target = path.join(dir, 'opportunity-data.json')
  const fixture = path.join(dir, 'bad.json')
  fs.writeFileSync(fixture, 'this is not json')

  const result = run({ TVB_SNAPSHOT_TARGET: target, TVB_SNAPSHOT_FIXTURE: fixture })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /not valid JSON/i)
  assert.ok(!fs.existsSync(target))
})

test('fails clearly when the fixture is not a snapshot shape', () => {
  const dir = tempDir()
  const target = path.join(dir, 'opportunity-data.json')
  const fixture = path.join(dir, 'shape.json')
  fs.writeFileSync(fixture, '{"schemaVersion":"1.2.0"}')

  const result = run({ TVB_SNAPSHOT_TARGET: target, TVB_SNAPSHOT_FIXTURE: fixture })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /records/i)
  assert.ok(!fs.existsSync(target))
})

test('the bootstrap cannot select the production Vault', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8')
  assert.ok(!source.includes('TVB Opportunity Intelligence'), 'must not reference the production vault name')
  assert.ok(!/V:\\\\TVB/.test(source), 'must not reference the production vault path')
  assert.ok(!source.includes('import/paths'), 'must not import the importer path config')

  // The default fixture is the committed demonstration fixture, not the vault.
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'data', 'test-fixtures', 'opportunity-data.fixture.json')))
})
