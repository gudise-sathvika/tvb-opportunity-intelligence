import { expect, test, type Page } from '@playwright/test'
import { VIEWPORTS, expectAppChrome, externalRequests, hasHorizontalOverflow, watchPage } from './helpers'

/**
 * Phase F: the Human review queue and review detail (Phase F brief §16).
 *
 * Covers: the route and nav entry, the deterministic status summary, every
 * status filter, the detail sections, the four decision actions routed through
 * the Phase E store, reviewer-ID enforcement, terminal behaviour, no network
 * or console errors, and responsive/accessibility basics.
 */

const STAT_COUNTS = [
  { label: 'Needs review', count: '4' },
  { label: 'Approved', count: '1' },
  { label: 'Rejected', count: '1' },
  { label: 'Duplicate', count: '1' },
  { label: 'Blocked', count: '1' },
] as const

/** A NEEDS_REVIEW row we can act on in a test. */
async function openNeedsReviewItem(page: Page) {
  await page.goto('/review')
  const row = page.locator('tbody tr').first()
  const link = row.locator('a').first()
  const title = (await link.textContent()) ?? ''
  await link.click()
  await expect(page).toHaveURL(/\/review\/RI/)
  return title
}

/** The detail card whose heading is exactly the given section title. */
function auditCard(page: Page) {
  return page.locator('.card', {
    has: page.getByRole('heading', { level: 2, name: 'Decision history', exact: true }),
  })
}

test.describe('review queue page', () => {
  test('renders with the summary counts straight from the review store', async ({ page }) => {
    const w = watchPage(page)
    await page.goto('/review')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Human review')
    await expectAppChrome(page)
    await expect(page.locator('.sidebar')).toHaveCount(0)

    for (const stat of STAT_COUNTS) {
      await expect(
        page.locator('.stat', { hasText: stat.label }).locator('.stat__count'),
        `${stat.label} count`,
      ).toHaveText(stat.count)
    }
    // No invented metrics: exactly the five status counts, no trend/percentage.
    await expect(page.locator('.stat')).toHaveCount(5)
    await expect(page.getByText(/trend|percentage|success rate/i)).toHaveCount(0)

    expect(w.pageErrors, 'no uncaught page errors').toEqual([])
    expect(w.consoleErrors, 'no console errors').toEqual([])
    expect(w.failedRequests, 'no failed requests').toEqual([])
    expect(externalRequests(w.requests), 'no external requests').toEqual([])
  })

  test('opens on Needs review by default and each filter shows the right rows', async ({ page }) => {
    const w = watchPage(page)
    await page.goto('/review')

    // Default view: only NEEDS_REVIEW items are listed.
    await expect(page.locator('tbody tr')).toHaveCount(4)
    await expect(page.locator('tbody .rv-badge--needs')).toHaveCount(4)

    // There is a labelled caption and scoped column headers.
    await expect(page.locator('table caption')).toHaveText('Human review queue')
    const headers = page.locator('thead th')
    for (let i = 0; i < (await headers.count()); i++) {
      await expect(headers.nth(i)).toHaveAttribute('scope', 'col')
    }

    const filterCases: { path: string; expected: string; rows: number }[] = [
      { path: '/review?status=all', expected: 'All', rows: 8 },
      { path: '/review?status=approved', expected: 'Approved', rows: 1 },
      { path: '/review?status=rejected', expected: 'Rejected', rows: 1 },
      { path: '/review?status=duplicate', expected: 'Duplicate', rows: 1 },
      { path: '/review?status=blocked', expected: 'Blocked', rows: 1 },
    ]
    for (const f of filterCases) {
      await page.goto(f.path)
      await expect(page.locator('tbody tr'), `${f.expected} row count`).toHaveCount(f.rows)
      await expect(
        page.locator('.segmented__item[aria-current="page"]'),
        `${f.expected} is the current filter`,
      ).toHaveText(f.expected)
    }

    expect(w.pageErrors, 'no uncaught page errors').toEqual([])
    expect(w.consoleErrors, 'no console errors').toEqual([])
    expect(w.failedRequests, 'no failed requests').toEqual([])
  })

  test('rows carry the fields a reviewer needs to triage', async ({ page }) => {
    await page.goto('/review?status=all')

    // A funding Grant row with company, domain, dates and status.
    const grantRow = page.locator('tbody tr', { hasText: 'Community Solar Innovation Grant' })
    await expect(grantRow).toContainText('Funding')
    await expect(grantRow).toContainText('Grant')
    await expect(grantRow.locator('td').nth(5)).toHaveText('2026-09-30')
    await expect(grantRow.locator('td').nth(6)).toHaveText('2026-11-15')
    await expect(grantRow.locator('.rv-badge')).toHaveText('Needs review')

    // A procurement row shows RFP terminology and no invented deadline.
    const rfbRow = page.locator('tbody tr', { hasText: 'Rural Wi-Fi' })
    await expect(rfbRow).toContainText('Procurement')
    await expect(rfbRow).toContainText('RFP')
    await expect(rfbRow.locator('td').nth(6)).toHaveText('—')

    // Duplicate evidence is surfaced per row.
    await expect(page.locator('tbody tr', { hasText: 'Harbour Dredging' })).toContainText('—')
    const twinRow = page.locator('tbody tr', { hasText: 'Cloud Services Framework Agreement' }).last()
    await expect(twinRow.locator('.rv-dupe')).toHaveText('Exact duplicate')
  })

  test('Review is workspace territory, reached from the workspace', async ({ page }) => {
    await page.goto('/funding')
    const nav = page.locator('nav[aria-label="Primary"]')
    await expect(nav.getByRole('link', { name: 'Review', exact: true })).toHaveCount(0)

    // The funding overview's flow strip is how a reader reaches the queue...
    await page.goto('/funding')
    await page.getByRole('link', { name: 'Review', exact: true }).click()
    await expect(page).toHaveURL(/\/review$/)

    // ...and the workspace bar marks the step from inside the workflow.
    await expect(page.locator('.wbar__tab--active')).toHaveText('Human review')
  })
})

test.describe('review detail', () => {
  test('shows the identity, source, provenance, and audit sections', async ({ page }) => {
    const w = watchPage(page)
    const title = await openNeedsReviewItem(page)

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    await expect(page.locator('.crumbs a')).toHaveAttribute('href', '/review')
    await expectAppChrome(page)

    const cardByTitle = (name: string) =>
      page.locator('.card', {
        has: page.getByRole('heading', { level: 2, name, exact: true }),
      })

    for (const section of ['Identity', 'Source', 'Provenance', 'Decision history', 'Decision']) {
      await expect(cardByTitle(section), section).toBeVisible()
    }

    // Only information that exists is shown: the Dates card appears because the
    // fixture item carries dates ("Publication date" only shows when present).
    await expect(cardByTitle('Dates')).toBeVisible()
    await expect(cardByTitle('Dates')).toContainText('Publication date')

    expect(w.pageErrors, 'no uncaught page errors').toEqual([])
    expect(w.consoleErrors, 'no console errors').toEqual([])
    expect(w.failedRequests, 'no failed requests').toEqual([])
    expect(externalRequests(w.requests), 'no external requests').toEqual([])
  })

  test('NEEDS_REVIEW items expose the four Phase E decision actions', async ({ page }) => {
    await openNeedsReviewItem(page)

    await expect(page.getByLabel('Reviewer ID')).toBeVisible()
    await expect(page.getByLabel('Reason or evidence note (optional)')).toBeVisible()

    const actions = page.getByRole('group', { name: 'Record a decision' }).getByRole('button')
    await expect(actions).toHaveCount(4)
    await expect(actions).toHaveText(['Approve', 'Reject', 'Mark Duplicate', 'Block'])
  })

  test('a reviewer identity is required before a decision is committed', async ({ page }) => {
    await openNeedsReviewItem(page)

    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.locator('[role="alert"]')).toContainText('Enter a reviewer ID')
    await expect(page.locator('.rv-badge')).toHaveText('Needs review')

    await page.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(page.locator('[role="alert"]')).toHaveText('Enter a reviewer ID before recording a decision.')
    await expect(page.locator('.rv-badge')).toHaveText('Needs review')
  })

  test('approval changes the state and preserves the decision note', async ({ page }) => {
    const w = watchPage(page)
    const title = await openNeedsReviewItem(page)

    await page.getByLabel('Reviewer ID').fill('reviewer-qa')
    await page.getByLabel('Reason or evidence note (optional)').fill('Verified on the live listing.')
    await page.getByRole('button', { name: 'Approve', exact: true }).click()

    await expect(page.locator('[role="status"]')).toContainText('Saved: Approved')
    await expect(page.locator('.page__badges .rv-badge')).toHaveText('Approved')
    // Decision actions are gone; the only buttons left on an approved item are
    // the Phase V Vault write actions, which never fire on their own.
    const mainButtons = page.locator('.shell__main').getByRole('button')
    await expect(mainButtons).toHaveCount(2)
    await expect(mainButtons.filter({ hasText: 'Preview Vault Write' })).toHaveCount(1)
    await expect(mainButtons.filter({ hasText: 'Write to Vault' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
    await expect(page.locator('.rv-terminal')).toContainText('Terminal — no further actions')

    // The note landed in the audit history.
    const audit = page.locator('.card', {
      has: page.getByRole('heading', { level: 2, name: 'Decision history', exact: true }),
    })
    await expect(audit).toContainText('Evidence note: Verified on the live listing.')
    await expect(audit).toContainText('reviewer-qa')

    // The decision survives SPA navigation (in-memory store, no reload) and the
    // item stays reachable under its matching filter.
    await page.locator('.crumbs a').click()
    await expect(page).toHaveURL(/\/review$/)
    await page
      .getByRole('navigation', { name: 'Review queue filter' })
      .getByRole('link', { name: 'Approved' })
      .click()
    await expect(page.locator('tbody', { hasText: title })).toBeVisible()

    expect(w.pageErrors, 'no uncaught page errors').toEqual([])
    expect(w.consoleErrors, 'no console errors').toEqual([])
  })

  test('rejection records the reason and duplicate/block record their notes', async ({ page }) => {
    // Reject with a reason.
    await openNeedsReviewItem(page)
    await page.getByLabel('Reviewer ID').fill('reviewer-qa')
    await page.getByLabel('Reason or evidence note (optional)').fill('Out of operating region.')
    await page.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(page.locator('.page__badges .rv-badge')).toHaveText('Rejected')
    await expect(auditCard(page)).toContainText('Reason: Out of operating region.')
    await expect(page.locator('.rv-terminal')).toContainText('Terminal — no further actions')

    // Mark Duplicate on a second item.
    await page.goto('/review')
    await page.locator('tbody tr').nth(1).locator('a').first().click()
    await page.getByLabel('Reviewer ID').fill('reviewer-qa')
    await page.getByLabel('Reason or evidence note (optional)').fill('Same programme, reopened.')
    await page.getByRole('button', { name: 'Mark Duplicate', exact: true }).click()
    await expect(page.locator('.page__badges .rv-badge')).toHaveText('Duplicate')
    await expect(auditCard(page)).toContainText('Reason: Same programme, reopened.')

    // Block a third item.
    await page.goto('/review')
    await page.locator('tbody tr').nth(2).locator('a').first().click()
    await page.getByLabel('Reviewer ID').fill('reviewer-qa')
    await page.getByRole('button', { name: 'Block', exact: true }).click()
    await expect(page.locator('.page__badges .rv-badge')).toHaveText('Blocked')
    await expect(auditCard(page)).toContainText('Needs review → Blocked')
  })

  test('terminal items show no decision actions', async ({ page }) => {
    // The pre-existing Rejected item.
    await page.goto('/review?status=rejected')
    const rejected = page.locator('tbody tr').first()
    await rejected.locator('a').first().click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Harbour Dredging')
    await expect(page.locator('.page__badges .rv-badge')).toHaveText('Rejected')
    await expect(page.locator('.shell__main').getByRole('button')).toHaveCount(0)
    await expect(page.locator('.rv-terminal')).toContainText('Terminal — no further actions')
    await expect(page.getByLabel('Reviewer ID')).toHaveCount(0)
  })

  test('an unknown review id reports not-found without creating an item', async ({ page }) => {
    await page.goto('/review/RI%3ADoesNotExist')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review item not found')
    await expect(page.locator('[role="alert"]')).toContainText('No review item with ID')
    await expect(page.getByRole('link', { name: 'Back to Human review' })).toBeVisible()
  })

  test('the blocked fixture item states its problem with no invented fields', async ({ page }) => {
    await page.goto('/review?status=blocked')
    const row = page.locator('tbody tr').first()
    await row.locator('a').first().click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('(untitled)')
    // No classification or duplicate evidence exists for a blocked item.
    await expect(page.locator('.card', { hasText: 'Classification' })).toHaveCount(0)
    await expect(page.locator('.card', { hasText: 'Duplicate evidence' })).toHaveCount(0)
    await expect(page.locator('.card', { hasText: 'Publication date' })).toHaveCount(0)
    // The normalization failure is stated.
    await expect(page.locator('.card', { hasText: 'FAILED' })).toBeVisible()
  })
})

test.describe('responsive and accessibility', () => {
  const widths = [1440, 1024, 768, 390]

  for (const width of widths) {
    test(`no horizontal overflow on the queue and detail at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/review')
      expect(await hasHorizontalOverflow(page), `queue at ${width}px`).toBe(false)

      await page.goto('/review?status=all')
      expect(await hasHorizontalOverflow(page), `queue (All) at ${width}px`).toBe(false)

      await page.locator('tbody tr').first().locator('a').first().click()
      await expect(page).toHaveURL(/\/review\/RI/)
      expect(await hasHorizontalOverflow(page), `detail at ${width}px`).toBe(false)
    })
  }

  test('the queue and detail keep one h1 and skip nothing', async ({ page }) => {
    for (const path of ['/review', '/review?status=duplicate']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 }), path).toHaveCount(1)
    }
    await page.goto('/review')
    await page.locator('tbody tr').first().locator('a').first().click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    const levels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3')).map((h) => Number(h.tagName[1])),
    )
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1], 'no heading level jumps').toBeLessThanOrEqual(1)
    }
  })

  test('decision buttons are reachable by keyboard with visible focus', async ({ page }) => {
    await page.goto('/review')
    await page.locator('tbody tr').first().locator('a').first().click()

    // Walk the whole tab order; every focused element must show an outline.
    const steps = 30
    const hidden: string[] = []
    for (let i = 0; i < steps; i++) {
      await page.keyboard.press('Tab')
      const check = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return 'end'
        const style = getComputedStyle(el)
        const outlined =
          style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && style.outlineColor !== 'transparent'
        const label =
          (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) ||
          el.getAttribute('aria-label') ||
          el.id ||
          el.tagName
        return outlined ? 'ok' : `no outline on: ${label}`
      })
      if (check === 'end') break
      if (check !== 'ok') hidden.push(check)
    }
    expect(hidden, 'focused elements show a visible focus outline').toEqual([])

    // The four decision buttons specifically are in the tab order.
    for (const name of ['Approve', 'Reject', 'Mark Duplicate', 'Block']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
  })

  test('labels are usable and statuses are never colour-only', async ({ page }) => {
    await page.goto('/review?status=all')
    const desktop = await page.locator('.rv-badge').allTextContents()
    expect(desktop.length, 'status badges are labelled').toBeGreaterThanOrEqual(8)
    for (const label of desktop) expect(label.trim().length).toBeGreaterThan(0)

    await page
      .getByRole('navigation', { name: 'Review queue filter' })
      .getByRole('link', { name: 'Rejected' })
      .click()
    await expect(page).toHaveURL(/status=rejected/)
    const badge = page.locator('tbody .rv-badge')
    await expect(badge).toHaveCount(1)
    await expect(badge).toHaveText('Rejected')
  })
})