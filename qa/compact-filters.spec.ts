import { expect, test } from '@playwright/test'
import { watchPage } from './helpers'

test.describe('Compact filters across Funding and Procurement', () => {
  test('Funding Opportunities has visible search, visible primary filters, and operable category popup', async ({ page }) => {
    const w = watchPage(page)
    await page.goto('/opportunities')

    // 1. Search remains visible where it already exists
    const search = page.locator('#record-search')
    await expect(search).toBeVisible()

    // 2. Most important existing filters visible
    await expect(page.locator('#filter-opportunityType')).toBeVisible()
    await expect(page.locator('#filter-hasDeadline')).toBeVisible()
    await expect(page.locator('#filter-sort')).toBeVisible()

    // 3. Category button exists
    const categoryBtn = page.locator('.filterbar__category-btn').first()
    await expect(categoryBtn).toBeVisible()

    // Popup initially closed
    const popup = page.locator('.filterbar__popup')
    await expect(popup).toHaveCount(0)

    // Hover reveals popup
    await categoryBtn.hover()
    await expect(popup).toBeVisible()
    await expect(page.locator('#filter-verificationStatus')).toBeVisible()
    await expect(page.locator('#filter-recordStatus')).toBeVisible()
    await expect(page.locator('#filter-country')).toBeVisible()

    // Move away without pinning closes popup
    await page.locator('h1').hover()
    await expect(popup).toHaveCount(0)

    // Click pins popup
    await categoryBtn.click()
    await expect(popup).toBeVisible()

    // Move away while pinned stays open
    await page.locator('h1').hover()
    await expect(popup).toBeVisible()

    // Select a filter inside popup
    await page.locator('#filter-country').selectOption('India')
    await expect(page).toHaveURL(/country=India/)

    // Shows active badge/count and selected value on button
    await expect(categoryBtn.locator('.filterbar__badge')).toHaveText('1')
    await expect(categoryBtn).toContainText('India')

    // Click categoryBtn again unpins and closes
    await categoryBtn.click()
    await expect(popup).toHaveCount(0)

    // Clear filters
    const clearBtn = page.getByRole('button', { name: /clear 1 filter/i })
    await expect(clearBtn).toBeVisible()
    await clearBtn.click()
    await expect(page).not.toHaveURL(/country=India/)
    await expect(categoryBtn.locator('.filterbar__badge')).toHaveCount(0)

    expect(w.pageErrors).toEqual([])
    expect(w.consoleErrors).toEqual([])
  })

  test('Procurement RFPs (Notices) has compact category filters', async ({ page }) => {
    await page.goto('/notices')

    // Search visible
    await expect(page.locator('#record-search')).toBeVisible()

    // Primary filters visible
    await expect(page.locator('#filter-noticeType')).toBeVisible()
    await expect(page.locator('#filter-noticeStatus')).toBeVisible()
    await expect(page.locator('#filter-deadline')).toBeVisible()
    await expect(page.locator('#filter-sort')).toBeVisible()

    // Category button
    const catBtn = page.getByRole('button', { name: /procedure & bids/i })
    await expect(catBtn).toBeVisible()

    // Click to pin/open
    await catBtn.click()
    const popup = page.locator('.filterbar__popup')
    await expect(popup).toBeVisible()
    await expect(page.locator('#filter-procurementMethod')).toBeVisible()
    await expect(page.locator('#filter-lotStructure')).toBeVisible()
    await expect(page.locator('#filter-bids')).toBeVisible()

    // Unpin via pin button in header
    const pinBtn = page.locator('.filterbar__pin-btn')
    await expect(pinBtn).toHaveText('📌 Pinned')
    await pinBtn.click()
    await expect(pinBtn).toHaveText('📍 Pin')

    // Close button
    await page.locator('.filterbar__popup-close').click()
    await expect(popup).toHaveCount(0)
  })

  test('Procurement Bids has primary axes visible and Tender & Entity category', async ({ page }) => {
    await page.goto('/bids')

    // Search visible
    await expect(page.locator('#record-search')).toBeVisible()

    // 3 axes visible
    await expect(page.locator('#filter-eligibility')).toBeVisible()
    await expect(page.locator('#filter-decision')).toBeVisible()
    await expect(page.locator('#filter-status')).toBeVisible()
    await expect(page.locator('#filter-sort')).toBeVisible()

    // Category button
    const catBtn = page.getByRole('button', { name: /tender & entity/i })
    await expect(catBtn).toBeVisible()

    // Click to open
    await catBtn.click()
    const popup = page.locator('.filterbar__popup')
    await expect(popup).toBeVisible()
    await expect(page.locator('#filter-companyId')).toBeVisible()
    await expect(page.locator('#filter-noticeId')).toBeVisible()
    await expect(page.locator('#filter-deadline')).toBeVisible()

    // Outside click closes
    await page.locator('h1').click()
    await expect(popup).toHaveCount(0)
  })

  test('Procurement Contracts has 4 status columns visible and Parties & Tender category', async ({ page }) => {
    await page.goto('/contracts')

    // Search visible
    await expect(page.locator('#record-search')).toBeVisible()

    // 4 status axes visible
    await expect(page.locator('#filter-status')).toBeVisible()
    await expect(page.locator('#filter-acceptance')).toBeVisible()
    await expect(page.locator('#filter-payment')).toBeVisible()
    await expect(page.locator('#filter-security')).toBeVisible()
    await expect(page.locator('#filter-sort')).toBeVisible()

    // Category button
    const catBtn = page.getByRole('button', { name: /parties & tender/i })
    await expect(catBtn).toBeVisible()

    // Hover reveals popup
    await catBtn.hover()
    const popup = page.locator('.filterbar__popup')
    await expect(popup).toBeVisible()
    await expect(page.locator('#filter-bidPresence')).toBeVisible()
    await expect(page.locator('#filter-companyId')).toBeVisible()
    await expect(page.locator('#filter-noticeId')).toBeVisible()
    await expect(page.locator('#filter-bidId')).toBeVisible()
    await expect(page.locator('#filter-currency')).toBeVisible()
  })

  test('Funding Matches has primary filters and Assessment & Links category', async ({ page }) => {
    await page.goto('/matches')

    // Search visible
    await expect(page.locator('#record-search')).toBeVisible()

    // Primary filters visible
    await expect(page.locator('#filter-matchStatus')).toBeVisible()
    await expect(page.locator('#filter-eligibilityStatus')).toBeVisible()

    // Category button
    const catBtn = page.getByRole('button', { name: /assessment & links/i })
    await expect(catBtn).toBeVisible()

    await catBtn.click()
    const popup = page.locator('.filterbar__popup')
    await expect(popup).toBeVisible()
    await expect(page.locator('#filter-priority')).toBeVisible()
    await expect(page.locator('#filter-hasApplication')).toBeVisible()
  })

  test('Funding Applications has primary filter and Timeline category', async ({ page }) => {
    await page.goto('/applications')

    // Search visible
    await expect(page.locator('#record-search')).toBeVisible()

    // Primary filter visible
    await expect(page.locator('#filter-applicationStatus')).toBeVisible()

    // Category button
    const catBtn = page.getByRole('button', { name: /timeline/i })
    await expect(catBtn).toBeVisible()

    await catBtn.click()
    const popup = page.locator('.filterbar__popup')
    await expect(popup).toBeVisible()
    await expect(page.locator('#filter-hasSubmissionDate')).toBeVisible()
  })

  test('supports basic keyboard interaction (Enter/Space to toggle, Escape to close)', async ({ page }) => {
    await page.goto('/opportunities')
    const catBtn = page.locator('.filterbar__category-btn').first()
    const popup = page.locator('.filterbar__popup')

    // Tab to button and press Enter to toggle open
    await catBtn.focus()
    await page.keyboard.press('Enter')
    await expect(popup).toBeVisible()

    // Escape closes the open popup
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)

    // Press Enter again to toggle closed
    await page.keyboard.press('Enter')
    await expect(popup).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(popup).toHaveCount(0)

    // Press Space to toggle open
    await page.keyboard.press('Space')
    await expect(popup).toBeVisible()

    // Press Space again to toggle closed
    await page.keyboard.press('Space')
    await expect(popup).toHaveCount(0)
  })

  test('Funding Opportunities sort control reorders rows by ID and by title', async ({ page }) => {
    const w = watchPage(page)
    await page.goto('/opportunities')

    const sort = page.locator('#filter-sort')
    const idCells = page.locator('tbody tr td:first-child .idbadge')
    const titleLinks = page.locator('tbody tr td:first-child .recordlink__name')
    const cmp = (left: string, right: string) => left.localeCompare(right)

    await sort.selectOption('id')
    const ids = await idCells.allTextContents()
    expect(ids.length).toBeGreaterThan(1)
    expect(ids).toEqual([...ids].sort(cmp))

    await sort.selectOption('title')
    const titles = await titleLinks.allTextContents()
    expect(titles.length).toBeGreaterThan(1)
    expect(titles).toEqual([...titles].sort(cmp))

    // The ID sort is stable: selecting it again reproduces the same order.
    await sort.selectOption('id')
    expect(await idCells.allTextContents()).toEqual(ids)

    expect(w.pageErrors).toEqual([])
    expect(w.consoleErrors).toEqual([])
  })
})
