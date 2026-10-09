import { expect, test, type Page } from '@playwright/test'
import { externalRequests, hasHorizontalOverflow, watchPage } from './helpers'

/**
 * Phase S: end-to-end founder-demo flows (deterministic fixtures, no Vault
 * mutation, no network).
 *
 * PROCUREMENT happy path: Company → RFP Discovery → Human Review (approve a
 * candidate) → Procurement Match proposal → Procurement Match Review
 * (approve) → Bid decision → dry-run Bid proposal.
 *
 * FUNDING happy path: Company → Grant Discovery → Human Review (approve) →
 * Match proposal → Match Review (approve).
 *
 * Plus the honest non-happy states (blocked source, rejected, DO_NOT_BID),
 * the automated-vs-human boundary note on both review gates, and responsive
 * checks of the workflow actions at the four demo widths.
 */

const PUMP_PAIR = 'PP:PMATCH-RULES-v1:RFB-003:COMP-003'
const APPROVED_PAIR = 'PP:PMATCH-RULES-v1:RFB-001:COMP-001'
const SARVAJAL_PROPOSAL = 'MP:MATCH-RULES-v1:FX-M-3001:COMP-003'

async function selectAllCompanies(page: Page) {
  const checkboxes = page.locator('.dg-company__check')
  for (let index = 0; index < 3; index += 1) {
    await checkboxes.nth(index).check()
  }
  await expect(page.getByRole('status').filter({ hasText: '3 companies selected' })).toBeVisible()
}

async function runDiscovery(page: Page, kind: 'Grant' | 'RFP') {
  await page.getByRole('button', { name: `Run ${kind} Discovery`, exact: true }).click()
  await expect(page.locator('.dg-results')).toBeVisible()
}

async function approveFirstReviewCandidate(page: Page, domain: 'Funding' | 'Procurement') {
  const row = page.locator('tbody tr').filter({ hasText: domain }).first()
  await row.getByRole('link').first().click()
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Review item not found')
  await page.getByLabel('Reviewer ID').fill('RVW-600')
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved: Approved' })).toBeVisible()
}

test.describe('procurement demo flow', () => {
  test('discovery → review → approve → Procurement Match Review → approve → BID → Bid proposal', async ({
    page,
  }) => {
    const w = watchPage(page)

    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByRole('radio', { name: 'RFPs', exact: true }).click()
    await runDiscovery(page, 'RFP')

    // Handoff into Human Review with the deterministic six findings.
    await expect(page.getByRole('link', { name: 'Review 6 candidates' })).toBeVisible()
    await page.getByRole('link', { name: 'Review 6 candidates' }).click()
    await expect(page).toHaveURL(/\/review$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Human review')
    await expect(
      page.getByText('Fixture Framework Agreement for Construction Services').first(),
    ).toBeAttached()

    // A human approves one RFP candidate.
    await approveFirstReviewCandidate(page, 'Procurement')

    // Procurement Match Review: approve the pending RFP × company pair.
    await page.goto('/procurement-match-review')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement match review')
    await page.locator('tbody tr').filter({ hasText: 'Pump Station' }).first().getByRole('link').first().click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Procurement match review item')
    await expect(page.locator('main')).toContainText('Pump Station Rehabilitation')
    await page.getByLabel('Reviewer ID (required)').fill('RVW-600')
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Recorded as Approved by RVW-600.' })).toBeVisible()

    // The approved ProcurementMatch now carries the Bid decision.
    await expect(page.getByRole('heading', { name: '9. Bid decision' })).toBeVisible()
    await page.getByLabel('Bid decision maker ID (required)').fill('RVW-300')
    await page.getByRole('button', { name: 'Decide to Bid', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Bid proposal BID-435 prepared' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'no Bid record was created' })).toBeVisible()

    const main = page.locator('main')
    await expect(main).toContainText('BID-435')
    await expect(main).toContainText('Not assessed')
    await expect(main).toContainText('Researching')
    await expect(main).toContainText('Decided by')
    await expect(main).toContainText('RVW-300')
    // Proposal only: no Match, Application, or Contract is ever created.
    await expect(main.getByText(/CON-\d{3}/)).toHaveCount(0)
    await expect(main.getByText(/MATCH-\d{3}/)).toHaveCount(0)
    await expect(main.getByText(/APP-\d{3}/)).toHaveCount(0)
    await expect(main.getByText(/confidence/i)).toHaveCount(0)

    expect(w.pageErrors, 'no uncaught page errors').toEqual([])
    expect(w.consoleErrors, 'no console errors').toEqual([])
    expect(externalRequests(w.requests), 'no external requests').toEqual([])
  })
})

test.describe('funding demo flow', () => {
  test('discovery → review → approve → Match proposal → Match Review → approve', async ({ page }) => {
    const w = watchPage(page)

    await page.goto('/discovery')
    await selectAllCompanies(page)
    await runDiscovery(page, 'Grant')

    await expect(page.getByRole('link', { name: 'Review 3 candidates' })).toBeVisible()
    await page.getByRole('link', { name: 'Review 3 candidates' }).click()
    await expect(page).toHaveURL(/\/review$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Human review')
    await expect(
      page.getByText('Fixture Climate Innovation Grant Programme').first(),
    ).toBeAttached()

    // A human approves one Grant candidate.
    await approveFirstReviewCandidate(page, 'Funding')

    // Match Review: approve the pending Grant × company proposal.
    await page.goto('/match-review')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Match review')
    await page.locator('tbody tr').filter({ hasText: 'Solar Irrigation Grant' }).first().getByRole('link').first().click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Match review item')
    await expect(page.locator('main')).toContainText('Fixture Solar Irrigation Grant')
    await expect(page.locator('main')).toContainText('Grant')
    await page.getByLabel('Reviewer ID (required)').fill('RVW-600')
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Recorded as Approved by RVW-600.' })).toBeVisible()
    await expect(page.locator('main')).toContainText('Terminal — approved.')
    // Approval marks eligibility; no Match record or Application is created.
    await expect(page.locator('main')).toContainText('No Match record is created by this review.')
    await expect(page.locator('main').getByText(/MATCH-\d{3}/)).toHaveCount(0)
    await expect(page.locator('main').getByText(/APP-\d{3}/)).toHaveCount(0)

    expect(w.pageErrors, 'no uncaught page errors').toEqual([])
    expect(w.consoleErrors, 'no console errors').toEqual([])
    expect(externalRequests(w.requests), 'no external requests').toEqual([])
  })
})

test.describe('honest non-happy states', () => {
  test('blocked source, rejected, and DO_NOT_BID are stated honestly, never as success', async ({ page }) => {
    // Blocked source: the run reports the block and produces no candidates.
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByRole('radio', { name: 'RFPs', exact: true }).click()
    await page.getByLabel('Blocked source').check()
    await runDiscovery(page, 'RFP')
    await expect(page.locator('.stat', { hasText: 'Overall outcome' }).locator('.stat__count')).toHaveText('Blocked')
    await expect(page.locator('.stat', { hasText: 'Blocked sources' }).locator('.stat__count')).toHaveText('3')
    const companyRows = page.locator('details.dg-result')
    await expect(companyRows).toHaveCount(3)
    for (const row of await companyRows.all()) {
      await expect(row.locator('.dg-result__summary .dg-chip')).toHaveText('Blocked')
    }
    await expect(page.getByRole('link', { name: /Review \d candidates/ })).toHaveCount(0)
    // The honest detail text sits inside collapsed details — open them.
    await page.getByText('Show source detail').first().click()
    await expect(page.locator('.dg-note', { hasText: 'Blocked or failed sources were not queried for listings.' })).toBeVisible()
    for (const summary of await page.locator('details.dg-result > summary').all()) {
      await summary.click()
    }
    await expect(page.getByText('This company run produced no candidates.')).toHaveCount(3)
    await expect(page.getByRole('link', { name: 'View Review Queue' })).toBeVisible()

    // Rejected ProcurementMatch: terminal, and no Bid decision surface exists.
    await page.goto('/procurement-match-review?status=rejected')
    await page.locator('tbody tr').first().getByRole('link').first().click()
    await expect(page.locator('main')).toContainText('Terminal — rejected.')
    await expect(page.getByRole('heading', { name: '9. Bid decision' })).toHaveCount(0)

    // DO_NOT_BID on an approved match: no Bid proposal is produced.
    await page.goto(`/procurement-match-review/${encodeURIComponent(APPROVED_PAIR)}`)
    await page.getByLabel('Bid decision maker ID (required)').fill('RVW-300')
    await page.getByRole('button', { name: 'Do Not Bid', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'No-bid recorded' })).toBeVisible()
    await expect(page.locator('main').getByText(/Bid proposal BID-\d{3} prepared/)).toHaveCount(0)
  })
})

test.describe('boundary note and responsiveness', () => {
  test('both review gates state the automated-vs-human boundary', async ({ page }) => {
    // The boundary note lives on the review item detail pages, so each gate is
    // visited at a deterministic fixture proposal rather than at the queue hub.
    const gates = [
      { path: `/match-review/${encodeURIComponent(SARVAJAL_PROPOSAL)}` },
      { path: `/procurement-match-review/${encodeURIComponent(PUMP_PAIR)}` },
    ]
    for (const { path } of gates) {
      await page.goto(path)
      const note = page.getByRole('note', { name: 'Automated and human steps' })
      await expect(note).toBeVisible()
      await expect(note).toContainText('Automatic')
      await expect(note).toContainText('Human')
      await expect(note).toContainText('not automatically written to a record or vault file')
    }
  })

  for (const width of [1440, 1024, 768, 390]) {
    test(`no overflow on the procurement match review decision surface at ${width}px`, async ({ page }) => {
      const w = watchPage(page)
      await page.setViewportSize({ width, height: 900 })

      await page.goto('/procurement-match-review')
      expect(await hasHorizontalOverflow(page), `queue at ${width}px`).toBe(false)
      await page.locator('tbody tr').filter({ hasText: 'Pump Station' }).first().getByRole('link').first().click()
      await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
      expect(await hasHorizontalOverflow(page), `detail at ${width}px`).toBe(false)

      await page.getByLabel('Reviewer ID (required)').fill('RVW-600')
      await page.getByRole('button', { name: 'Approve', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Decide to Bid', exact: true })).toBeVisible()
      await page.getByLabel('Bid decision maker ID (required)').fill('RVW-300')
      await page.getByRole('button', { name: 'Decide to Bid', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'BID-435 prepared' })).toBeVisible()
      expect(await hasHorizontalOverflow(page), `bid decision at ${width}px`).toBe(false)

      expect(w.pageErrors, 'no uncaught page errors').toEqual([])
      expect(w.consoleErrors, 'no console errors').toEqual([])
    })
  }

  test('the boundary note and decision actions are keyboard-reachable', async ({ page }) => {
    await page.goto(`/procurement-match-review/${encodeURIComponent(PUMP_PAIR)}`)
    await page.getByLabel('Reviewer ID (required)').fill('RVW-600')
    await page.getByLabel('Reviewer ID (required)').focus()
    let focused = false
    for (let i = 0; i < 12 && !focused; i++) {
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
    await expect(page.getByRole('status').filter({ hasText: 'Recorded as Approved' })).toBeVisible()
  })
})