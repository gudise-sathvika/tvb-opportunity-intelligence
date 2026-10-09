import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { discoveryFixtureStore } from '../src/automation/discovery-fixture'
import { applyReviewDecision } from '../src/automation/review-queue'
import type { ReviewItem } from '../src/automation/review-queue'
import { RECORD_DIRS } from '../src/types/registry'
import { externalRequests, watchPage } from './helpers'

/**
 * Phase V: the approved-candidate → real Vault write path, end to end.
 *
 * The preview server runs with TVB_VAULT_ROOT pointing at an ISOLATED
 * directory (see playwright.config.ts) — never the production vault. Tests
 * reset that directory before each case and can inspect it directly, which is
 * how "preview writes nothing" and "one write creates exactly one file" are
 * proven from the filesystem side while the requests travel the real HTTP
 * middleware the browser buttons call.
 */

// Must match webServer.env.TVB_VAULT_ROOT in playwright.config.ts (repo root cwd).
const VAULT_ROOT = path.resolve(process.cwd(), 'qa/.artifacts/vault-bridge-vault')
const BUYER = 'Fixture Public Procurement Authority'

function resetVault(): void {
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true })
  fs.mkdirSync(VAULT_ROOT, { recursive: true })
}

function seedOrganization(): void {
  const dir = path.join(VAULT_ROOT, RECORD_DIRS['organization'])
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'ORG-900 — Fixture Public Procurement Authority.md'),
    '---\norganization_id: ORG-900\norganization_name: Fixture Public Procurement Authority\n---\n\n# Fixture Public Procurement Authority\n',
    'utf8',
  )
}

function noticeFiles(): string[] {
  const dir = path.join(VAULT_ROOT, RECORD_DIRS['notice'])
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort()
}

function approvedItem(): ReviewItem {
  discoveryFixtureStore.reset()
  const context = discoveryFixtureStore.beginRun({ domain: 'procurement' })
  const company = discoveryFixtureStore.runCompany(context, 'COMP-001')
  const run = discoveryFixtureStore.finishRun(context, [company])
  const item = run.reviewQueue[0]
  return applyReviewDecision(item, {
    reviewId: item.reviewId,
    decision: 'APPROVED',
    reviewerId: 'RVW-QA',
    decidedAt: '2026-10-08T12:00:00.000Z',
    evidenceNotes: 'Phase V QA — approved for the controlled write path.',
  })
}

/** The fixture notice with the two values a real TED finding would carry. */
function readyNoticeItem(): ReviewItem {
  const item = approvedItem()
  expect(item.normalization).not.toBeNull()
  const normalization = item.normalization
  if (!normalization) throw new Error('fixture pipeline must normalize')
  return {
    ...item,
    normalization: {
      ...normalization,
      country: { original: 'POL', normalized: 'Poland' },
      rawType: { original: 'cn-standard', normalized: 'cn-standard' },
    },
  }
}

async function openFirstNeedsReviewItem(page: Page): Promise<void> {
  await page.goto('/review')
  const link = page.locator('tbody tr').first().locator('a').first()
  await link.click()
  await expect(page).toHaveURL(/\/review\/RI/)
}

test.beforeEach(() => {
  resetVault()
})

test('an approved item shows the Vault write card; preview reports errors and writes nothing', async ({ page }) => {
  seedOrganization()
  const w = watchPage(page)

  await openFirstNeedsReviewItem(page)
  await page.getByLabel('Reviewer ID').fill('rvw-qa')
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.locator('[role="status"]')).toContainText('Saved: Approved')

  const card = page.locator('section.card', { hasText: 'Preview Vault Write' })
  await expect(card).toBeVisible()

  const previewButton = card.getByRole('button', { name: 'Preview Vault Write', exact: true })
  const writeButton = card.getByRole('button', { name: 'Write to Vault', exact: true })
  await expect(previewButton).toBeEnabled()
  await expect(writeButton).toBeDisabled()

  // No fixture can become READY: no fixture carries a TED procedure code the
  // proposal layer can map to a procurement method (and this row's raw type
  // is outside the notice-type vocabulary), so the preview surfaces real
  // blocking errors instead of a record.
  await previewButton.click()
  await expect(card).toContainText('REJECTED')
  await expect(card).toContainText('Validation errors')
  await expect(card).toContainText('missing_required_field')
  await expect(writeButton).toBeDisabled()

  // Approval and preview together mutated nothing.
  expect(noticeFiles(), 'preview never creates a record').toEqual([])

  // The decision actions are gone; only the two Vault write buttons remain.
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)

  expect(w.pageErrors, 'no uncaught page errors').toEqual([])
  expect(w.consoleErrors, 'no console errors').toEqual([])
  expect(w.failedRequests, 'no failed requests').toEqual([])
  expect(externalRequests(w.requests), 'no external requests').toEqual([])
})

test('a READY preview then the explicit write creates exactly one record; a duplicate reports ALREADY_EXISTS', async ({
  page,
}) => {
  seedOrganization()
  const item = readyNoticeItem()

  const previewResponse = await page.request.post('/__tvb/vault/preview', { data: { item } })
  expect(previewResponse.ok()).toBeTruthy()
  const preview = (await previewResponse.json()) as {
    status: string
    recordType: string | null
    targetPath: string | null
    markdown: string | null
    errors: unknown[]
  }
  expect(preview.status).toBe('READY')
  expect(preview.recordType).toBe('notice')
  expect(preview.targetPath).toMatch(/^09 - Notices\/RFB-\d{3} — /)
  expect(preview.markdown).toContain('notice_id:')
  expect(preview.errors).toEqual([])
  expect(noticeFiles(), 'the preview wrote nothing').toEqual([])

  const writeResponse = await page.request.post('/__tvb/vault/write', { data: { item } })
  expect(writeResponse.ok()).toBeTruthy()
  const write = (await writeResponse.json()) as { status: string; targetPath: string | null }
  expect(write.status).toBe('SUCCESS')
  expect(write.targetPath).toBe(preview.targetPath)

  const files = noticeFiles()
  expect(files).toHaveLength(1)
  const written = fs.readFileSync(path.join(VAULT_ROOT, preview.targetPath ?? ''), 'utf8')
  expect(written).toBe(preview.markdown)

  const duplicate = await page.request.post('/__tvb/vault/write', { data: { item } })
  const duplicateBody = (await duplicate.json()) as { status: string }
  expect(duplicateBody.status).toBe('ALREADY_EXISTS')
  expect(noticeFiles()).toHaveLength(1)
  expect(fs.readFileSync(path.join(VAULT_ROOT, preview.targetPath ?? ''), 'utf8')).toBe(preview.markdown)
})
