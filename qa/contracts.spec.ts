import { expect, test, type Locator, type Page } from '@playwright/test'
import { VIEWPORTS, expectAppChrome, hasHorizontalOverflow, watchPage } from './helpers'

/**
 * Phase 6 — contracts.
 *
 * `routes.spec.ts` covers the Contracts list and detail routes generically, and
 * `bids.spec.ts` covers the Bid side of the relationship. This file covers only
 * the Phase 6 behaviour in its honest, post-snapshot form.
 *
 * The production snapshot contains no Contract, Notice, or Bid records. The
 * demo CON-001..005 records no longer exist, so no 27-field contract schema can
 * render. What the produced pages still guarantee, and what this file measures:
 *
 *   - the empty list states the absence and refuses to fabricate rows
 *   - the four independent status columns are named in the prose, and no single
 *     "Status" table column can silently appear
 *   - no invented totals: the mixed-currency refusal is stated, and no total is
 *     rendered
 *   - contract IDs resolve to the designed not-found page, and those pages draw
 *     no bid, company, or notice relationship surfaces
 *   - filtering and sorting remain operable over the empty collection and never
 *     crash or invent rows
 */

/** The field row for a raw schema field name. */
function fieldRow(page: Page, field: string): Locator {
  return page
    .locator('dl.fields')
    .first()
    .locator('.fields__row')
    .filter({ has: page.locator('.fields__raw', { hasText: new RegExp(`^${field}$`) }) })
}

/** One relationship group inside the shared "Related records" card. */
function relatedGroup(page: Page, label: string): Locator {
  return page.locator('.related__group').filter({ hasText: label })
}

/** Rows in the shared record table. */
function rows(page: Page): Locator {
  return page.locator('table tbody tr')
}

/** A filter select in the list-page filter bar, by its visible label. */
function filter(page: Page, label: string): Locator {
  return page
    .locator('.filterbar__field')
    .filter({ has: page.locator('label', { hasText: new RegExp(`^${label}$`) }) })
    .locator('select')
}

/** The body of one list-page column, identified by its header text. */
function column(page: Page, header: string): Locator {
  return page.locator('thead th').filter({ hasText: header })
}

/* ------------------------------------------------------------------ */
/* The empty collection                                                */
/* ------------------------------------------------------------------ */

test('the contracts list holds no records and says so', async ({ page }) => {
  const w = watchPage(page)
  await page.goto('/contracts')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contracts')
  await expectAppChrome(page)
  await expect(rows(page)).toHaveCount(0)
  await expect(page.locator('.empty')).toContainText('No records')
  await expect(page.locator('main')).not.toContainText('Fictional')
  expect(w.pageErrors).toEqual([])
  expect(w.consoleErrors).toEqual([])
  expect(w.failedRequests).toEqual([])
})

test('no contract schema can render, and no invented field order appears', async ({ page }) => {
  // The 27 authoritative Phase 1 fields belonged to demo contracts that no
  // longer exist. A contract ID must not render any of them.
  await page.goto('/contracts/CON-001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
  await expect(page.locator('dl.fields')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Back to Contracts' })).toHaveAttribute('href', '/contracts')

  // The required-field guarantee is equally unreachable: no contract renders,
  // so no field can be dropped or left blank.
  await expect(page.locator('main')).not.toContainText('contract_id')
})

test('no fictional badge is drawn anywhere, because no synthetic records exist', async ({ page }) => {
  await page.goto('/contracts')
  await expect(page.locator('main .badge--fiction')).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText('Fictional')
})

test('the four independent status columns are named, and no combined Status column exists', async ({ page }) => {
  await page.goto('/contracts')
  // With no records there is no table at all, so a collapsed "Status" column
  // cannot silently replace the four independent ones. The prose states the
  // design, and the four controlled fields are named in the description.
  await expect(page.locator('thead th')).toHaveCount(0)
  await expect(page.locator('main')).toContainText('four status columns')
  await expect(page.locator('main')).toContainText('delivery, acceptance, and payment')
})

/* ------------------------------------------------------------------ */
/* Totals                                                              */
/* ------------------------------------------------------------------ */

test('no cross-currency total exists, and the page says why', async ({ page }) => {
  await page.goto('/contracts')
  // The mixed-currency refusal is part of the page prose and must be visible on
  // the empty collection too: the corpus is multi-currency, so any total would
  // be arithmetic on incompatible units.
  await expect(page.locator('main')).toContainText(
    'adding across currencies would produce a meaningless number',
  )
  await expect(page.locator('main')).not.toContainText(/portfolio value/i)
})

/* ------------------------------------------------------------------ */
/* Relationship surfaces                                               */
/* ------------------------------------------------------------------ */

test('a contract ID cannot draw a bid, company, or notice relationship surface', async ({ page }) => {
  // The demo contract relationships (no-bid basis, From bid, contracts produced)
  // belonged to records that no longer exist, so their pages must be bare.
  for (const id of ['CON-001', 'CON-004', 'CON-005']) {
    await page.goto(`/contracts/${id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.locator('main a[href^="/bids/"]')).toHaveCount(0)
    await expect(page.locator('main a[href^="/companies/"]')).toHaveCount(0)
  }

  const CON_004_notfound = await page.getByRole('heading', { level: 1 }).innerText()
  await page.goto('/contracts')
  await expect(page.locator('tbody tr')).toHaveCount(0)
  void CON_004_notfound
})

test('filtering and sorting remain operable over the empty contracts list', async ({ page }) => {
  const w = watchPage(page)
  await page.goto('/contracts')
  await expect(page.locator('.filterbar select').first()).toBeVisible()

  // The controlled filters render with their labels; with no contracts there is
  // no value to choose, so each offers only the "All" placeholder. The sorting
  // controls are static and remain selectable.
  for (const name of ['Contract status', 'Acceptance', 'Performance security']) {
    const f = filter(page, name)
    await expect(f).toBeVisible()
    await expect(f.locator('option')).toHaveText('All')
  }

  await page.locator('#filter-sort').selectOption('value')
  await expect(rows(page)).toHaveCount(0)
  expect(w.pageErrors).toEqual([])
  expect(w.consoleErrors).toEqual([])
  // No total line, no sorted row, nothing to compare across currencies.
  await expect(page.locator('main')).not.toContainText(/portfolio value/i)
})

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

test('a bid or notice ID under /contracts reports not-found', async ({ page }) => {
  for (const id of ['BID-005', 'RFB-002']) {
    await page.goto(`/contracts/${id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Record not found')
    await expect(page.locator('[role="alert"]')).toContainText('No contract with ID')
    await expect(page.getByRole('link', { name: 'Back to Contracts' })).toBeVisible()
  }
})

test('an unknown contract ID does not create a record', async ({ page }) => {
  for (const bad of ['CON-999', 'con-001', 'CON-1']) {
    await page.goto(`/contracts/${bad}`)
    await expect(page.getByRole('heading', { level: 1 }), bad).toHaveText('Record not found')
  }
})

test('contracts are reachable from the procurement workspace and counted honestly there', async ({ page }) => {
  await page.goto('/procurement')
  const mini = page.locator('.mini').filter({ hasText: 'contracts under management' })
  await expect(mini).toBeVisible()
  // The workspace counts what it holds: zero contracts.
  await expect(mini.locator('.mini__count')).toHaveText('0')
  await expect(mini).toHaveAttribute('href', '/contracts')

  await mini.click()
  await expect(page).toHaveURL(/\/contracts$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contracts')
})

/* ------------------------------------------------------------------ */
/* Accessibility and responsiveness                                   */
/* ------------------------------------------------------------------ */

test('every filter control has an accessible name', async ({ page }) => {
  await page.goto('/contracts')
  const selects = page.locator('.filterbar select')
  const n = await selects.count()
  expect(n).toBeGreaterThan(0)
  for (let i = 0; i < n; i += 1) {
    await expect(selects.nth(i)).toHaveAccessibleName(/.+/)
  }
})

test('the not-found detail page keeps one h1 and a keyboard-reachable back link', async ({ page }) => {
  await page.goto('/contracts/CON-002')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  const back = page.getByRole('link', { name: 'Back to Contracts' })
  await back.focus()
  await expect(back).toBeFocused()
})

test('the not-found page renders no unlabelled relationship surface', async ({ page }) => {
  await page.goto('/contracts/CON-002')
  // No records exist, so no relationship groups render (labelled or otherwise).
  await expect(page.locator('.related__group')).toHaveCount(0)
})

for (const vp of VIEWPORTS) {
  test.describe(`responsive ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('the contracts list does not scroll sideways', async ({ page }) => {
      await page.goto('/contracts')
      await expect(rows(page)).toHaveCount(0)
      expect(await hasHorizontalOverflow(page), 'no sideways scroll').toBe(false)
    })

    test('the contract not-found detail does not scroll sideways', async ({ page }) => {
      await page.goto('/contracts/CON-001')
      expect(await hasHorizontalOverflow(page), 'no sideways scroll').toBe(false)
    })
  })
}