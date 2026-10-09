import { expect, test, type Page } from '@playwright/test'
import { VIEWPORTS, hasHorizontalOverflow } from './helpers'

/**
 * Navigation and information architecture.
 *
 * The primary navigation is a top bar, not a sidebar. Four business
 * destinations carry the product: Home, the Funding and Procurement
 * workspace menus, and Companies. Supporting data (Organizations, Sources)
 * sits one menu away behind "More", and the subprocesses — review, discovery,
 * match review — are reached through their workspace, never from the top bar.
 * These tests pin the hierarchy in the ways a reader meets it: visual order,
 * keyboard order, active state, and each viewport.
 */

const LINK_LABELS = ['Home', 'Companies']
const GROUP_LABELS = ['Funding', 'Procurement', 'More']
/** The utility menu that keeps supporting data reachable without top billing. */
const UTILITY_ITEMS = ['Organizations', 'Sources']

/** The top navigation landmark. */
function nav(page: Page) {
  return page.locator('header.topnav')
}

/** One workflow menu, scoped by its own button so strict mode cannot misfire. */
function group(page: Page, label: string) {
  return page
    .locator('.topnav__group')
    .filter({ has: page.getByRole('button', { name: label, exact: true }) })
}

/** Below 860px the links collapse into a toggled drawer. */
function isNarrow(width: number): boolean {
  return width <= 860
}

/* ------------------------------------------------------------------ */
/* The hierarchy itself                                                */
/* ------------------------------------------------------------------ */

test.describe('top navigation hierarchy', () => {
  test('the header lists Home, the workspaces, Companies, and More', async ({ page }) => {
    await page.goto('/funding')

    // One top bar, and no sidebar anywhere.
    await expect(nav(page)).toHaveCount(1)
    await expect(page.locator('.sidebar')).toHaveCount(0)

    for (const label of LINK_LABELS) {
      await expect(nav(page).getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    for (const label of GROUP_LABELS) {
      await expect(group(page, label).getByRole('button', { name: label, exact: true })).toBeVisible()
    }

    // Supporting data is one menu away, not gone: Organizations and Sources
    // live behind More so they never share the priority of a workspace.
    const more = group(page, 'More')
    await more.getByRole('button', { name: 'More', exact: true }).click()
    for (const item of UTILITY_ITEMS) {
      await expect(more.getByText(item, { exact: true })).toBeVisible()
    }
  })

  test('there is no permanent left sidebar on any internal route', async ({ page }) => {
    for (const path of ['/funding', '/procurement', '/companies', '/']) {
      await page.goto(path)
      await expect(page.locator('.sidebar'), `${path} has no sidebar`).toHaveCount(0)
      await expect(page.locator('nav.sidebar')).toHaveCount(0)
    }
  })

  test('the funding workspace opens to Overview, Opportunities, Matches, and Applications', async ({
    page,
  }) => {
    await page.goto('/funding')
    const funding = group(page, 'Funding')
    await funding.getByRole('button', { name: 'Funding', exact: true }).click()

    const items = funding.locator('.dropdown__item')
    await expect(items).toHaveCount(4)
    await expect(funding.getByText('Overview', { exact: true })).toBeVisible()
    await expect(funding.getByText('Opportunities', { exact: true })).toBeVisible()
    await expect(funding.getByText('Matches', { exact: true })).toBeVisible()
    await expect(funding.getByText('Applications', { exact: true })).toBeVisible()
  })

  test('the procurement workspace opens to Overview, RFPs, Matches, Bids, and Contracts', async ({
    page,
  }) => {
    await page.goto('/funding')
    const procurement = group(page, 'Procurement')
    await procurement.getByRole('button', { name: 'Procurement', exact: true }).click()

    const items = procurement.locator('.dropdown__item')
    await expect(items).toHaveCount(5)
    await expect(procurement.getByText('Overview', { exact: true })).toBeVisible()
    await expect(procurement.getByText('RFPs', { exact: true })).toBeVisible()
    await expect(procurement.getByText('Matches', { exact: true })).toBeVisible()
    await expect(procurement.getByText('Bids', { exact: true })).toBeVisible()
    await expect(procurement.getByText('Contracts', { exact: true })).toBeVisible()
    await expect(procurement.getByText('Proposed RFP-to-company matches', { exact: false })).toBeVisible()
  })

  test('each menu item explains what it is for', async ({ page }) => {
    await page.goto('/funding')
    const expected = { Funding: 4, Procurement: 5, More: 2 }
    for (const label of GROUP_LABELS) {
      const g = group(page, label)
      await g.getByRole('button', { name: label, exact: true }).click()
      const descriptions = await g.locator('.dropdown__item-desc').allTextContents()
      expect(descriptions.length, label).toBe(expected[label as keyof typeof expected])
      for (const d of descriptions) expect(d.trim().length).toBeGreaterThan(10)
      await page.keyboard.press('Escape')
    }
  })

  test('the subprocesses are not offered as top-bar destinations', async ({ page }) => {
    await page.goto('/funding')
    // Review, Discovery, and Match Review are workspace territory. They must
    // appear neither as a top-bar link nor as any menu's item — the workspace
    // bar and the overview flow strips are how a reader reaches them.
    const titles: string[] = []
    for (const label of GROUP_LABELS) {
      const g = group(page, label)
      await g.getByRole('button', { name: label, exact: true }).click()
      titles.push(...(await g.locator('.dropdown__item-title').allTextContents()))
      await page.keyboard.press('Escape')
    }
    for (const forbidden of ['Review', 'Discovery', 'Match Review', 'Procurement Match Review']) {
      expect(titles, `${forbidden} is not a menu item`).not.toContain(forbidden)
      await expect(nav(page).getByRole('link', { name: forbidden, exact: true })).toHaveCount(0)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Keyboard and operability                                            */
/* ------------------------------------------------------------------ */

test.describe('order and operability', () => {
  test('workflow menus open and close by keyboard', async ({ page }) => {
    await page.goto('/funding')
    const button = group(page, 'Funding').getByRole('button', { name: 'Funding', exact: true })

    await button.focus()
    await expect(button).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(group(page, 'Funding').locator('.dropdown__menu')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  test('choosing a workspace item navigates and closes the menu', async ({ page }) => {
    await page.goto('/funding')
    const funding = group(page, 'Funding')
    await funding.getByRole('button', { name: 'Funding', exact: true }).click()
    await funding.getByText('Opportunities', { exact: true }).click()

    await expect(page).toHaveURL(/\/opportunities$/)
    await expect(funding.getByRole('button', { name: 'Funding', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  test('clicking outside closes an open menu', async ({ page }) => {
    await page.goto('/funding')
    const procurement = group(page, 'Procurement')
    await procurement.getByRole('button', { name: 'Procurement', exact: true }).click()
    await expect(procurement.getByRole('button', { name: 'Procurement', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    await page.locator('.shell__main').click({ position: { x: 5, y: 5 } })
    await expect(procurement.getByRole('button', { name: 'Procurement', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})

/* ------------------------------------------------------------------ */
/* Active state                                                        */
/* ------------------------------------------------------------------ */

const ACTIVE_LINK_CASES = [
  // Home (`/`) is the chrome-less landing page, so it has no shell active state.
  { path: '/companies', current: 'Companies' },
  // The utility items live inside the More menu; open it to read the cue.
  { path: '/organizations/ORG-001', current: 'Organizations', menu: 'More' },
  { path: '/sources', current: 'Sources', menu: 'More' },
] as const

const ACTIVE_GROUP_CASES = [
  { path: '/funding', group: 'Funding' },
  { path: '/opportunities', group: 'Funding' },
  { path: '/opportunities/OPP-001', group: 'Funding' },
  { path: '/procurement', group: 'Procurement' },
  { path: '/notices', group: 'Procurement' },
  { path: '/notices/RFB-001', group: 'Procurement' },
] as const

test.describe('active state', () => {
  for (const c of ACTIVE_LINK_CASES) {
    test(`${c.path} marks ${c.current} as the current page`, async ({ page }) => {
      await page.goto(c.path)
      if ('menu' in c && c.menu) {
        await group(page, c.menu).getByRole('button', { name: c.menu, exact: true }).click()
      }
      await expect(nav(page).locator('a[aria-current="page"]')).toHaveCount(1)
      // Menu items carry their description alongside the label, so the cue is
      // matched by contained text rather than by the whole accessible name.
      await expect(nav(page).locator('a[aria-current="page"]')).toContainText(c.current)
    })
  }

  for (const c of ACTIVE_GROUP_CASES) {
    test(`${c.path} marks the ${c.group} workflow as the current section`, async ({ page }) => {
      await page.goto(c.path)
      const active = page.locator('.topnav__group[data-active="true"]')
      await expect(active).toHaveCount(1)
      await expect(active).toContainText(c.group)
      // The "current section" cue is not carried by colour alone.
      const shadow = await active.locator('.topnav__link').first().evaluate((el) => {
        return getComputedStyle(el).boxShadow
      })
      expect(shadow).not.toBe('none')
    })
  }
})

/* ------------------------------------------------------------------ */
/* Routes and deep links preserved                                     */
/* ------------------------------------------------------------------ */

test.describe('route preservation', () => {
  const INTERNAL = [
    '/funding',
    '/procurement',
    '/opportunities',
    '/opportunities/OPP-001',
    '/matches',
    '/matches/MATCH-001',
    '/applications',
    '/applications/APP-001',
    '/notices',
    '/notices/RFB-001',
    '/bids',
    '/bids/BID-001',
    '/contracts',
    '/contracts/CON-001',
    '/companies',
    '/companies/COMP-001',
    '/organizations',
    '/organizations/ORG-001',
    '/sources',
    '/sources/SRC-001',
  ]

  test('the landing route is standalone, without navigation chrome', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    await expect(page.locator('.landing')).toHaveCount(1)
    await expect(page.locator('.topnav')).toHaveCount(0)
    await expect(page.locator('.sidebar')).toHaveCount(0)
  })

  test('every pre-existing route still resolves inside the shell', async ({ page }) => {
    for (const path of INTERNAL) {
      const response = await page.goto(path)
      expect(response?.status(), `${path} responds 200`).toBe(200)
      await expect(page.locator('h1'), `${path} renders a heading`).toHaveCount(1)
      await expect(page.locator('.topnav'), `${path} renders the nav`).toHaveCount(1)
      await expect(page.locator('.sidebar'), `${path} has no sidebar`).toHaveCount(0)
    }
  })

  test('menu navigation works from any route, and query parameters survive a reload', async ({
    page,
  }) => {
    await page.goto('/notices')
    await group(page, 'Funding').getByRole('button', { name: 'Funding', exact: true }).click()
    await group(page, 'Funding').getByText('Opportunities', { exact: true }).click()
    await expect(page).toHaveURL(/\/opportunities$/)

    // A filter set on a collection is still readable from the address bar and
    // survives a reload, which is what makes a deep link shareable.
    await page.goto('/bids?notice=RFB-002')
    await page.reload()
    await expect(page).toHaveURL(/\/bids\?notice=RFB-002$/)
  })
})

/* ------------------------------------------------------------------ */
/* Responsive                                                           */
/* ------------------------------------------------------------------ */

for (const vp of VIEWPORTS) {
  test.describe(`top navigation at ${vp.name} (${vp.width}px)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('the navigation is reachable with no horizontal scroll', async ({ page }) => {
      await page.goto('/funding')
      if (isNarrow(vp.width)) {
        await page.locator('.topnav__toggle').click()
      }
      for (const label of [...LINK_LABELS, ...GROUP_LABELS]) {
        await expect(
          nav(page)
            .getByRole('link', { name: label, exact: true })
            .or(nav(page).getByRole('button', { name: label, exact: true })),
          `${label} reachable`,
        ).toBeVisible()
      }
      expect(await hasHorizontalOverflow(page), 'no horizontal overflow').toBe(false)
    })

    test('active state is preserved at this width', async ({ page }) => {
      await page.goto('/notices')
      if (isNarrow(vp.width)) {
        await page.locator('.topnav__toggle').click()
      }
      await expect(page.locator('.topnav__group[data-active="true"]')).toContainText('Procurement')
      expect(await hasHorizontalOverflow(page), 'no horizontal overflow on a detail route').toBe(false)
    })
  })
}

test('the navigation survives 200% text size', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/funding')

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px' // 200% of the 16px base
  })

  expect(await hasHorizontalOverflow(page), 'no overflow at 200% text size').toBe(false)
})
