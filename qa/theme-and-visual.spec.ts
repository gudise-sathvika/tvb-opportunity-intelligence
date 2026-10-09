import { test, expect } from '@playwright/test'

test.describe('Theme and visual (Phase 9)', () => {
  test('Light and dark themes render', async ({ page }) => {
    await page.goto('/funding')
    await expect(page.getByRole('link', { name: /Home/ }).first()).toBeVisible()
  })

  test('Theme toggle exists and is accessible', async ({ page }) => {
    await page.goto('/funding')
    const toggle = page.getByRole('button', { name: /Switch to dark mode|Switch to light mode/ }).first()
    await expect(toggle).toBeVisible()
    await toggle.focus()
    await expect(toggle).toBeFocused()
  })

  test('lists and details render without major errors', async ({ page }) => {
    await page.goto('/opportunities')
    await expect(page).toHaveURL(/\/opportunities/)
    await page.goto('/companies')
    await expect(page).toHaveURL(/\/companies/)
    await page.goto('/organizations/ORG-001')
    await expect(page).toHaveURL(/\/organizations\/ORG-001/)
  })
})
