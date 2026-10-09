/**
 * Phase T boundary extension.
 *
 * The Phase B/C boundary scans already prove the automation framework is
 * pure. This file extends that guarantee for the writer era:
 *
 * 1. The controlled writer is the ONLY module outside the documented
 *    import pipeline that may touch the filesystem for writes — discovery,
 *    classification, matching, review, proposal engines, components, and
 *    pages cannot invoke any write primitive.
 * 2. No automation module imports the writer (it cannot be reached from the
 *    app, only by an explicit caller).
 * 3. The writer itself holds no network or clock primitive.
 *
 * Every assertion is a static source scan: no test here performs a write
 * outside its own reading of source files.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../', import.meta.url))

const WRITE_TOKENS = [
  'writeFileSync(',
  'appendFileSync(',
  'appendFile(',
  'createWriteStream(',
  'copyFileSync(',
  'mkdirSync(',
  'rmSync(',
]

/** Modules with a documented, tested write purpose outside the vault records. */
const ALLOWED_WRITERS = new Set([
  path.join(SRC, 'import', 'cli.ts'),
  path.join(SRC, 'import', 'snapshot.ts'),
  path.join(SRC, 'vault-writer', 'writer.ts'),
])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(abs, out)
    else out.push(abs)
  }
  return out
}

const allSourceFiles = walk(SRC).filter(
  (abs) => (abs.endsWith('.ts') || abs.endsWith('.tsx')) && !abs.endsWith('.test.ts'),
)

const withPosix = (abs: string): string => abs.split(path.sep).join('/')

test('19a. only the writer and the documented import-pipeline tools hold write primitives', () => {
  const offenders: string[] = []
  for (const abs of allSourceFiles) {
    const source = fs.readFileSync(abs, 'utf8')
    const usesWrite = WRITE_TOKENS.some((token) => source.includes(token))
    if (usesWrite && !ALLOWED_WRITERS.has(abs)) offenders.push(withPosix(abs))
  }
  assert.deepEqual(
    offenders,
    [],
    `these modules must not perform filesystem writes: ${offenders.join(', ')}`,
  )
})

test('19b. no automation module can import or reach the controlled writer', () => {
  const automationDir = path.join(SRC, 'automation')
  const offenders: string[] = []
  for (const abs of walk(automationDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const source = fs.readFileSync(abs, 'utf8')
    if (source.includes('vault-writer')) offenders.push(`${withPosix(abs)} references vault-writer`)
    for (const token of ['node:fs', 'writeFileSync(', 'appendFile(', 'createWriteStream(']) {
      if (source.includes(token)) offenders.push(`${withPosix(abs)} contains ${token}`)
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

test('19c. discovery, review, and proposal engines stay filesystem-free', () => {
  const engineModules = [
    'candidate.ts',
    'transform.ts',
    'normalize.ts',
    'classify.ts',
    'dedup.ts',
    'pipeline.ts',
    'orchestrator.ts',
    'review-queue.ts',
    'match-proposal.ts',
    'match-review.ts',
    'procurement-proposal.ts',
    'procurement-match-review.ts',
    'approval-write.ts',
    'match-approval-write.ts',
    'procurement-match-approval-write.ts',
    'bid-proposal.ts',
  ]
  for (const module of engineModules) {
    const abs = path.join(SRC, 'automation', module)
    const source = fs.readFileSync(abs, 'utf8')
    for (const token of ['node:fs', 'node:child_process', 'writeFileSync(', 'appendFile(', 'createWriteStream(', 'vault-writer']) {
      assert.ok(!source.includes(token), `${module} must not contain ${token}`)
    }
  }
})

test('19d. the writer itself has no network, scheduler, or clock primitive', () => {
  const source = fs.readFileSync(path.join(SRC, 'vault-writer', 'writer.ts'), 'utf8')
  for (const token of [
    'fetch(',
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'child_process',
    'setTimeout(',
    'setInterval(',
    'Date.now',
    'new Date',
    'Math.random',
    'localStorage',
  ]) {
    assert.ok(!source.includes(token), `writer.ts must not contain ${token}`)
  }
})

test('19e. the app, pages, and components cannot reach the writer', () => {
  const roots = ['components', 'pages', 'data', 'analytics', 'app', 'hooks'].map((name) =>
    path.join(SRC, name),
  )
  const offenders: string[] = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const abs of walk(root)) {
      if (!abs.endsWith('.ts') && !abs.endsWith('.tsx')) continue
      if (fs.readFileSync(abs, 'utf8').includes('vault-writer')) offenders.push(withPosix(abs))
    }
  }
  assert.deepEqual(offenders, [], `the browser app must not import the writer: ${offenders.join(', ')}`)
})
