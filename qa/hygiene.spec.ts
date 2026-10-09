import { expect, test } from '@playwright/test'
import { DETAIL_ROUTES, LIST_ROUTES, externalRequests, watchPage } from './helpers'

/**
 * A full crawl of the app, watching the console and every network request.
 * The vault is a local folder, so any request leaving localhost would mean
 * record data was being sent somewhere.
 */
test('no console errors, page errors, or third-party requests across a full crawl', async ({ page }) => {
  const w = watchPage(page)

  const paths = [
    '/',
    ...LIST_ROUTES.map((r) => r.path),
    ...DETAIL_ROUTES.map((r) => r.path),
    // Records with deliberately empty relationships and blank fields.
    '/matches/MATCH-002',
    '/opportunities/OPP-003',
    '/opportunities/OPP-005',
    '/organizations/ORG-005',
    // Invalid routes must not blow up either.
    '/opportunities/NOPE-999',
    '/nonsense',
  ]

  for (const p of paths) {
    await page.goto(p)
    await expect(page.getByRole('heading', { level: 1 }), p).toBeVisible()
    // Let any async effect settle before moving on.
    await page.waitForTimeout(50)
  }

  expect(w.pageErrors, 'no uncaught exceptions').toEqual([])
  expect(w.consoleErrors, 'no console errors').toEqual([])
  expect(w.failedRequests, 'no failed requests').toEqual([])

  // Every request must be to the local preview origin.
  const external = externalRequests(w.requests)
  expect(external, 'no requests leave localhost').toEqual([])

  // And confirm the crawl really did load the app, so the assertions above
  // cannot pass vacuously.
  const html = w.requests.filter((r) => r.resourceType === 'document')
  expect(html.length, 'pages were actually fetched').toBe(paths.length)
})

test('no demo prototype notice is present in the chrome', async ({ page }) => {
  await page.goto('/funding')
  await expect(page.locator('.demo-notice')).toHaveCount(0)
  await expect(page.getByText('DEMO PROTOTYPE', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Sample records may be fictional', { exact: false })).toHaveCount(0)
})

test('normal lists contain only retained records and no fictional labels', async ({ page }) => {
  await page.goto('/opportunities')
  const opportunityRows = page.locator('tbody tr')
  await expect(opportunityRows).toHaveCount(4)
  expect((await opportunityRows.allTextContents()).join('\n')).not.toMatch(/DEMO|Fictional|Fictional demonstration/i)

  await page.goto('/companies')
  await expect(page.locator('.listbar__counts')).toContainText('189 of 189 companies')
  await expect(page.locator('tbody tr')).toHaveCount(5)
  expect((await page.locator('tbody tr').allTextContents()).join('\n')).not.toMatch(
    /DEMO|Fictional|Fictional demonstration/i,
  )

  await page.goto('/sources')
  await expect(page.locator('tbody tr')).toHaveCount(6)
  const sourceRows = await page.locator('tbody tr').allTextContents()
  for (let i = 0; i < 6; i++) {
    expect(sourceRows[i]).not.toMatch(/DEMO|Fictional|Fictional demonstration/i)
  }
})

test('statuses render verbatim and carry no approval colour', async ({ page }) => {
  // MATCH-002 no longer exists: the snapshot holds no Match records. The same
  // guarantee is measured on a real retained record instead — OPP-001's status
  // set (Verified / Active / Rolling) is the shipping equivalent surface.
  await page.goto('/opportunities/OPP-001')
  const badges = page.locator('.page__badges .badge')
  await expect(badges).toContainText(['Verified'])
  await expect(badges).toContainText(['Active'])
  await expect(badges).toContainText(['Rolling'])

  // "Verified" and "Active" must not be tinted as approvals, nor "Rolling" as a
  // warning: the app deliberately avoids a good/bad colour mapping.
  const tones = await badges.evaluateAll((els) =>
    els.map((e) => (e.className.match(/badge--(\w+)/)?.[1] ?? 'none') as string),
  )
  const judgementTones = ['success', 'danger', 'warning', 'good', 'bad']
  for (const tone of tones) {
    expect(judgementTones, `badge tone "${tone}" implies a judgement`).not.toContain(tone)
  }
})
