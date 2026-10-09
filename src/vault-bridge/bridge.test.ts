/**
 * Phase V bridge tests: approved candidate → real Vault write, through the
 * exact handler the browser buttons call.
 *
 * Every test runs against an isolated `mkdtemp` vault (never the production
 * vault) and asserts the brief's invariants: an approved item previews as the
 * exact record; only the explicit write creates a file; a second write is
 * ALREADY_EXISTS with byte-identical content; divergence is CONFLICT and the
 * existing file is never overwritten; non-approved, incomplete, invalid, and
 * unconfigured cases refuse without touching the filesystem; approval alone
 * and preview alone mutate nothing.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { handleVaultBridge } from './handler'
import { discoveryFixtureStore } from '../automation/discovery-fixture'
import { applyReviewDecision } from '../automation/review-queue'
import type { ReviewItem } from '../automation/review-queue'
import { RECORD_DIRS } from '../types/registry'

const REVIEWER = 'RVW-700'
const DECIDED_AT = '2026-10-08T12:00:00.000Z'
const BUYER = 'Fixture Public Procurement Authority'

interface TempVault {
  readonly root: string
  cleanup: () => void
}

function tempVault(): TempVault {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvb-vault-bridge-'))
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

function seedOrganization(vault: TempVault): void {
  const dir = path.join(vault.root, RECORD_DIRS['organization'])
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'ORG-900 — Fixture Public Procurement Authority.md'),
    '---\norganization_id: ORG-900\norganization_name: Fixture Public Procurement Authority\n---\n\n# Fixture Public Procurement Authority\n',
    'utf8',
  )
}

function approvedProcurementItem(): ReviewItem {
  discoveryFixtureStore.reset()
  const context = discoveryFixtureStore.beginRun({ domain: 'procurement' })
  const company = discoveryFixtureStore.runCompany(context, 'COMP-001')
  const run = discoveryFixtureStore.finishRun(context, [company])
  const item = run.reviewQueue[0]
  assert.equal(item.reviewStatus, 'NEEDS_REVIEW', 'fixtures arrive needing a human')
  return applyReviewDecision(item, {
    reviewId: item.reviewId,
    decision: 'APPROVED',
    reviewerId: REVIEWER,
    decidedAt: DECIDED_AT,
    evidenceNotes: 'Phase V bridge test — approved for the controlled write path.',
  })
}

/** The fixture notice adjusted only where a real TED finding would carry a
 *  mappable value: Polish country, `cn-standard` procedure. Everything else
 *  (title, number, URL, summary, publication date, buyer) is fixture fact. */
function readyNoticeItem(): ReviewItem {
  const item = approvedProcurementItem()
  assert.ok(item.normalization, 'the fixture pipeline normalizes')
  return {
    ...item,
    normalization: {
      ...item.normalization,
      country: { original: 'POL', normalized: 'Poland' },
      rawType: { original: 'cn-standard', normalized: 'cn-standard' },
    },
  }
}

function noticesDir(root: string): string {
  return path.join(root, RECORD_DIRS['notice'])
}

function listMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
}

test('an approved item previews as READY and preview writes nothing', () => {
  const vault = tempVault()
  try {
    seedOrganization(vault)
    const res = handleVaultBridge({ kind: 'preview', item: readyNoticeItem() }, vault.root)
    assert.equal(res.httpStatus, 200)
    assert.equal(res.body.kind, 'preview')
    assert.equal(res.body.status, 'READY')
    assert.equal(res.body.recordType, 'notice')
    assert.match(res.body.recordId ?? '', /^RFB-\d{3}$/)
    assert.match(res.body.targetPath ?? '', /^09 - Notices\/RFB-\d{3} — /)
    const markdown = res.body.markdown ?? ''
    assert.ok(markdown.includes(`notice_id: ${res.body.recordId}`), 'the frontmatter carries the record id')
    assert.ok(markdown.includes(`approved by ${REVIEWER}`), 'the human approval travels in the provenance note')
    assert.ok(markdown.includes(DECIDED_AT), 'the decision timestamp travels too')
    assert.deepEqual(res.body.errors, [], 'a READY preview reports no errors')
    assert.deepEqual(listMarkdown(noticesDir(vault.root)), [], 'preview never creates a record')
    assert.ok(
      fs.existsSync(path.join(vault.root, RECORD_DIRS['organization'], `ORG-900 — ${BUYER}.md`)),
      'the seeded vault is untouched apart from what we put there',
    )
  } finally {
    vault.cleanup()
  }
})

test('the explicit write creates exactly the previewed record, once', () => {
  const vault = tempVault()
  try {
    seedOrganization(vault)
    const item = readyNoticeItem()
    const preview = handleVaultBridge({ kind: 'preview', item }, vault.root)
    assert.equal(preview.body.status, 'READY')

    const res = handleVaultBridge({ kind: 'write', item }, vault.root)
    assert.equal(res.httpStatus, 200)
    assert.equal(res.body.kind, 'write')
    assert.equal(res.body.status, 'SUCCESS')
    assert.equal(res.body.targetPath, preview.body.targetPath)
    assert.deepEqual(res.body.errors, [])

    const files = listMarkdown(noticesDir(vault.root))
    assert.equal(files.length, 1, 'exactly one record exists after one write')
    const written = fs.readFileSync(path.join(noticesDir(vault.root), files[0]), 'utf8')
    assert.equal(written, preview.body.markdown, 'the file is the exact previewed Markdown')
    assert.ok(written.includes(`approved by ${REVIEWER}`))
  } finally {
    vault.cleanup()
  }
})

test('a duplicate write is ALREADY_EXISTS and byte-identical', () => {
  const vault = tempVault()
  try {
    seedOrganization(vault)
    const item = readyNoticeItem()
    assert.equal(handleVaultBridge({ kind: 'write', item }, vault.root).body.status, 'SUCCESS')
    const first = fs.readFileSync(path.join(noticesDir(vault.root), listMarkdown(noticesDir(vault.root))[0]), 'utf8')

    const again = handleVaultBridge({ kind: 'write', item }, vault.root)
    assert.equal(again.body.status, 'ALREADY_EXISTS')
    const after = fs.readFileSync(path.join(noticesDir(vault.root), listMarkdown(noticesDir(vault.root))[0]), 'utf8')
    assert.equal(after, first, 'the existing record is byte-identical — nothing was overwritten')
    assert.equal(listMarkdown(noticesDir(vault.root)).length, 1, 'still exactly one file')
  } finally {
    vault.cleanup()
  }
})

test('a divergent existing file is CONFLICT and is never overwritten', () => {
  const vault = tempVault()
  try {
    seedOrganization(vault)
    const item = readyNoticeItem()
    assert.equal(handleVaultBridge({ kind: 'write', item }, vault.root).body.status, 'SUCCESS')
    const file = path.join(noticesDir(vault.root), listMarkdown(noticesDir(vault.root))[0])
    const tampered = '# Tampered by hand\n\nNot the record the writer rendered.\n'
    fs.writeFileSync(file, tampered, 'utf8')

    const res = handleVaultBridge({ kind: 'write', item }, vault.root)
    assert.equal(res.body.status, 'CONFLICT')
    assert.ok(res.body.errors.some((error) => error.code === 'content_mismatch'))
    assert.equal(fs.readFileSync(file, 'utf8'), tampered, 'the divergent content survives untouched')
    assert.equal(listMarkdown(noticesDir(vault.root)).length, 1, 'no second file appeared')
  } finally {
    vault.cleanup()
  }
})

test('the same identity at another path is CONFLICT, not a second file', () => {
  const vault = tempVault()
  try {
    seedOrganization(vault)
    const item = readyNoticeItem()
    const preview = handleVaultBridge({ kind: 'preview', item }, vault.root)
    const recordId = preview.body.recordId
    assert.ok(recordId)
    const dir = noticesDir(vault.root)
    fs.mkdirSync(dir, { recursive: true })
    const seeded = path.join(dir, `${recordId} — Seeded elsewhere.md`)
    fs.writeFileSync(seeded, '# Seeded\n', 'utf8')

    const res = handleVaultBridge({ kind: 'write', item }, vault.root)
    assert.equal(res.body.status, 'CONFLICT')
    assert.ok(res.body.errors.some((error) => error.code === 'duplicate_record_id'))
    assert.equal(fs.readFileSync(seeded, 'utf8'), '# Seeded\n', 'the seeded file is untouched')
    assert.equal(listMarkdown(dir).length, 1, 'no second file for the same identity')
  } finally {
    vault.cleanup()
  }
})

test('only APPROVED items reach the write boundary', () => {
  const vault = tempVault()
  try {
    seedOrganization(vault)
    const approved = approvedProcurementItem()
    const needsReview: ReviewItem = { ...approved, reviewStatus: 'NEEDS_REVIEW', audit: [] }
    const res = handleVaultBridge({ kind: 'write', item: needsReview }, vault.root)
    assert.equal(res.httpStatus, 200)
    assert.equal(res.body.status, 'VALIDATION_ERROR')
    assert.ok(res.body.errors.some((error) => error.code === 'rejected'))
    assert.deepEqual(listMarkdown(noticesDir(vault.root)), [], 'nothing was written')

    const preview = handleVaultBridge({ kind: 'preview', item: needsReview }, vault.root)
    assert.equal(preview.body.status, 'REJECTED')
    assert.deepEqual(listMarkdown(noticesDir(vault.root)), [], 'still nothing was written')
  } finally {
    vault.cleanup()
  }
})

test('an incomplete proposal previews as REJECTED without writing', () => {
  const vault = tempVault()
  try {
    // No organization seeded, fixture country "Wonderland": the proposal
    // cannot resolve procuring_entity and the writer rejects the country —
    // both surfaced honestly as validation errors.
    const res = handleVaultBridge({ kind: 'preview', item: approvedProcurementItem() }, vault.root)
    assert.equal(res.body.status, 'REJECTED')
    assert.ok(res.body.errors.length > 0, 'the blocking errors are reported')
    const codes = res.body.errors.map((error) => error.code)
    assert.ok(codes.includes('missing_required_field'), `expected a missing-field error, got ${codes.join(', ')}`)
    assert.deepEqual(listMarkdown(noticesDir(vault.root)), [], 'a rejected preview writes nothing')
  } finally {
    vault.cleanup()
  }
})

test('an out-of-vocabulary value maps to VALIDATION_ERROR without writing', () => {
  const vault = tempVault()
  try {
    seedOrganization(vault)
    const base = readyNoticeItem()
    assert.ok(base.normalization)
    const item: ReviewItem = {
      ...base,
      normalization: { ...base.normalization, country: { original: 'Wonderland', normalized: 'Wonderland' } },
    }
    const res = handleVaultBridge({ kind: 'write', item }, vault.root)
    assert.equal(res.body.status, 'VALIDATION_ERROR')
    assert.ok(
      res.body.errors.some((error) => error.code === 'invalid_controlled_value' && error.field === 'country'),
      'the country vocabulary refusal is surfaced with its field',
    )
    assert.deepEqual(listMarkdown(noticesDir(vault.root)), [], 'a validation refusal writes nothing')
  } finally {
    vault.cleanup()
  }
})

test('an unset vault target refuses honestly in both modes', () => {
  const item = readyNoticeItem()
  const preview = handleVaultBridge({ kind: 'preview', item }, null)
  assert.equal(preview.body.status, 'REJECTED')
  assert.ok(preview.body.errors.some((error) => error.code === 'vault_root_not_configured'))

  const write = handleVaultBridge({ kind: 'write', item }, null)
  assert.equal(write.body.status, 'WRITE_ERROR')
  assert.ok(write.body.errors.some((error) => error.code === 'vault_root_not_configured'))
})

test('a malformed item is a 400 validation refusal, not a crash', () => {
  for (const kind of ['preview', 'write'] as const) {
    const res = handleVaultBridge({ kind, item: 'not an item' }, os.tmpdir())
    assert.equal(res.httpStatus, 400)
    assert.ok(res.body.errors.some((error) => error.code === 'malformed_item'))
    assert.equal(res.body.status, kind === 'write' ? 'VALIDATION_ERROR' : 'REJECTED')
  }
  const missing = handleVaultBridge({ kind: 'write', item: undefined }, os.tmpdir())
  assert.equal(missing.httpStatus, 400)
})
