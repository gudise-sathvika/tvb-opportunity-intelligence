import { expect, test } from '@playwright/test'
import { expectAppChrome, watchPage } from './helpers'

/**
 * Phase 3 — the Notice database in the browser.
 *
 * Shared list/detail/field coverage for all eight record types lives in
 * `routes.spec.ts`. This file covers only what is specific to Notice: that a
 * notice is not a funding opportunity, that notice IDs resolve to the designed
 * not-found page, and that the empty collection is stated rather than filled
 * with fabricated buyers, lots, bids, or amendments.
 *
 * The production snapshot contains no Notice records. The demo RFB-001/2/3
 * records no longer exist; every ID below is used as an ID, never as data.
 */

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

test('the notices list states that a notice is not a funding opportunity', async ({ page }) => {
  const w = watchPage(page)
  await page.goto('/notices')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement')
  await expectAppChrome(page)

  // The distinction is stated on the page, not left for the reader to infer.
  const main = page.locator('main')
  await expect(main).toContainText('Requests for Proposals')
  await expect(main).toContainText('procurement')

  expect(w.pageErrors, 'no uncaught page errors').toEqual([])
  expect(w.consoleErrors, 'no console errors').toEqual([])
})

test('the notices list holds no records, states it, and fabricates no rows', async ({ page }) => {
  await page.goto('/notices')
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(0)

  // The snapshot contains no notices, and the page says so explicitly rather
  // than leaving a blank table to suggest records are hidden.
  await expect(page.locator('.empty')).toContainText('No records')
  await expect(page.locator('main')).not.toContainText('Fictional')
  // No invented RFB rows, no detail links.
  await expect(page.locator('main a[href^="/notices/"]')).toHaveCount(0)
})

test('searching the notices list stays a filter, never a navigation', async ({ page }) => {
  await page.goto('/notices')
  const search = page.getByRole('searchbox')
  await search.fill('Water-Quality')
  // An empty collection remains empty; the URL is unchanged: this is a filter,
  // not a route.
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await expect(page).toHaveURL(/\/notices$/)
  await search.fill('')
  await expect(page.locator('tbody tr')).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

test('a notice ID resolves to the designed not-found page, never a fabricated detail', async ({ page }) => {
  // No Notice records exist in the production snapshot, so the old demo
  // RFB-001 cannot render buyers, lots, bids, or amendments. Each ID instead
  // reports exactly which record type is absent.
  await page.goto('/notices/RFB-001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('[role="alert"]')).toContainText('No notice with ID')
  await expect(page.getByRole('link', { name: 'Back to Notices' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to Notices' })).toHaveAttribute('href', '/notices')
})

test('no notice page can hint at buyers, lots, or amendments that do not exist', async ({ page }) => {
  for (const id of ['RFB-001', 'RFB-002', 'RFB-003']) {
    await page.goto(`/notices/${id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    // No surface may present the relationship panels of a record that is absent.
    await expect(
      page.locator('main a[href^="/organizations/"], main a[href^="/bids/"]'),
    ).toHaveCount(0)
  }

  // The empty list carries the same honesty: no funding link, no bid links.
  await page.goto('/notices')
  await expect(page.locator('main a[href^="/opportunities/"]')).toHaveCount(0)
  await expect(page.locator('main a[href^="/bids/"]')).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

test('a funding ID under /notices reports not-found rather than rendering', async ({ page }) => {
  // OPP-001 exists, but not as a notice.
  await page.goto('/notices/OPP-001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('[role="alert"]')).toContainText('No notice with ID')
  await expect(page.getByRole('link', { name: 'Back to Notices' })).toBeVisible()
})

test('an unknown notice ID is handled without creating a record', async ({ page }) => {
  for (const bad of ['RFB-999', 'rfb-001', 'RFB-1']) {
    await page.goto(`/notices/${bad}`)
    await expect(page.getByRole('heading', { level: 1 }), bad).toHaveText('Record not found')
  }
})

test('procurement is reachable from the top navigation and notices are counted honestly in the workspace', async ({
  page,
}) => {
  await page.goto('/funding')
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await nav.getByRole('button', { name: /Procurement/ }).click()
  await nav.getByRole('menuitem', { name: /^RFPs/ }).click()
  await expect(page).toHaveURL(/\/notices$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement')

  await page.goto('/procurement')
  const noticeMini = page.locator('.mini').filter({ hasText: 'RFPs to respond to' })
  await expect(noticeMini).toBeVisible()
  // The workspace counts what it holds: zero notices.
  await expect(noticeMini.locator('.mini__count')).toHaveText('0')
  await expect(noticeMini).toHaveAttribute('href', '/notices')
})