import { expect, test } from '@playwright/test'

test('Companies presents the 189-name directory as its primary paginated table', async ({ page }) => {
  await page.goto('/companies')

  await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible()
  await expect(page.locator('.listbar__counts')).toContainText('189 of 189 companies')
  await expect(page.getByRole('heading', { name: 'Source directory names' })).toHaveCount(0)
  await expect(page.getByText(/fictional demonstration|real reference|DEMO/i)).toHaveCount(0)

  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(5)
  await expect(page.locator('thead')).toContainText(
    'CompanyCountryCompany stageFunding activityProcurement activityProfile status',
  )
  await expect(page.locator('tbody tr').first().locator('td')).toHaveCount(6)
  await expect(page.locator('.company-directory-pagination__range')).toHaveText('1–5 of 189')
  await expect(page.locator('tbody tr').first()).toContainText('1839 Ventures')
  await expect(page.locator('tbody tr').nth(1)).toContainText('Aavo')
  await expect(page.locator('tbody tr').nth(0).locator('td').nth(1)).toContainText('Unavailable')

  const allNames: string[] = []
  const next = page.getByRole('button', { name: 'Next companies' })
  while (true) {
    allNames.push(...(await page.locator('tbody tr td:first-child').allTextContents()))
    if (await next.isDisabled()) break
    await next.click()
  }
  expect(allNames).toHaveLength(189)
  expect(new Set(allNames).size).toBe(189)
  expect(allNames).toEqual(
    [...allNames].sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' })),
  )

  await page.getByRole('button', { name: 'Previous companies' }).click()
  await page.getByRole('searchbox', { name: 'Search Companies' }).fill('Aavo')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Aavo')
  await page.getByRole('searchbox', { name: 'Search Companies' }).fill('Harvard Alumni Entrepreneurs')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Harvard Alumni Entrepreneurs')
  await page.getByRole('searchbox', { name: 'Search Companies' }).fill('UT Austin')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('UT Austin')
  await page.getByRole('searchbox', { name: 'Search Companies' }).fill('1839 Ventures')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('1839 Ventures')

  await page.getByRole('searchbox', { name: 'Search Companies' }).fill('')
  const sort = page.getByLabel('Sort by')
  const nameCells = page.locator('tbody tr td:first-child')
  const cmp = (left: string, right: string) => left.localeCompare(right, 'en', { sensitivity: 'base' })

  await sort.selectOption('desc')
  const descNames = await nameCells.allTextContents()
  expect(descNames.length).toBeGreaterThan(0)
  expect(descNames).toEqual([...descNames].sort((left, right) => cmp(right, left)))
  expect(descNames[0]).toBe('Zeronsec')

  await sort.selectOption('asc')
  const ascNames = await nameCells.allTextContents()
  expect(ascNames).toEqual([...ascNames].sort(cmp))
  expect(ascNames[0]).toBe('1839 Ventures')
})
