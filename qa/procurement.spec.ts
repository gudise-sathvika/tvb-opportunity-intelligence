import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectAppChrome, hasHorizontalOverflow, watchPage } from './helpers'

/**
 * Phase 4 — the Procurement workspace.
 *
 * The workspace (RFPs, Bids, Contracts) existed to decide which fictional
 * notice to answer. The production snapshot holds no Notice, Bid, or Contract
 * records, so this file measures the workspace in its honest empty form:
 *
 *   - the hub and the collections count zero and say so, instead of guessing
 *   - the deadlines, axes, and decisions that only records could carry are
 *     never fabricated
 *   - filtering and sorting remain operable over the empty sets, stay
 *     URL-synced, and never invent a row
 *   - the no-win-rate and no-cross-currency refusals are part of the prose
 *   - keyboard and small-screen behaviour is preserved
 */

function rows(page: Page): Locator {
  return page.locator('table tbody tr')
}

/** A filter select in the list-page filter bar, matched on its visible label. */
function filter(page: Page, label: string): Locator {
  return page
    .locator('.filterbar__field')
    .filter({ has: page.locator('label', { hasText: new RegExp(`^${label}$`) }) })
    .locator('select')
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

test('the procurement workspace counts zero of everything and says so', async ({ page }) => {
  const w = watchPage(page)
  await page.goto('/procurement')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement')
  await expectAppChrome(page)
  await expect(page.getByRole('heading', { level: 2, name: 'Workspace at a glance' })).toBeVisible()

  for (const [label, to] of [
    ['RFPs to respond to', '/notices'],
    ['bids in progress', '/bids'],
    ['contracts under management', '/contracts'],
  ] as const) {
    const mini = page.locator('.mini').filter({ hasText: label })
    await expect(mini.locator('.mini__count'), label).toHaveText('0')
    await expect(mini).toHaveAttribute('href', to)
  }

  expect(w.pageErrors).toEqual([])
  expect(w.consoleErrors).toEqual([])
})

test('the collection totals are zero, reported as such, not guessed', async ({ page }) => {
  await page.goto('/notices')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.locator('.filterbar__result')).toContainText('0 of 0')
  await page.goto('/bids')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.locator('.filterbar__result')).toContainText('0 of 0')
})

test('the workspace navigates to every collection', async ({ page }) => {
  await page.goto('/procurement')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement')
  // The hub links onward to every collection, populated or not.
  for (const href of ['/notices', '/bids', '/contracts']) {
    await expect(page.locator(`main a[href="${href}"]`).first(), href).toBeVisible()
  }
})

/* ------------------------------------------------------------------ */
/* Deadlines                                                           */
/* ------------------------------------------------------------------ */

test('no deadline exists to compare, so no past, overdue, or exact-day badge is drawn', async ({ page }) => {
  await page.goto('/notices')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.locator('[class*="badge"][class*="deadline"]')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('2026-09-23')
})

test('a notice ID cannot render its recomputed deadline', async ({ page }) => {
  await page.goto('/notices/RFB-002')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('body')).not.toContainText(/2026-09-23/)
})

test('a deadline filter applied to the empty notice list stays URL-synced and clears', async ({ page }) => {
  await page.goto('/notices')
  await filter(page, 'Status').selectOption('Open')
  await expect(page).toHaveURL(/noticeStatus=Open/)
  await expect(rows(page)).toHaveCount(0)
  // Persists across reload — the filter is in the route, and the empty state
  // itself is reload-safe.
  await page.reload()
  await expect(page).toHaveURL(/noticeStatus=Open/)
  await expect(rows(page)).toHaveCount(0)

  const clear = page.getByRole('button', { name: /clear \d+ filters?/i })
  await expect(clear).toBeVisible()
  await clear.click()
  await expect(page).toHaveURL(/\/notices$/)
  await expect(page.getByRole('button', { name: /clear/i })).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/* The bid axes                                                        */
/* ------------------------------------------------------------------ */

test('the bid axes are named, and no single Status column can replace them', async ({ page }) => {
  await page.goto('/bids')
  await expect(page.locator('main')).toContainText('three status columns')
  await expect(page.locator('main')).toContainText('no combined verdict')
  await expect(page.locator('thead th')).toHaveCount(0)
})

test('each bid axis exposes its own filter, kept honest when no axis value exists', async ({ page }) => {
  const w = watchPage(page)
  await page.goto('/bids')
  // The three axes all get their own filter control.
  for (const name of ['Eligibility', 'Bid status', 'Decision']) {
    const f = filter(page, name)
    await expect(f).toBeVisible()
    // A corpus with no bids offers no axis value to choose, and the filter says
    // so: the "All" placeholder is the only option.
    const options = f.locator('option')
    expect(await options.count(), name).toBe(1)
    await expect(options).toHaveText('All')
  }
  expect(w.pageErrors).toEqual([])
  expect(w.consoleErrors).toEqual([])
})

test('two independent filters combine as AND over the empty corpus', async ({ page }) => {
  // The bid-axis filters are out of values on an empty corpus, so the
  // AND-conjunction is measured where options still exist: the notice list's
  // Status and Deadline dimensions.
  await page.goto('/notices')
  await filter(page, 'Status').selectOption('Open')
  await filter(page, 'Deadline').selectOption('none_recorded')
  await expect(rows(page)).toHaveCount(0)
  const clear = page.getByRole('button', { name: /clear 2 filters/i })
  await expect(clear).toBeVisible()
  await clear.click()
  await expect(page.getByRole('button', { name: /clear/i })).toHaveCount(0)
})

test('a bid that was never decided cannot carry a fabricated absence', async ({ page }) => {
  await page.goto('/bids/BID-002')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('main')).not.toContainText('pursuit')
  await expect(page.locator('main')).not.toContainText('decision')
})

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

test('sorting an empty notice list cannot invent a deadline or an undated bucket', async ({ page }) => {
  await page.goto('/notices')
  await page.locator('#filter-sort').selectOption('title')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText('Undated')
  await page.reload()
  await expect(rows(page)).toHaveCount(0)
})

test('a sort choice leaves the empty list empty across a reload', async ({ page }) => {
  await page.goto('/notices')
  await page.locator('#filter-sort').selectOption('id')
  await expect(rows(page)).toHaveCount(0)
  await page.reload()
  await expect(rows(page)).toHaveCount(0)
  // The sort select re-initialises to the page default; sorting state is
  // component state, not a route, so reload is safe either way.
  await expect(page.locator('#filter-sort')).toHaveValue('deadline')
})

/* ------------------------------------------------------------------ */
/* No deep links / metric refusals                                    */
/* ------------------------------------------------------------------ */

test('no notice page can deep-link to the bids answering it', async ({ page }) => {
  await page.goto('/notices')
  await expect(page.locator('main a[href^="/bids/"]')).toHaveCount(0)
  await page.goto('/notices/RFB-001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('main a[href^="/bids/"]')).toHaveCount(0)
})

test('the companies directory offers no bid affordance, and its rows are names only', async ({ page }) => {
  await page.goto('/companies')
  await expect(page.locator('main a[href^="/bids/"]')).toHaveCount(0)
})

test('a company pipeline cannot fabricate a win rate', async ({ page }) => {
  await page.goto('/companies/COMP-001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  // There are no bid records either, so no percentage can be derived and shown.
  await page.goto('/bids')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.locator('.empty')).toContainText('No records')
})

test('the no-win-rate and no-cross-currency refusals are part of the page prose', async ({ page }) => {
  await page.goto('/bids')
  await expect(page.locator('main')).toContainText('no win rate or attractiveness score is shown')
  await page.goto('/contracts')
  await expect(page.locator('main')).toContainText('adding across currencies would produce a meaningless number')
})

/* ------------------------------------------------------------------ */
/* Accessibility / responsiveness                                     */
/* ------------------------------------------------------------------ */

test('every procurement filter control has an accessible name', async ({ page }) => {
  for (const p of ['/notices', '/bids']) {
    await page.goto(p)
    const selects = page.locator('.filterbar select')
    const n = await selects.count()
    expect(n, p).toBeGreaterThanOrEqual(3)
    for (let i = 0; i < n; i += 1) {
      await expect(selects.nth(i), `${p} select ${i}`).toHaveAccessibleName(/.+/)
    }
  }
})

test('the procurement views stay as honest and as empty at phone width as at desktop', async ({ page }) => {
  for (const w of [375, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto('/bids?decision=Pending')
    await expect(rows(page)).toHaveCount(0)
    await expect(page.locator('.empty')).toContainText('No records')
    expect(await hasHorizontalOverflow(page), `/bids at ${w}px`).toBe(false)
  }
})

test('the notice list is readable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto('/notices')
  await expect(rows(page)).toHaveCount(0)
  expect(await hasHorizontalOverflow(page)).toBe(false)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement')
})

test('the procurement pages remain readable at 200% text scaling', async ({ page }) => {
  await page.goto('/procurement')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px'
  })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await hasHorizontalOverflow(page)).toBe(false)
})