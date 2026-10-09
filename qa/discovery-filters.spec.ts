import { expect, test, type Page } from '@playwright/test'
import {
  expectAppChrome,
  externalRequests,
  hasHorizontalOverflow,
  watchPage,
} from './helpers'

/**
 * Phase H: RFP terminology and the optional discovery filters (§10).
 *
 * Covers: the RFP labels (with Grants labels unchanged), the sector/keyword/
 * location controls and their defaults, the filters reaching the discovery
 * request and the run summary, empty-keyword runs, company selection, the
 * unchanged review handoff, and the usual no-network / no-error / 390px bar.
 */

async function selectAllCompanies(page: Page) {
  const checkboxes = page.locator('.dg-company__check')
  for (let index = 0; index < 3; index += 1) {
    await checkboxes.nth(index).check()
  }
  await expect(page.getByRole('status')).toContainText('3 companies selected')
}

/** The summary cell whose label matches. */
function summaryCell(page: Page, label: string) {
  return page.locator('.stat', { hasText: label }).locator('.stat__count')
}

test.describe('RFP terminology', () => {
  test('procurement-facing labels read RFP while Grants labels are unchanged', async ({ page }) => {
    await page.goto('/discovery')

    const domain = page.getByRole('group', { name: 'What to look for' })
    await expect(domain.getByRole('radio')).toHaveCount(2)
    await expect(domain.getByLabel('Grants')).toBeChecked()
    await expect(domain.getByLabel('RFPs')).not.toBeChecked()

    await expect(page.getByRole('button', { name: 'Run Grant Discovery' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run RFP Discovery' })).toBeVisible()

    // The old procurement initial appears nowhere in the panel itself (the
    // product-wide procurement navigation keeps its own records vocabulary).
    await expect(page.locator('main').getByText(/RFB/)).toHaveCount(0)
    await expectAppChrome(page)
  })

  test('an RFP run summaries the domain in the singular', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    await expect(summaryCell(page, 'Domain')).toHaveText('RFP')
    await expect(page.locator('.dg-history__run').first()).toContainText('RFPs')
  })
})

test.describe('filter controls', () => {
  test('sector, keyword, and location render with their unfiltered defaults', async ({ page }) => {
    await page.goto('/discovery')

    const sector = page.getByLabel('Sector / Category')
    await expect(sector).toHaveValue('all')
    await expect(sector.getByRole('option')).toHaveCount(10)
    await expect(sector.getByRole('option').first()).toHaveText('All sectors')
    await expect(sector.getByRole('option').nth(1)).toHaveText('Infrastructure')
    await expect(sector.getByRole('option').last()).toHaveText('Other')

    await expect(page.getByLabel('Keyword')).toHaveValue('')

    const location = page.getByLabel('Location')
    await expect(location).toHaveValue('all')
    await expect(location.getByRole('option')).toHaveCount(4)
    await expect(location.getByRole('option')).toHaveText(['All locations', 'USA', 'India', 'Other'])
  })

  test('sector and location selections stick', async ({ page }) => {
    await page.goto('/discovery')
    await page.getByLabel('Sector / Category').selectOption('construction')
    await page.getByLabel('Location').selectOption('india')
    await expect(page.getByLabel('Sector / Category')).toHaveValue('construction')
    await expect(page.getByLabel('Location')).toHaveValue('india')
  })

  test('keyword input accepts free text', async ({ page }) => {
    await page.goto('/discovery')
    await page.getByLabel('Keyword').fill('solar')
    await expect(page.getByLabel('Keyword')).toHaveValue('solar')
    await page.getByLabel('Keyword').fill('')
    await expect(page.getByLabel('Keyword')).toHaveValue('')
  })
})

test.describe('filters reach the run', () => {
  test('the founder example renders in the summary with real RFP findings', async ({ page }) => {
    const w = watchPage(page)
    await page.goto('/discovery')
    await selectAllCompanies(page)

    await page.getByLabel('Sector / Category').selectOption('infrastructure')
    await page.getByLabel('Keyword').fill('  tender  ')
    await page.getByLabel('Location').selectOption('usa')
    await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    await expect(summaryCell(page, 'Domain')).toHaveText('RFP')
    await expect(summaryCell(page, 'Sector')).toHaveText('Infrastructure')
    await expect(summaryCell(page, 'Keyword')).toHaveText('tender')
    await expect(summaryCell(page, 'Location')).toHaveText('USA')

    // 'tender' matches only the IT Equipment Supply Tender per company.
    await expect(summaryCell(page, 'Candidates found')).toHaveText('6')
    await expect(summaryCell(page, 'Candidates requiring review')).toHaveText('3')
    for (const row of await page.locator('.dg-result').all()) {
      await expect(row.locator('.dg-result__counts')).toContainText('Candidates: 1')
      await expect(row.locator('.dg-result__counts')).toContainText('Needs review: 1')
    }

    expect(w.pageErrors, 'no uncaught page errors').toEqual([])
    expect(w.consoleErrors, 'no console errors').toEqual([])
    expect(w.failedRequests, 'no failed requests').toEqual([])
    expect(externalRequests(w.requests), 'no external requests').toEqual([])
  })

  test('a keyword with no fixture match narrows the handoff to nothing', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByLabel('Keyword').fill('bridge')
    await page.getByRole('button', { name: 'Run Grant Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    await expect(summaryCell(page, 'Keyword')).toHaveText('bridge')
    await expect(summaryCell(page, 'Sector')).toHaveText('All sectors')
    await expect(summaryCell(page, 'Location')).toHaveText('All locations')
    await expect(summaryCell(page, 'Candidates found')).toHaveText('3')
    await expect(summaryCell(page, 'Candidates requiring review')).toHaveText('0')
    await expect(page.getByRole('link', { name: /Review \d candidates/ })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'View Review Queue' })).toBeVisible()
  })

  test('sector and location are recorded without narrowing fixture findings', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByLabel('Sector / Category').selectOption('energy')
    await page.getByLabel('Location').selectOption('india')
    await page.getByRole('button', { name: 'Run Grant Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    await expect(summaryCell(page, 'Sector')).toHaveText('Energy')
    await expect(summaryCell(page, 'Location')).toHaveText('India')
    await expect(summaryCell(page, 'Keyword')).toHaveText('—')
    await expect(summaryCell(page, 'Candidates found')).toHaveText('3')
    await expect(summaryCell(page, 'Candidates requiring review')).toHaveText('3')
  })

  test('company selection still scopes the run', async ({ page }) => {
    await page.goto('/discovery')
    await page.locator('.dg-company__check').nth(1).check()
    await expect(page.getByRole('status')).toContainText('1 company selected')
    await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    await expect(summaryCell(page, 'Companies processed')).toHaveText('1')
    await expect(summaryCell(page, 'Candidates found')).toHaveText('2')
    await expect(page.locator('.dg-result')).toHaveCount(1)
  })
})

test.describe('filtered review handoff', () => {
  test('the narrowed findings land in the Human review queue unchanged', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByLabel('Keyword').fill('grant')
    await page.getByRole('button', { name: 'Run Grant Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    await expect(page.getByRole('link', { name: 'Review 3 candidates' })).toBeVisible()
    await page.getByRole('link', { name: 'Review 3 candidates' }).click()
    await expect(page).toHaveURL(/\/review$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Human review')
    await expect(page.locator('tbody tr')).toHaveCount(7)
    await expect(page.locator('tbody', { hasText: 'Fixture Climate Innovation Grant Programme' })).toBeVisible()
  })
})

test.describe('responsive', () => {
  test('no horizontal overflow with filters set at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto('/discovery')
    expect(await hasHorizontalOverflow(page), 'panel at 390px').toBe(false)

    await selectAllCompanies(page)
    await page.getByLabel('Sector / Category').selectOption('technology')
    await page.getByLabel('Keyword').fill('AI')
    await page.getByLabel('Location').selectOption('usa')
    await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()
    expect(await hasHorizontalOverflow(page), 'panel after a filtered run at 390px').toBe(false)
  })
})