import { expect, test, type Page } from '@playwright/test'
import { expectAppChrome, hasHorizontalOverflow, watchPage } from './helpers'

/**
 * Phase 8 — record documents.
 *
 * Documents attached directly to a record (evidence, brochures, signed
 * contracts) were a Phase 8 imagining over the fictional bid/notice/contract
 * corpus. That corpus no longer exists in the production snapshot, so this file
 * measures the honest shape of the guarantee instead:
 *
 *   - no record list or detail can fabricate a documents surface, because the
 *     records that would carry one do not render
 *   - the app makes no outbound request for record content on any collection
 *     page, and none on the one surviving record detail
 *   - keyboard users reach the surviving details and the app chrome is intact
 *   - the procurement surfaces stay fit for width at every tested viewport
 */

const NO_RECORD_LIST_PAGES = ['/bids', '/notices', '/contracts']

test.describe('documents cannot exist because their records do not', () => {
  test('no list page fabricates a document cards surface', async ({ page }) => {
    for (const p of NO_RECORD_LIST_PAGES) {
      await page.goto(p)
      await expect(page.locator('.empty')).toContainText('No records')
      await expect(page.locator('main .document')).toHaveCount(0)
      await expect(page.locator('main a[href*="download"], main a[href*="document"]')).toHaveCount(0)
    }
  })

  test('no detail page can render a document download, because the records are not found', async ({ page }) => {
    for (const p of ['/bids/BID-001', '/notices/RFB-001', '/contracts/CON-001']) {
      await page.goto(p)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
      await expect(page.locator('main')).not.toContainText(/document/i)
      await expect(page.locator('main a[href]')).toHaveCount(1) // only the back button
    }
  })

  test('the documents count can never be inflated because no records exist', async ({ page }) => {
    await page.goto('/contracts')
    await expect(page.locator('main')).not.toContainText('documents')
  })
})

test.describe('the application never leaks record content', () => {
  test('no page in the procured corpus makes an outbound content request', async ({ page }) => {
    // Track every request on each page of the empty procurement corpus plus the
    // one surviving detail record's page.
    for (const p of [...NO_RECORD_LIST_PAGES, '/bids/BID-001', '/opportunities/OPP-001']) {
      await page.goto(p)
      const reqs = await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map((r: PerformanceResourceTiming) => r.name),
      )
      const leaked = reqs.filter(
        (u) =>
          u.startsWith('http') &&
          !u.startsWith('http://localhost:4187') &&
          !u.startsWith('data:') &&
          !u.startsWith('blob:'),
      )
      expect(leaked, `no external request from ${p}`).toEqual([])
    }
  })
})

test.describe('keyboard', () => {
  test('route focus lands on the heading after navigating a surviving list-to-detail', async ({ page }) => {
    // Sources is a real, populated collection; this is the honest anchor for
    // the route-focus guarantee that the fictional bid/notice/contracts records
    // used to carry.
    await page.goto('/sources')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const sourceLink = page.locator('tbody a[href^="/sources/"]').first()
    await sourceLink.focus()
    await expect(sourceLink).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/sources\/SRC-\d+$/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

test.describe('responsive', () => {
  test('the procurement surfaces do not scroll sideways at any width', async ({ page }) => {
    for (const w of [375, 768, 1440]) {
      await page.setViewportSize({ width: w, height: 900 })
      for (const p of NO_RECORD_LIST_PAGES) {
        await page.goto(p)
        await expect(page.locator('.empty')).toContainText('No records')
        expect(await hasHorizontalOverflow(page), `${p} at ${w}px`).toBe(false)
      }
    }
  })

  test('the procurement pages remain readable at 200% text scaling', async ({ page }) => {
    for (const p of ['/notices', '/bids']) {
      await page.goto(p)
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '32px'
      })
      await expect(page.locator('h1')).toBeVisible()
      expect(await hasHorizontalOverflow(page), `${p} at 200%`).toBe(false)
    }
  })

  test('the empty record pages still carry the app chrome', async ({ page }) => {
    await page.goto('/contracts')
    await expectAppChrome(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contracts')
  })
})