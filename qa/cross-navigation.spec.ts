import { test, expect } from '@playwright/test'

test.describe('Cross-navigation (Phase 7)', () => {
  test('Funding and Procurement workspaces across the navigation', async ({ page }) => {
    await page.goto('/funding')
    // The workspace overview links on to its collection.
    await page.getByRole('link', { name: /opportunities to evaluate/ }).click()
    await expect(page).toHaveURL(/\/opportunities$/)

    await page.goto('/funding')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await nav.getByRole('button', { name: /Procurement/ }).click()
    await nav.getByRole('menuitem', { name: /^RFPs/ }).click()
    await expect(page).toHaveURL(/\/notices$/)
  })

  test('Opportunity → provider Organization cross-links', async ({ page }) => {
    // The snapshot holds no Match or Application records, so the funding trail
    // a real opportunity owns is its provider organization. The Matches and
    // Applications panels are present and state honest zeros.
    await page.goto('/opportunities/OPP-001')
    await expect(page.locator('.related__group', { hasText: 'Matches' })).toContainText(
      'No matches recorded',
    )
    await expect(page.locator('.related__group', { hasText: 'Applications' })).toContainText(
      'No applications recorded',
    )
    const provider = page.locator('.related__group', { hasText: 'Provider organization' })
    await expect(provider.locator('a.related__link')).toHaveAttribute('href', '/organizations/ORG-001')
    await provider.locator('a.related__link').click()
    await expect(page).toHaveURL(/\/organizations\/ORG-001$/)
  })

  test('Match/Application detail routes report not-found and the lists stay honest', async ({ page }) => {
    await page.goto('/applications/APP-001')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.locator('[role="alert"]')).toContainText('No application with ID')
    await page.getByRole('link', { name: 'Back to Applications' }).click()
    await expect(page).toHaveURL(/\/applications$/)
    await expect(page.locator('.empty')).toContainText('No records')
  })

  test('Notice → Bid → Notice round trip cannot fabricate a chain', async ({ page }) => {
    // No Notice or Bid records exist in the snapshot; the round trip is a
    // not-found page on each side, never a fabricated RFP with fake bids.
    await page.goto('/notices/RFB-001')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.locator('[role="alert"]')).toContainText('No notice with ID')
    await expect(page.getByRole('link', { name: 'Back to Notices' })).toBeVisible()

    await page.goto('/bids/BID-001')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.locator('[role="alert"]')).toContainText('No bid with ID')
  })

  test('Bid → Company and Contract links point nowhere because no bid exists', async ({ page }) => {
    await page.goto('/bids/BID-001')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    // The empty Bids list must not offer any company, notice, or contract links.
    await page.getByRole('link', { name: 'Back to Bids' }).click()
    await expect(page.locator('tbody tr')).toHaveCount(0)
    await expect(page.locator('main a[href^="/companies/"], main a[href^="/contracts/"]')).toHaveCount(0)
  })

  test('Contract links back to Bid where exists — no contracts exist', async ({ page }) => {
    await page.goto('/contracts/CON-002')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.locator('[role="alert"]')).toContainText('No contract with ID')
    await expect(page.getByRole('link', { name: 'Back to Contracts' })).toBeVisible()
  })

  test('Company is a name-only directory with no record detail', async ({ page }) => {
    // The Companies workspace deliberately holds no Company records, only a
    // name directory, so a company ID never resolves to a funding/procurement
    // activity split.
    await page.goto('/companies/COMP-001')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.locator('[role="alert"]')).toContainText('No company with ID')
    await page.getByRole('link', { name: 'Back to Companies' }).click()
    await expect(page).toHaveURL(/\/companies$/)
    await expect(page.locator('.listbar__counts')).toContainText('companies')
  })

  test('Organization shows Opportunities provided and Notices issued with honest zeros', async ({ page }) => {
    await page.goto('/organizations/ORG-001')
    await expect(page.locator('.related__group', { hasText: 'Opportunities provided' })).toContainText(
      'OPP-001',
    )
    await expect(
      page.locator('.related__group', { hasText: 'Notices issued' }),
    ).toContainText('No notices name this organization')
  })

  test('Source shows relationship groups', async ({ page }) => {
    await page.goto('/sources/SRC-001')
    await expect(page.getByRole('heading', { name: 'Related opportunity' }).first()).toBeVisible()
  })

  test('Browser direct routes and navigation work', async ({ page }) => {
    await page.goto('/opportunities/OPP-001')
    await expect(page).toHaveURL(/\/opportunities\/OPP-001/)
    await page.goBack()
    await page.goForward()
  })

  test('Responsive layout 375px has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/opportunities/OPP-001')
    const body = page.locator('body')
    const width = await body.evaluate((el) => el.scrollWidth)
    expect(width).toBeLessThanOrEqual(400)
  })
})
