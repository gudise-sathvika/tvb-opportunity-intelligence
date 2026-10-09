/**
 * Clean-checkout build bootstrap.
 *
 * Seeds the git-ignored generated snapshot from a committed, non-sensitive
 * DEMONSTRATION fixture so a clean checkout can typecheck and build before any
 * real vault exists. It NEVER reads the production Obsidian Vault and NEVER
 * overwrites an existing snapshot.
 *
 * Runs automatically via the `prebuild` / `predev` npm hooks, or directly:
 *   node scripts/ensure-snapshot.mjs
 *
 * Paths are resolved relative to this file. `TVB_SNAPSHOT_TARGET` and
 * `TVB_SNAPSHOT_FIXTURE` may override them (used by the focused tests).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const target =
  process.env.TVB_SNAPSHOT_TARGET?.trim() ||
  path.join(root, 'src', 'data', 'generated', 'opportunity-data.json')
const fixture =
  process.env.TVB_SNAPSHOT_FIXTURE?.trim() ||
  path.join(root, 'src', 'data', 'test-fixtures', 'opportunity-data.fixture.json')

function fail(message) {
  console.error(`\n[ensure-snapshot] ERROR: ${message}\n`)
  process.exit(1)
}

// 1. An existing snapshot is always preserved byte-for-byte.
if (fs.existsSync(target)) {
  console.log('[ensure-snapshot] existing snapshot present; left untouched.')
  process.exit(0)
}

// 2. The fixture must exist and be a structurally valid snapshot.
if (!fs.existsSync(fixture)) {
  fail(
    `no generated snapshot and no fixture found.\n` +
      `  expected snapshot : ${target}\n` +
      `  expected fixture  : ${fixture}\n` +
      `  Restore the committed fixture, or run "npm run import:data" against a real vault (set TVB_SOURCE_VAULT).`,
  )
}

let parsed
try {
  parsed = JSON.parse(fs.readFileSync(fixture, 'utf8'))
} catch (error) {
  fail(`fixture is not valid JSON: ${fixture}\n  ${error.message}`)
}

if (!parsed || typeof parsed !== 'object' || typeof parsed.records !== 'object' || parsed.records === null) {
  fail(`fixture is not a valid snapshot (missing "records" object): ${fixture}`)
}

// 3. Seed the target with an exact byte-for-byte copy of the fixture.
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, fs.readFileSync(fixture))

console.log('[ensure-snapshot] seeded the generated snapshot from the committed DEMONSTRATION fixture.')
console.log(`  fixture : ${fixture}`)
console.log(`  target  : ${target}`)
console.log('  This is fixture / demonstration data, not production vault data.')
console.log('  Run "npm run import:data" (with TVB_SOURCE_VAULT set) to build from a real vault.')
