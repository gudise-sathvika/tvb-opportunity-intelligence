import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectAppChrome, watchPage } from './helpers'

/**
 * Phase 4 — the Bid database in the browser.
 *
 * Shared list/detail/field coverage for all eight record types lives in
 * `routes.spec.ts`. This file covers only what is specific to Bid: that a bid
 * is our own answer to a notice, that bid IDs resolve to the designed
 * not-found page, and that the empty collection is stated rather than filled
 * with fabricated statuses, evidence, awards, or contracts.
 *
 * The production snapshot contains no Bid records. The demo BID-001..005
 * records no longer exist; every ID below is used as an ID, never as data.
 */

/** The value cell for one exact field, matched on its raw schema name. */
function fieldRow(page: Page, field: string): Locator {
  return page
    .locator('dl.fields')
    .first()
    .locator('.fields__row')
    .filter({ has: page.locator('.fields__raw', { hasText: new RegExp(`^${field}$`) }) })
}

/** One relationship group inside the shared "Related records" card. */
function relatedGroup(page: Page, label: string): Locator {
  return page.locator('.related__group').filter({ hasText: label })
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

test('the bids list states that a bid is our own answer to a notice', async ({ page }) => {
  const w = watchPage(page)
  await page.goto('/bids')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bids')
  await expectAppChrome(page)

  const main = page.locator('main')
  await expect(main).toContainText('our own response to a buyer')
  await expect(main).toContainText('not a contract')
  // The refusal to synthesise a verdict is stated outright, not merely implied
  // by the absence of a status column.
  await expect(main).toContainText('no combined verdict')
  // And the reason there is no score: the snapshot cannot support one.
  await expect(main).toContainText('attractiveness score')

  expect(w.pageErrors, 'no uncaught page errors').toEqual([])
  expect(w.consoleErrors, 'no console errors').toEqual([])
})

test('the bids list holds no records and fabricates no rows or status columns', async ({ page }) => {
  await page.goto('/bids')
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(0)

  // No table is rendered for an empty collection, so no "Eligibility",
  // "Decision", or "Bid status" column can imply records. The three independent
  // axes are still named by the page prose, which is the design statement.
  await expect(page.locator('thead th')).toHaveCount(0)
  await expect(page.locator('.empty')).toContainText('No records')
  await expect(page.locator('main')).not.toContainText('Fictional')
  await expect(page.locator('main a[href^="/bids/"]')).toHaveCount(0)
})

test('the three axes are never forced into a blank on a row, because there are no rows to blank', async ({ page }) => {
  await page.goto('/bids')
  // With no records the list cannot silently drop a status axis into a dash:
  // there is no table at all, and the prose states the three-axis design.
  await expect(page.locator('tbody td', { hasText: /^—$/ })).toHaveCount(0)
  await expect(page.locator('main')).toContainText('three status columns')
})

test('searching the bids list stays a filter, never a navigation', async ({ page }) => {
  await page.goto('/bids')
  const search = page.getByRole('searchbox')
  await search.fill('BID-004')
  // An empty collection remains empty; the URL is unchanged: this is a filter,
  // not a route.
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await expect(page).toHaveURL(/\/bids$/)
  await search.fill('')
  await expect(page.locator('tbody tr')).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

test('a bid ID resolves to the designed not-found page, never a fabricated detail', async ({ page }) => {
  // No Bid records exist, so the old demo BID-001 cannot render its 44 fields,
  // its verbatim submission datetime, its posted security, or its award states.
  for (const id of ['BID-001', 'BID-002', 'BID-003', 'BID-004', 'BID-005']) {
    await page.goto(`/bids/${id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.locator('[role="alert"]')).toContainText('No bid with ID')
  }
  await expect(page.getByRole('link', { name: 'Back to Bids' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to Bids' })).toHaveAttribute('href', '/bids')
})

test('a not-found bid cannot smuggle submission datetimes, security, or awards', async ({ page }) => {
  for (const id of ['BID-001', 'BID-002', 'BID-004']) {
    await page.goto(`/bids/${id}`)
    // No rendered record means no datetime can appear converted (or at all), and
    // no security or award figure can be invented.
    await expect(page.locator('main')).not.toContainText('bid_submission_datetime')
    await expect(page.locator('main')).not.toContainText(/security_posted/)
    await expect(page.locator('main')).not.toContainText(/award_date/)
  }
})

test('the shared field renderer keeps blank, empty-list, and absent distinct', async ({ page }) => {
  // The three-states guarantee was originally demonstrated on demo bids. The
  // same renderer serves every detail page, so it is measured on a retained
  // record: OPP-001 ships a mix of blank, empty-list, and absent fields.
  await page.goto('/opportunities/OPP-001')
  await expect(page.locator('.value--blank', { hasText: '(blank)' })).not.toHaveCount(0)
  await expect(page.locator('.value--blank', { hasText: '(empty list)' })).not.toHaveCount(0)
  await expect(page.locator('.value--absent')).not.toHaveCount(0)
})

test('a source lists the bids citing it, and here that list is honestly empty', async ({ page }) => {
  await page.goto('/sources/SRC-001')
  const panel = relatedGroup(page, 'Bids citing this as eligibility evidence')
  await expect(panel.locator('.related__count')).toHaveText('(0)')
  await expect(panel).toContainText('No Bid cites this source')
  await expect(panel).toContainText('evidence_sources')
})

test('no bid page can draw an evidence gap, funding link, or contract count', async ({ page }) => {
  await page.goto('/bids/BID-001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')

  // And the empty list carries the same honesty: no funding, match, company, or
  // contract links anywhere.
  await page.goto('/bids')
  await expect(page.locator('main a[href^="/opportunities/"], main a[href^="/matches/"], main a[href^="/companies/"]')).toHaveCount(0)
  await expect(page.locator('main a[href^="/contracts/"]')).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

test('a funding or notice ID under /bids reports not-found rather than rendering', async ({ page }) => {
  // Both of these exist, but not as bids.
  for (const [id, label] of [
    ['OPP-001', 'Opportunities'],
    ['RFB-001', 'Notices'],
  ] as const) {
    await page.goto(`/bids/${id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.locator('[role="alert"]')).toContainText('No bid with ID')
    await expect(page.getByRole('link', { name: 'Back to Bids' })).toBeVisible()
    void label
  }
})

test('an unknown bid ID is handled without creating a record', async ({ page }) => {
  for (const bad of ['BID-999', 'bid-001', 'BID-1']) {
    await page.goto(`/bids/${bad}`)
    await expect(page.getByRole('heading', { level: 1 }), bad).toHaveText('Record not found')
  }
})

test('bids are reachable from the procurement workspace and counted honestly there', async ({ page }) => {
  await page.goto('/procurement')
  const mini = page.locator('.mini').filter({ hasText: 'bids in progress' })
  await expect(mini).toBeVisible()
  // The workspace counts what it holds: zero bids.
  await expect(mini.locator('.mini__count')).toHaveText('0')
  await expect(mini).toHaveAttribute('href', '/bids')

  await mini.click()
  await expect(page).toHaveURL(/\/bids$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bids')
})