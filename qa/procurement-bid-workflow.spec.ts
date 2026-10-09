import { expect, test, type Page } from '@playwright/test'
import { hasHorizontalOverflow, watchPage } from './helpers'

/**
 * Phase R: ProcurementMatch → Bid workflow (focused).
 *
 * The business rule: an APPROVED ProcurementMatch means "this RFP may be
 * relevant to this company", NOT "the company will bid". A separate human Bid
 * decision (BID / DO_NOT_BID) is recorded on the approved match detail, and
 * only BID produces a deterministic dry-run Bid proposal — never a Bid record
 * and never a Contract. Pending/rejected matches cannot decide. The demo runs
 * against the real fixture data:
 *  - RFB-001 × COMP-001 is APPROVED but already has real bid BID-001 → conflict;
 *  - RFB-003 × COMP-003 is PENDING → approving it then bidding produces the
 *    free deterministic proposal BID-435.
 */

const APPROVED_PAIR = 'PP:PMATCH-RULES-v1:RFB-001:COMP-001'
const PENDING_PAIR = 'PP:PMATCH-RULES-v1:RFB-003:COMP-003'

async function approveAndBid(page: Page) {
  await page.goto(`/procurement-match-review/${encodeURIComponent(PENDING_PAIR)}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement match review item')
  await page.getByLabel('Reviewer ID (required)').fill('RVW-700')
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Recorded as Approved' })).toBeVisible()
  await page.getByLabel('Bid decision maker ID (required)').fill('RVW-300')
  await page.getByRole('button', { name: 'Decide to Bid', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'BID-435 prepared' })).toBeVisible()
}

test.describe('bid decision surface', () => {
  test('an APPROVED match shows the Bid decision section with the clarity sentence', async ({ page }) => {
    const w = watchPage(page)
    await page.goto(`/procurement-match-review/${encodeURIComponent(APPROVED_PAIR)}`)
    await expect(page.getByRole('heading', { name: '9. Bid decision' })).toBeVisible()
    await expect(page.locator('main')).toContainText(
      'Approval means this RFP is relevant to the company. A separate decision is required before creating a Bid.',
    )
    await expect(page.getByLabel('Bid decision maker ID (required)')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Decide to Bid', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Do Not Bid', exact: true })).toBeVisible()

    expect(w.pageErrors, 'no uncaught page errors').toEqual([])
    expect(w.consoleErrors, 'no console errors').toEqual([])
  })

  test('a PENDING or REJECTED match has no Bid decision surface', async ({ page }) => {
    await page.goto(`/procurement-match-review/${encodeURIComponent(PENDING_PAIR)}`)
    await expect(page.getByRole('heading', { name: '9. Bid decision' })).toHaveCount(0)

    await page.goto(`/procurement-match-review/${encodeURIComponent('PP:PMATCH-RULES-v1:RFB-001:COMP-002')}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement match review item')
    await expect(page.locator('main')).toContainText('Terminal — rejected.')
    await expect(page.getByRole('heading', { name: '9. Bid decision' })).toHaveCount(0)
  })

  test('a decision maker ID is required before any bid decision', async ({ page }) => {
    await page.goto(`/procurement-match-review/${encodeURIComponent(APPROVED_PAIR)}`)
    await page.getByRole('button', { name: 'Decide to Bid', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('decision maker ID')
  })
})

test.describe('bid decisions', () => {
  test('BID on an approved pair that already has a real bid is a conflict, never an overwrite', async ({ page }) => {
    await page.goto(`/procurement-match-review/${encodeURIComponent(APPROVED_PAIR)}`)
    await page.getByLabel('Bid decision maker ID (required)').fill('RVW-300')
    await page.getByRole('button', { name: 'Decide to Bid', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('already exists')
    await expect(page.getByRole('alert')).toContainText('refusing')
    // No proposal panel appears for a conflict.
    await expect(page.locator('main').getByText(/Bid proposal BID-\d{3} prepared/)).toHaveCount(0)
  })

  test('DO_NOT_BID on an approved match produces no Bid proposal', async ({ page }) => {
    await page.goto(`/procurement-match-review/${encodeURIComponent(APPROVED_PAIR)}`)
    await page.getByLabel('Bid decision maker ID (required)').fill('RVW-300')
    await page.getByRole('button', { name: 'Do Not Bid', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'No-bid recorded' })).toBeVisible()
    await expect(page.locator('main').getByText(/Bid proposal BID-\d{3} prepared/)).toHaveCount(0)
    await expect(page.locator('main').getByText(/BID-\d{3}/)).toHaveCount(0)
  })

  test('approving a pending match then deciding BID prepares the deterministic BID-435 proposal', async ({ page }) => {
    await approveAndBid(page)
    const proposalStatus = page.getByRole('status').filter({ hasText: 'BID-435 prepared' })
    await expect(proposalStatus).toContainText('no Bid record was created')

    const main = page.locator('main')
    await expect(main).toContainText('BID-435')
    await expect(main).toContainText('[[RFB-003 — DEMO — Pump Station Rehabilitation — Single Source]]')
    await expect(main).toContainText('[[COMP-003 — DEMO — Sarva Jal Technologies LLP]]')
    await expect(main).toContainText('Bid')
    await expect(main).toContainText('Not assessed')
    await expect(main).toContainText('Researching')
    await expect(main).toContainText('RVW-300')
    await expect(main).toContainText("Still the company's manual work")
    // No Contract reference, never a funding Match or Application shape.
    await expect(main.getByText(/CON-\d{3}/)).toHaveCount(0)
    await expect(main.getByText(/MATCH-\d{3}/)).toHaveCount(0)
    await expect(main.getByText(/APP-\d{3}/)).toHaveCount(0)
    await expect(main.getByText(/confidence/i)).toHaveCount(0)
    // The manual-work note names the untouched fields but assigns no figures.
    await expect(main.getByText(/technical_score, financial_score/)).toHaveCount(1)
  })

  test('deciding to bid never disturbs the funding workflow smoke', async ({ page }) => {
    // Same fixture process as the fund-side smoke: the funding Match Review
    // stays a separate queue with its own Pending items.
    await page.goto(`/procurement-match-review/${encodeURIComponent(APPROVED_PAIR)}`)
    await page.getByLabel('Bid decision maker ID (required)').fill('RVW-300')
    await page.getByRole('button', { name: 'Decide to Bid', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('already exists')

    await page.goto('/match-review')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Match review')
    await expect(page.locator('tbody tr')).toHaveCount(2, 'the funding review queue is untouched')
  })
})

test.describe('bid decision operability and responsiveness', () => {
  test('the bid decision buttons are keyboard-reachable with visible focus', async ({ page }) => {
    await page.goto(`/procurement-match-review/${encodeURIComponent(APPROVED_PAIR)}`)
    await page.getByLabel('Bid decision maker ID (required)').fill('RVW-300')
    await page.getByLabel('Bid decision maker ID (required)').press('Tab')
    let focused = false
    for (let i = 0; i < 10 && !focused; i++) {
      focused = await page.evaluate(() => document.activeElement?.textContent === 'Decide to Bid')
      if (!focused) await page.keyboard.press('Tab')
    }
    expect(focused, 'the Decide to Bid button is reachable by Tab').toBe(true)
    const outlined = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return false
      const style = getComputedStyle(el)
      return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
    })
    expect(outlined, 'focused button shows an outline').toBe(true)
  })

  for (const width of [1440, 1024, 768, 390]) {
    test(`no horizontal overflow on the bid decision surface at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await approveAndBid(page)
      expect(await hasHorizontalOverflow(page), `bid decision at ${width}px`).toBe(false)
    })
  }
})