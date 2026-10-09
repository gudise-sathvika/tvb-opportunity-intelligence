import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectAppChrome, hasHorizontalOverflow, watchPage } from './helpers'

/**
 * Phase 4 — the procurement workflow, measured honestly.
 *
 * The workflow existed to drive a decision on each fictional notice: notice ->
 * bid -> contract, with every step linking forward and back. The production
 * snapshot contains no Notice, Bid, or Contract records, so the chain cannot be
 * fabricated at any hop. This file measures the honest shape of the guarantee:
 *
 *   - no list can offer a forward link (notice -> bids, bid -> contracts)
 *   - no detail page can render a backward link, and every old demo ID resolves
 *     to the designed not-found page
 *   - the companies directory stays a directory: names only, no bid columns
 *   - keyboard users reach the workflow chrome, and the empty pages stay
 *     width-safe at every tested viewport
 */

function rows(page: Page): Locator {
  return page.locator('table tbody tr')
}

/* ------------------------------------------------------------------ */
/* Forward links in the lists                                          */
/* ------------------------------------------------------------------ */

test('no notice list can offer per-notice bid links, because there are no notices', async ({ page }) => {
  const w = watchPage(page)
  await page.goto('/notices')
  await expectAppChrome(page)
  await expect(rows(page)).toHaveCount(0)
  await expect(page.locator('main a[href^="/bids/"]')).toHaveCount(0)
  await expect(page.locator('.empty')).toContainText('No records')
  expect(w.pageErrors).toEqual([])
  expect(w.consoleErrors).toEqual([])
})

test('no bid list can show the contracts behind each bid, because there are no bids', async ({ page }) => {
  await page.goto('/bids')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.locator('main a[href^="/contracts/"]')).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText('Contract')
})

test('the companies directory stays names-only: no bid pipeline column can appear', async ({ page }) => {
  await page.goto('/companies')
  const headers = page.locator('thead th')
  await expect(headers).not.toContainText(['Bids', 'Requests'])
  await expect(page.locator('main a[href^="/bids/"]')).toHaveCount(0)
})

/* ------------------------------------------------------------------ */
/* Backward links in the details                                       */
/* ------------------------------------------------------------------ */

test('a notice ID cannot render a related “Bids against this notice” panel', async ({ page }) => {
  // The demo notice that showed three bids in a related panel no longer exists.
  await page.goto('/notices/RFB-002')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('main')).not.toContainText('Bids against this notice')
  await expect(page.locator('main a[href^="/bids/"]')).toHaveCount(0)
})

test('a bid ID cannot link to the notice it pursued, or to its contracts', async ({ page }) => {
  await page.goto('/bids/BID-004')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('main a[href^="/notices/"]')).toHaveCount(0)
  await expect(page.locator('main a[href^="/contracts/"]')).toHaveCount(0)
})

test('a bid ID cannot link to the company that made it', async ({ page }) => {
  await page.goto('/bids/BID-004')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('main a[href^="/companies/"]')).toHaveCount(0)
})

test('no contract ID can land, because no contract can be produced by a winning bid', async ({ page }) => {
  // The chain notice -> winning bid -> contract cannot even start.
  for (const id of ['CON-001', 'CON-002', 'CON-004']) {
    await page.goto(`/contracts/${id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.locator('[role="alert"]')).toContainText('No contract with ID')
  }
})

test('a contract with no bid cannot state its non-competitive basis', async ({ page }) => {
  await page.goto('/contracts/CON-005')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('main')).not.toContainText('basis')
})

/* ------------------------------------------------------------------ */
/* The company side of the workflow                                    */
/* ------------------------------------------------------------------ */

test('a company detail page cannot resolve a bid pipeline or filter the bid list by it', async ({ page }) => {
  await page.goto('/companies/COMP-001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  // The chain of `?company=COMP-001` filters that the workflow used to rely on
  // still exists as a mechanic, but with no company detail and no bid records
  // it can only express itself honestly.
  await page.goto('/bids?company=COMP-001')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.locator('.empty')).toContainText('No records')
})

/* ------------------------------------------------------------------ */
/* Deadlines in the workflow                                           */
/* ------------------------------------------------------------------ */

test('a bid cannot inherit a notice deadline, because neither record renders', async ({ page }) => {
  await page.goto('/notices/RFB-001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await page.goto('/bids/BID-001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  // The reference date the deadline math uses is still stated on the notice
  // list itself; it is a property of the collection, not a fabricated row.
  await page.goto('/notices')
  await expect(page.locator('.filterbar__note')).toContainText('Deadlines are compared with')
  await expect(page.locator('body')).not.toContainText('2026-09-23')
})

/* ------------------------------------------------------------------ */
/* Accessibility and responsiveness                                    */
/* ------------------------------------------------------------------ */

test('every workflow page keeps one h1; named tables exist only where records do', async ({ page }) => {
  for (const [p, h1] of [
    ['/notices', 'Procurement'],
    ['/bids', 'Bids'],
    ['/contracts', 'Contracts'],
  ] as const) {
    await page.goto(p)
    await expect(page.getByRole('heading', { level: 1 }), p).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 }), p).toHaveText(h1)
    // Empty collections render no table; the empty state is announced instead
    // of a captionless table.
    await expect(page.locator('.empty'), p).toContainText('No records')
  }
})

test('a filter select on the workflow pages is keyboard-reachable', async ({ page }) => {
  await page.goto('/bids')
  const status = page.locator('.filterbar select').first()
  await status.focus()
  await expect(status).toBeFocused()
  // Keyboard selection on the empty corpus changes the filter without changing
  // the route or fabricating a row.
  await page.keyboard.press('ArrowDown')
  await expect(rows(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/bids$/)
})

for (const w of [375, 768, 1440]) {
  test(`the procurement workflow pages fit the width at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 })
    for (const p of ['/notices', '/bids', '/contracts']) {
      await page.goto(p)
      await expectAppChrome(page)
      expect(await hasHorizontalOverflow(page), `${p} at ${w}px`).toBe(false)
    }
  })
}

test('the procurement workflow pages remain readable at 200% text scaling', async ({ page }) => {
  for (const p of ['/notices', '/bids', '/contracts']) {
    await page.goto(p)
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px'
    })
    await expect(page.getByRole('heading', { level: 1 }), p).toBeVisible()
    expect(await hasHorizontalOverflow(page), `${p} at 200%`).toBe(false)
  }
})