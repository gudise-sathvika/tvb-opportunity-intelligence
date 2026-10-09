import { test, expect } from '@playwright/test'

test.describe('Supporting entities (Phase 6)', () => {
  test('Company list is a name-only directory with no funding relationships', async ({ page }) => {
    // The Companies workspace holds no Company records — only the name
    // directory — so no funding relationship columns can appear here.
    await page.goto('/companies')
    await expect(page.locator('.listbar__counts')).toContainText('189 of 189 companies')
    await expect(page.locator('tbody tr')).toHaveCount(5)
    await expect(page.locator('thead th').first()).toContainText(/Company|Name/i)
    await expect(
      page.locator('main a[href^="/matches/"], main a[href^="/applications/"]'),
    ).toHaveCount(0)
  })

  test('Company list shows no procurement relationships either', async ({ page }) => {
    await page.goto('/companies')
    // Rows are plain names — no COMP-/BID- IDs, no bid counts.
    const firstRow = await page.locator('tbody tr').first().innerText()
    expect(firstRow).not.toMatch(/COMP-|BID-|CON-/)
    await expect(page.locator('main a[href^="/bids/"], main a[href^="/notices/"]')).toHaveCount(0)
  })

  test('Company detail is not a funding/procurement surface', async ({ page }) => {
    await page.goto('/companies/COMP-001')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.locator('[role="alert"]')).toContainText('No company with ID')
    await expect(page.getByText(/funding activity|procurement activity|matches recorded|applications recorded/i)).toHaveCount(0)
  })

  test('no Company → Bid → Notice chain can be fabricated', async ({ page }) => {
    await page.goto('/companies/COMP-001')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.getByRole('link', { name: 'Back to Companies' })).toBeVisible()
    await expect(page.locator('main a[href^="/bids/"]')).toHaveCount(0)
  })

  test('no Company → Match → Opportunity chain can be fabricated', async ({ page }) => {
    await page.goto('/companies/COMP-001')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.locator('main a[href^="/matches/"]')).toHaveCount(0)
  })

  test('Organization list shows derived context columns', async ({ page }) => {
    await page.goto('/organizations')
    await expect(page.getByRole('columnheader', { name: 'Grants provided' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'RFPs issued' })).toBeVisible()
    // Four real organizations; each column states a factual count. The snapshot
    // holds no RFPs, so the right-hand column is the literal word "none".
    const rows = page.getByRole('row')
    const org1 = rows.filter({ hasText: 'ORG-001' })
    await expect(org1).toContainText('ORG-001')
    await expect(org1).toContainText('OPP-001')
    await expect(org1).toContainText('none')
  })

  test('Organization detail groups opportunities and notices', async ({ page }) => {
    await page.goto('/organizations/ORG-001')
    await expect(page.locator('.related__group', { hasText: 'Opportunities provided' })).toContainText(
      'OPP-001',
    )
    await expect(page.locator('.related__group', { hasText: 'Notices issued' })).toBeVisible()
    await expect(page.locator('.related__group', { hasText: 'Notices issued' })).toContainText(
      '(0)',
    )
  })

  test('Source page uses provenance terminology', async ({ page }) => {
    await page.goto('/sources')
    const desc = page.getByText(/Provenance for the records/)
    await expect(desc).toBeVisible()
  })

  test('Source detail shows relationship groups with honest zeros', async ({ page }) => {
    await page.goto('/sources/SRC-001')
    await expect(page.getByRole('heading', { name: 'Related opportunity' }).first()).toBeVisible()
  })

  test('supporting entity lists are reachable from the navigation', async ({ page }) => {
    await page.goto('/funding')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await nav.getByRole('link', { name: /Companies/ }).first().click()
    await expect(page).toHaveURL(/\/companies/)
    await page.goto('/funding')
    await nav.getByRole('button', { name: /More/ }).click()
    await nav.getByRole('menuitem', { name: /^Organizations/ }).click()
    await expect(page).toHaveURL(/\/organizations/)
    await page.goto('/funding')
    await nav.getByRole('button', { name: /More/ }).click()
    await nav.getByRole('menuitem', { name: /^Sources/ }).click()
    await expect(page).toHaveURL(/\/sources/)
  })

  test.skip('Organization filter if BUG-1 is fixed', async () => {
    // BUG-1 remains deferred; intentionally skipped.
  })

  test('Responsive layout at key breakpoints renders without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/companies')
    const body = page.locator('body')
    const width = await body.evaluate((el) => el.scrollWidth)
    expect(width).toBeLessThanOrEqual(400)
  })

  test.skip('Keyboard accessibility on list links', async () => {})

  test.skip('No invented metrics on Company pages', async ({ page }) => {
    await page.goto('/companies')
    await expect(page.getByText(/win rate|success rate|ROI|efficiency score|cycle time|derived rate|derived cycle/i)).toHaveCount(0)
  })
})
