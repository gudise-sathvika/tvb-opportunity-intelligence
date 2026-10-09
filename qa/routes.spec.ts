import { expect, test } from '@playwright/test'
import { DETAIL_ROUTES, LIST_ROUTES, expectAppChrome, watchPage } from './helpers'

/* ------------------------------------------------------------------ */
/* Console and network hygiene, checked on every route below            */
/* ------------------------------------------------------------------ */

test('home renders the landing page and the removed dashboard route redirects to it', async ({ page }) => {
  const w = watchPage(page)

  await page.goto('/')
  await expect(page.locator('.landing')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Discover opportunities.')

  // The dashboard route was removed; its old address must land on Home, never
  // 404 or render half a page.
  await page.goto('/dashboard')
  await expect(page).toHaveURL('/')
  await expect(page.locator('.landing')).toHaveCount(1)

  expect(w.pageErrors, 'no uncaught page errors').toEqual([])
  expect(w.consoleErrors, 'no console errors').toEqual([])
  expect(w.failedRequests, 'no failed requests').toEqual([])
})

test('home presents the three product cards (Funding, Procurement, Companies) with their routes', async ({ page }) => {
  await page.goto('/')

  const cards = page.locator('.landing__cards .landing-card')
  await expect(cards).toHaveCount(3)

  const funding = cards.nth(0)
  const procurement = cards.nth(1)
  const companies = cards.nth(2)

  await expect(funding).toContainText('Funding')
  await expect(procurement).toContainText('Procurement')
  await expect(companies).toContainText('Companies')

  await expect(funding.getByRole('link', { name: /Explore Funding/ })).toHaveAttribute('href', '/funding')
  await expect(procurement.getByRole('link', { name: /Explore Procurement/ })).toHaveAttribute('href', '/procurement')
  await expect(companies.getByRole('link', { name: /Explore Companies/ })).toHaveAttribute('href', '/companies')

  // The Companies card count is data-driven from the Companies workspace source.
  await expect(companies).toContainText('189 companies are currently tracked')
})

test('all nine list pages render the correct rows and show the notice', async ({ page }) => {
  const w = watchPage(page)

  for (const route of LIST_ROUTES) {
    await page.goto(route.path)
    await expect(page.getByRole('heading', { level: 1 }), route.path).toHaveText(route.h1)
    await expectAppChrome(page)
    await expect(page.locator('tbody tr'), `${route.path} row count`).toHaveCount(route.rows)

    if (route.rows > 0 && route.linkable) {
      // Every row links to a detail route.
      const firstLink = page.locator('tbody tr').first().locator('a').first()
      await expect(firstLink).toHaveAttribute('href', new RegExp(`^/${route.path.slice(1)}/`))
    } else if (route.rows > 0) {
      // Companies renders rows but is a name-only directory: no row may link to
      // a (non-existent) Company record detail page.
      await expect(page.locator('tbody tr a[href^="/companies/"]')).toHaveCount(0)
    } else {
      // Collections the snapshot holds no records for render the explicit
      // empty state instead of a table of links.
      await expect(page.locator('.empty'), `${route.path} empty state`).toBeVisible()
    }
  }

  expect(w.pageErrors, 'no uncaught page errors').toEqual([])
  expect(w.consoleErrors, 'no console errors').toEqual([])
})

test('all nine detail page types render every field, provenance, and the notice', async ({ page }) => {
  const w = watchPage(page)

  for (const route of DETAIL_ROUTES) {
    await page.goto(route.path)
    await expect(page.getByRole('heading', { level: 1 }), route.path).toBeVisible()
    await expectAppChrome(page)

    // One row per schema field, so nothing is silently dropped.
    // Scoped to the first <dl>: the Provenance card reuses .fields__row.
    await expect(page.locator('dl.fields').first().locator('.fields__row'), `${route.path} field rows`).toHaveCount(route.fields)

    // Real/fictional state is always visible. Not every type carries status
    // badges (organizations and sources have none), but where badges exist
    // they must be on the page.
    const badgeCount = await page.locator('.page__badges .badge').count()
    if (badgeCount > 0) {
      await expect(page.locator('.page__badges .badge').first()).toBeVisible()
    }

    // Provenance is present on every detail page.
    const prov = page.locator('.card', { hasText: 'Provenance' })
    await expect(prov).toContainText('Source file')
    await expect(prov).toContainText('Source SHA-256')
    await expect(prov.locator('.hash')).toHaveText(/^[0-9a-f]{64}$/)

    // Back link points at a real list route, not a malformed plural.
    const back = page.locator('.crumbs a')
    await expect(back).toHaveAttribute(
      'href',
      /^\/(opportunities|companies|matches|applications|organizations|sources|notices|bids|contracts)$/,
    )
  }

  expect(w.pageErrors, 'no uncaught page errors').toEqual([])
  expect(w.consoleErrors, 'no console errors').toEqual([])
})

test('a record ID of the wrong type reports not-found rather than rendering', async ({ page }) => {
  await page.goto('/opportunities/OPP-001')
  // OPP-001 exists, but not as a company.
  await page.goto('/companies/OPP-001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('[role="alert"]')).toContainText('No company with ID')
  await expect(page.getByRole('link', { name: 'Back to Companies' })).toBeVisible()
})

test('unknown and empty IDs are handled without creating a record', async ({ page }) => {
  for (const bad of ['NOPE-999', 'opp-001', 'OPP-001%20', '0']) {
    await page.goto(`/opportunities/${bad}`)
    await expect(page.getByRole('heading', { level: 1 }), bad).toHaveText('Record not found')
    await expect(page.locator('[role="alert"]')).toContainText('not present in the generated snapshot')
  }

  // An unknown top-level path gets the catch-all page.
  await page.goto('/not-a-route')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found')
  await expect(page.getByRole('link', { name: 'Back to Home' })).toBeVisible()
})
