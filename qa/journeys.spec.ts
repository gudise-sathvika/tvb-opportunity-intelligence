import { expect, test } from '@playwright/test'

/* ------------------------------------------------------------------ */
/* Search behaviour                                                     */
/* ------------------------------------------------------------------ */

test('search filters rows and reports the filtered count', async ({ page }) => {
  await page.goto('/opportunities')

  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(4)

  const search = page.getByRole('searchbox', { name: 'Search Grants' })
  await expect(search).toBeVisible()

  // "India" is the recorded country on OPP-001 and OPP-002.
  await search.fill('India')
  const filtered = await rows.count()
  expect(filtered, 'search should narrow the list').toBe(2)

  // The visible status text tells the user how many rows are showing.
  await expect(page.locator('[role="status"]').filter({ hasText: 'Showing' })).toContainText(
    'Showing 2 of 4 grants',
  )

  // Clear restores the full list.
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(rows).toHaveCount(4)
})

test('search matches IDs as well as names', async ({ page }) => {
  await page.goto('/opportunities')
  const rows = page.locator('tbody tr')
  await page.getByRole('searchbox').fill('OPP-003')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('OPP-003')
})

test('search is case-insensitive', async ({ page }) => {
  await page.goto('/companies')
  const rows = page.locator('tbody tr')
  await page.getByRole('searchbox').fill('ENERGYX')
  await expect(rows).toHaveCount(1)
  await page.getByRole('searchbox').fill('energyx')
  await expect(rows).toHaveCount(1)
})

test('a search with no matches shows an explicit empty state', async ({ page }) => {
  // Measured on a collection that holds records, so the filtered-empty state
  // (which names the term) is distinct from the snapshot-empty state.
  await page.goto('/opportunities')
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(4)

  await page.getByRole('searchbox').fill('zzzzzznotarealterm')
  await expect(rows).toHaveCount(0)
  await expect(page.locator('.empty')).toContainText('No records match your search')
  // The empty state names what was searched for.
  await expect(page.locator('.empty')).toContainText('zzzzzznotarealterm')
})

test('search narrows the smallest collection correctly', async ({ page }) => {
  await page.goto('/organizations')
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(4)
  await page.getByRole('searchbox').fill('ORG-002')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('ORG-002')
})

/* ------------------------------------------------------------------ */
/* Journeys                                                             */
/* ------------------------------------------------------------------ */

test('journey: funding workspace -> opportunity list -> opportunity detail -> related source', async ({ page }) => {
  await page.goto('/funding')
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await nav.getByRole('button', { name: 'Funding' }).click()
  await nav.getByRole('menuitem', { name: /^Opportunities/ }).click()
  await expect(page).toHaveURL('/opportunities')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Funding')

  // The row's link is the opportunity name; the ID is a sibling chip.
  await page.locator('a[href="/opportunities/OPP-001"]').click()
  await expect(page).toHaveURL('/opportunities/OPP-001')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Startup India Seed Fund Scheme')

  // Provider organization is linked from the detail page.
  const related = page.locator('.related')
  await expect(related).toContainText('ORG-001')
  await related.locator('a[href="/organizations/ORG-001"]').click()
  await expect(page).toHaveURL('/organizations/ORG-001')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Department for Promotion of Industry')
})

test('journey: organization -> related opportunity -> its source', async ({ page }) => {
  await page.goto('/organizations')
  await page.locator('a[href="/organizations/ORG-003"]').click()
  await expect(page).toHaveURL('/organizations/ORG-003')
  await expect(page.locator('.related')).toContainText('OPP-003')
  await page.locator('.related a[href="/opportunities/OPP-003"]').click()
  await expect(page).toHaveURL('/opportunities/OPP-003')
  await expect(page.locator('.related')).toContainText('SRC-005')
  await page.locator('.related a[href="/sources/SRC-005"]').click()
  await expect(page).toHaveURL('/sources/SRC-005')
})

test('journey: the company directory leads nowhere but itself', async ({ page }) => {
  // Companies is a name-only directory: no Company records, and therefore no
  // funding trail (matches, applications) can start from a company row.
  await page.goto('/companies')
  await expect(page.locator('.listbar__counts')).toContainText('189 of 189 companies')
  await expect(page.locator('main a[href^="/matches/"], main a[href^="/applications/"]')).toHaveCount(0)

  // A company ID still routes, but to the designed not-found page.
  await page.goto('/companies/COMP-001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('[role="alert"]')).toContainText('No company with ID')
})

test('journey: source -> related opportunity', async ({ page }) => {
  await page.goto('/sources/SRC-003')
  await expect(page.locator('.related')).toContainText('OPP-002')
  await page.locator('.related').getByRole('link', { name: 'OPP-002' }).click()
  await expect(page).toHaveURL('/opportunities/OPP-002')
  // The relationship is bidirectional: OPP-002 lists SRC-003 back.
  await expect(page.locator('.related')).toContainText('SRC-003')
})

test('journey: a match record cannot be opened because none exist', async ({ page }) => {
  await page.goto('/matches/MATCH-003')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('[role="alert"]')).toContainText('No match with ID')
  await page.getByRole('link', { name: 'Back to Matches' }).click()
  // The Matches list states that the collection is empty rather than implying
  // any company or opportunity pairing exists.
  await expect(page.locator('.empty')).toContainText('No records')
  await expect(page.locator('tbody tr')).toHaveCount(0)
})

test('journey: an application record cannot be opened because none exist', async ({ page }) => {
  await page.goto('/applications/APP-002')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('[role="alert"]')).toContainText('No application with ID')
  await page.getByRole('link', { name: 'Back to Applications' }).click()
  await expect(page.locator('.empty')).toContainText('No records')
})

test('a record with no application says so explicitly', async ({ page }) => {
  // OPP-001 is a retained opportunity with no application recorded. That is
  // stated on the page rather than hidden behind another panel.
  await page.goto('/opportunities/OPP-001')
  const group = page.locator('.related__group', { hasText: 'Applications' })
  await expect(group).toContainText('No applications recorded')
  await expect(group.locator('.related__count')).toContainText('(0)')
})

/* ------------------------------------------------------------------ */
/* Funding workflow on the list pages                                   */
/* ------------------------------------------------------------------ */

test('the Opportunities list shows the Match and Application steps as none on every row', async ({ page }) => {
  await page.goto('/opportunities')

  // No opportunity in this snapshot has advanced to a Match or an Application,
  // so every row's step cells must state "none" honestly rather than empty.
  for (const row of await page.locator('tbody tr').all()) {
    await expect(row.locator('td[data-label="Matches"]')).toContainText('none')
    await expect(row.locator('td[data-label="Applications"]')).toContainText('none')
  }
})

test('an Opportunity that never moved states the absent steps as none', async ({ page }) => {
  await page.goto('/opportunities')

  const still = page.locator('tbody tr').filter({ hasText: 'OPP-003' })
  await expect(still.locator('td[data-label="Matches"]')).toContainText('none')
  await expect(still.locator('td[data-label="Applications"]')).toContainText('none')

  // The step cells are searchable too: a fictional match ID from the old demo
  // snapshot is not in the data, and the search says so.
  await page.getByRole('searchbox').fill('MATCH-003')
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await expect(page.locator('.empty')).toContainText('No records match your search')
})

test('the Matches list states the absence of pairings instead of fabricating them', async ({ page }) => {
  await page.goto('/matches')

  // No Match records exist, so there are no company/opportunity pairings and
  // no links to follow.
  await expect(page.locator('.empty')).toContainText('No records')
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await expect(page.locator('main a[href^="/opportunities/"]')).toHaveCount(0)
})

test('journey: opportunity -> provider organization -> back to the opportunity', async ({ page }) => {
  // The funding trail that genuinely exists: an opportunity belongs to its
  // provider organization, and the organization lists the opportunity back.
  await page.goto('/opportunities/OPP-001')

  const related = page.locator('.related')
  await related.locator('.related__group', { hasText: 'Provider organization' }).getByRole('link').click()
  await expect(page).toHaveURL('/organizations/ORG-001')

  await page
    .locator('.related__group', { hasText: 'Opportunities provided' })
    .getByRole('link', { name: 'OPP-001' })
    .click()
  await expect(page).toHaveURL('/opportunities/OPP-001')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Startup India Seed Fund Scheme')
})

test('funding filters are URL-synced, apply on load, and survive a reload', async ({ page }) => {
  await page.goto('/matches?matchStatus=Under+review')
  // The Matches collection holds no records, but the parameter still applies on
  // load and reload without an error, leaving the honest empty state.
  await expect(page.locator('.empty')).toBeVisible()
  await page.reload()
  await expect(page.locator('.empty')).toBeVisible()

  // The real filter surface: Opportunities. ?opportunityType=Fund narrows the
  // four retained grants to the one Fund, on load and after a reload.
  await page.goto('/opportunities?opportunityType=Fund')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(page.locator('[role="status"]').filter({ hasText: 'Showing 1 of 4' })).toBeVisible()

  // Changing the filter interactively moves the list back to the full set.
  await page.selectOption('#filter-opportunityType', '')
  await expect(page.locator('tbody tr')).toHaveCount(4)
})

/* ------------------------------------------------------------------ */
/* Browser history                                                      */
/* ------------------------------------------------------------------ */

test('browser back and forward walk the journey and restore scroll-independent state', async ({ page }) => {
  await page.goto('/funding')
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await nav.getByRole('button', { name: 'Funding' }).click()
  await nav.getByRole('menuitem', { name: /^Opportunities/ }).click()
  await page.locator('a[href="/opportunities/OPP-001"]').click()
  await expect(page).toHaveURL('/opportunities/OPP-001')

  await page.goBack()
  await expect(page).toHaveURL('/opportunities')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Funding')
  await expect(page.locator('tbody tr')).toHaveCount(4)

  await page.goBack()
  await expect(page).toHaveURL('/funding')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Funding')

  await page.goForward()
  await expect(page).toHaveURL('/opportunities')
  await expect(page.locator('tbody tr')).toHaveCount(4)

  await page.goForward()
  await expect(page).toHaveURL('/opportunities/OPP-001')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Startup India Seed Fund Scheme')
})

test('a search is cleared when navigating back to the list', async ({ page }) => {
  // Measured on a collection with rows, so the cleared search visibly restores
  // the full list rather than a vacuous zero.
  await page.goto('/opportunities')
  await page.getByRole('searchbox').fill('India')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await page.goBack()
  await page.goForward()
  // Stale search text must not survive a remount and hide rows.
  await expect(page.getByRole('searchbox')).toHaveValue('')
  await expect(page.locator('tbody tr')).toHaveCount(4)
})

test('the top navigation marks the current section and navigates between collections', async ({ page }) => {
  await page.goto('/opportunities/OPP-001')
  const group = page.locator('.topnav__group[data-active="true"]')
  await expect(group).toHaveCount(1)
  await expect(group.getByRole('button', { name: /Funding/ })).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Primary' })
  await nav.getByRole('button', { name: 'More' }).click()
  await nav.getByRole('menuitem', { name: /^Sources/ }).click()
  await expect(page).toHaveURL('/sources')
  // The current item inside the menu carries the cue, and it is the only one.
  await expect(page.locator('.dropdown__item--active')).toHaveText(/^Sources/)
  await expect(page.locator('.dropdown__item--active')).toHaveCount(1)
})
