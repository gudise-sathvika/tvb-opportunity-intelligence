import { expect, test, type Page } from '@playwright/test'
import {
  expectAppChrome,
  externalRequests,
  hasHorizontalOverflow,
  watchPage,
} from './helpers'

/**
 * Phase Q: procurement match review workflow (§tests, focused).
 *
 * Covers: pending items in review with counts, approved/rejected display, the
 * pending→approved and pending→rejected decisions, terminal immutability,
 * reviewer/timestamp enforcement, append-only history, unchanged evidence, real
 * RFB/Notice + company data, RFP terminology, no scores or ProcurementMatch
 * records, the 8-section detail, keyboard-operable decisions, responsive
 * overflow, and the untouched Phase M queue.
 */

const AGRISOLAR_PROPOSAL = 'PP:PMATCH-RULES-v1:RFB-001:COMP-001'

async function openPendingDetail(page: Page) {
  await page.goto('/procurement-match-review')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await page.locator('tbody tr').first().getByRole('link').click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement match review item')
}

test.describe('procurement match review queue', () => {
  test('opens on Pending with the deterministic counts', async ({ page }) => {
    const w = watchPage(page)
    await page.goto('/procurement-match-review')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement match review')
    await expect(page.locator('.stat', { hasText: 'Pending' }).locator('.stat__count')).toHaveText('2')
    await expect(page.locator('.stat', { hasText: 'Approved' }).locator('.stat__count')).toHaveText('1')
    await expect(page.locator('.stat', { hasText: 'Rejected' }).locator('.stat__count')).toHaveText('1')
    await expect(page.locator('tbody tr')).toHaveCount(2, 'Pending is the default filter')
    await expectAppChrome(page)

    expect(w.pageErrors, 'no uncaught page errors').toEqual([])
    expect(w.consoleErrors, 'no console errors').toEqual([])
    expect(w.failedRequests, 'no failed requests').toEqual([])
    expect(externalRequests(w.requests), 'no external requests').toEqual([])
  })

  test('filters show All, Approved, and Rejected faithfully', async ({ page }) => {
    await page.goto('/procurement-match-review?status=all')
    await expect(page.locator('tbody tr')).toHaveCount(4)

    await page.goto('/procurement-match-review?status=approved')
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.locator('tbody')).toContainText('AgriSolar')
    await expect(page.locator('tbody')).toContainText('Rooftop Solar')
    await expect(page.locator('tbody')).toContainText('Approved')

    await page.goto('/procurement-match-review?status=rejected')
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.locator('tbody')).toContainText('Northfield')
    await expect(page.locator('tbody')).toContainText('Rejected')

    await page.goto('/procurement-match-review?status=bogus')
    await expect(page.locator('tbody tr')).toHaveCount(2, 'unknown filters fall back to Pending')
  })

  test('rows show RFP/Notice, company, proposal, signals, rules, and review status', async ({ page }) => {
    await page.goto('/procurement-match-review?status=all')
    const body = page.locator('tbody')
    await expect(body).toContainText('Rooftop Solar')
    await expect(body).toContainText('Water-Quality Data Analysis')
    await expect(body).toContainText('Pump Station Rehabilitation')
    await expect(body).toContainText('RFB-001')
    await expect(body).toContainText('RFP')
    await expect(body).toContainText('AgriSolar')
    await expect(body).toContainText('Proposed')
    await expect(body).toContainText('Not a match')
    await expect(body).toContainText('Industry overlap')
    await expect(body).toContainText('Capability overlap')
    await expect(body).toContainText('PMATCH-RULES-v1')
    await expect(body).toContainText('Pending')
    // No scores, confidence, or generated reasoning anywhere on the queue.
    await expect(page.locator('main').getByText(/score|confidence|reasoning|AI found/i)).toHaveCount(0)
  })

  test('the Procurement Match Review workspace lives in the Procurement menu', async ({ page }) => {
    await page.goto('/funding')
    const groupButton = page.locator('.topnav__group').filter({
      has: page.getByRole('button', { name: 'Procurement', exact: true }),
    })
    await groupButton.getByRole('button', { name: 'Procurement', exact: true }).click()
    // Phase Z renamed the entry to the workspace's own tab label, "Matches";
    // it still points at the procurement match review queue.
    const entry = groupButton.getByRole('menuitem', { name: /^Matches/ })
    await expect(entry).toBeVisible()
    await expect(entry).toHaveAttribute('href', '/procurement-match-review')
    await page.keyboard.press('Escape')

    // The Procurement group stays marked active on the review queue.
    await page.goto('/procurement-match-review')
    await expect(page.locator('.topnav__group[data-active="true"]')).toContainText('Procurement')
  })
})

test.describe('procurement match review detail', () => {
  test('the eight sections render with real evidence and history', async ({ page }) => {
    await page.goto(`/procurement-match-review/${encodeURIComponent(AGRISOLAR_PROPOSAL)}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement match review item')

    for (const heading of [
      '1. RFP',
      '2. Company',
      '3. Match proposal',
      '4. Matched evidence',
      '5. Missing evidence',
      '6. Rule version',
      '7. Decision history',
      '8. Decision',
    ]) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    }
    await expect(page.locator('main')).toContainText('Rooftop Solar')
    await expect(page.locator('main')).toContainText('AgriSolar')
    await expect(page.locator('main')).toContainText('Industry overlap')
    await expect(page.locator('main')).toContainText('Capability overlap')
    await expect(page.locator('main')).toContainText('PMATCH-RULES-v1')
    await expect(page.locator('main')).toContainText('RVW-200')
    await expect(page.locator('main')).toContainText('No Procurement Match record is created by this review.')
  })

  test('an unknown proposal id renders not-found without creating anything', async ({ page }) => {
    await page.goto('/procurement-match-review/PP%3APMATCH-RULES-v1%3ANOPE%3ACOMP-001')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement match review item not found')
    await expect(page.getByRole('alert')).toBeVisible()
  })

  test('a pending proposal approves with reviewer, history, and terminal state', async ({ page }) => {
    await openPendingDetail(page)
    await expect(page.locator('main')).toContainText('Pending')

    // Reviewer identity is required before deciding.
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('reviewer ID')

    await page.getByLabel('Reviewer ID (required)').fill('RVW-900')
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Recorded as Approved by RVW-900.')

    // Terminal: history shows the decision, buttons are gone.
    await expect(page.locator('main')).toContainText('RVW-900')
    await expect(page.locator('main')).toContainText('Terminal — approved.')
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0)
    // Evidence survived the decision untouched.
    await expect(page.locator('main')).toContainText('Country compatibility')
  })

  test('a pending proposal rejects and the queue counts move', async ({ page }) => {
    await openPendingDetail(page)
    await page.getByLabel('Reviewer ID (required)').fill('RVW-901')
    await page.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Recorded as Rejected by RVW-901.')
    await expect(page.locator('main')).toContainText('Terminal — rejected.')

    await page.getByRole('link', { name: 'Procurement match review queue' }).click()
    await expect(page).toHaveURL(/\/procurement-match-review$/)
    await expect(page.locator('.stat', { hasText: 'Pending' }).locator('.stat__count')).toHaveText('1')
    await expect(page.locator('.stat', { hasText: 'Rejected' }).locator('.stat__count')).toHaveText('2')
  })

  test('decision controls are keyboard-operable with visible focus', async ({ page }) => {
    await openPendingDetail(page)
    const reviewer = page.getByLabel('Reviewer ID (required)')
    await reviewer.focus()
    await reviewer.fill('RVW-902')

    let focused = false
    for (let i = 0; i < 10 && !focused; i++) {
      await page.keyboard.press('Tab')
      focused = await page.evaluate(() => document.activeElement?.textContent === 'Approve')
    }
    expect(focused, 'the Approve button is reachable by Tab').toBe(true)
    const outlined = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return false
      const style = getComputedStyle(el)
      return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
    })
    expect(outlined, 'the focused button shows an outline').toBe(true)

    await page.keyboard.press('Enter')
    await expect(page.getByRole('status')).toContainText('Recorded as Approved by RVW-902.')
  })
})

test.describe('boundaries and responsiveness', () => {
  test('the Phase M match review workflow is unchanged', async ({ page }) => {
    await page.goto('/match-review')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Match review')
    await expect(page.locator('tbody tr')).toHaveCount(2, 'the funding review defaults to Pending, untouched')
    await expect(page.locator('.stat', { hasText: 'Approved' }).locator('.stat__count')).toHaveText('1')
  })

  for (const width of [1440, 1024, 768, 390]) {
    test(`no horizontal overflow on the queue and detail at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/procurement-match-review?status=all')
      expect(await hasHorizontalOverflow(page), `queue at ${width}px`).toBe(false)

      await page.locator('tbody tr').first().getByRole('link').click()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement match review item')
      expect(await hasHorizontalOverflow(page), `detail at ${width}px`).toBe(false)
    })
  }
})