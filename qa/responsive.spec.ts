import { expect, test } from '@playwright/test'
import {
  DETAIL_ROUTES,
  LIST_ROUTES,
  VIEWPORTS,
  expectAppChrome,
  hasHorizontalOverflow,
  widestOverflowingElement,
} from './helpers'
import { mkdirSync } from 'node:fs'

const SHOTS = 'qa/screenshots'
mkdirSync(SHOTS, { recursive: true })

/** Routes worth capturing visually at each width. */
const SHOT_ROUTES = [
  { name: 'opportunities-list', path: '/opportunities' },
  { name: 'opportunities-list-search', path: '/opportunities' },
  { name: 'opportunity-detail', path: '/opportunities/OPP-001' },
  { name: 'match-detail', path: '/matches/MATCH-002' },
  { name: 'source-detail', path: '/sources/SRC-001' },
  { name: 'not-found', path: '/opportunities/NOPE-999' },
]

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} (${vp.width}px)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test(`no horizontal overflow on any route`, async ({ page }) => {
      const offenders: string[] = []

      for (const route of [...LIST_ROUTES.map((r) => ({ path: r.path })), ...DETAIL_ROUTES, { path: '/nope' }]) {
        await page.goto(route.path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

        if (await hasHorizontalOverflow(page)) {
          const worst = await widestOverflowingElement(page)
          offenders.push(`${route.path} -> ${worst?.tag}.${worst?.cls} right=${worst?.right}`)
        }
      }

      expect(offenders, `horizontal overflow at ${vp.width}px`).toEqual([])
    })

    test('top navigation behaves at this width and no sidebar exists', async ({ page }) => {
      await page.goto('/opportunities/OPP-001')

      // The redesign removed the sidebar everywhere, at every width.
      await expect(page.locator('.sidebar')).toHaveCount(0)

      const topnav = page.locator('header.topnav')
      await expectAppChrome(page)
      const box = await topnav.boundingBox()
      expect(box!.width).toBeLessThanOrEqual(vp.width + 1)

      if (vp.width >= 860) {
        // Wide: links run horizontally, the drawer toggle is hidden.
        await expect(page.locator('.topnav__toggle')).toBeHidden()
        await expect(page.locator('.topnav__links')).toBeVisible()
      } else {
        // Narrow: the toggle opens the drawer, which is closed by default.
        const toggle = page.locator('.topnav__toggle')
        await expect(toggle).toBeVisible()
        await expect(page.locator('.topnav__links')).toBeHidden()
        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
        await expect(page.locator('.topnav__links')).toBeVisible()
      }
    })

    test('list table switches to a card layout only on narrow viewports', async ({ page }) => {
      await page.goto('/opportunities')
      const header = page.locator('thead th').first()
      const firstCell = page.locator('tbody tr').first().locator('td').first()

      if (vp.width < 820) {
        await expect(header, 'column headers collapse to labels').toBeHidden()
        // Each cell carries its column name for the stacked layout.
        await expect(firstCell).toHaveAttribute('data-label', /Grant/)
        const box = await firstCell.boundingBox()
        expect(box!.width, 'cells use the full width when stacked').toBeGreaterThan(vp.width * 0.6)
      } else {
        await expect(header, 'column headers stay visible').toBeVisible()
        const rows = await page.locator('tbody tr').count()
        expect(rows).toBe(4)
      }
    })

    test('search input is usable and its label is bound', async ({ page }) => {
      await page.goto('/opportunities')
      const search = page.getByRole('searchbox', { name: 'Search Grants' })
      await expect(search).toBeVisible()

      const box = await search.boundingBox()
      // Comfortable tap target on touch widths, and never overflowing.
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width)
      if (vp.width < 820) {
        expect(box!.height, 'search stays tappable on mobile').toBeGreaterThanOrEqual(36)
        expect(box!.width, 'search uses available width on mobile').toBeGreaterThan(vp.width * 0.5)
      }

      await search.fill('India')
      const filtered = await page.locator('tbody tr').count()
      expect(filtered).toBeGreaterThan(0)
    })

    test('detail fields and relationship panels stay readable', async ({ page }) => {
      for (const route of DETAIL_ROUTES) {
        await page.goto(route.path)
        const rows = await page.locator('dl.fields').first().locator('.fields__row').count()
        expect(rows, `${route.path} field rows`).toBe(route.fields)

        // Field labels must not be squeezed to an unusable width.
        const key = await page.locator('dl.fields').first().locator('.fields__key').first().boundingBox()
        expect(key!.width, `${route.path} label width`).toBeGreaterThan(80)
        expect(key!.height, `${route.path} label not clipped`).toBeGreaterThan(10)

        // Long values wrap instead of forcing a scrollbar.
        const overflowing = await page.evaluate(() => {
          let bad = 0
          for (const el of Array.from(document.querySelectorAll('.fields__value'))) {
            if (el.scrollWidth > el.clientWidth + 1) bad++
          }
          return bad
        })
        expect(overflowing, `${route.path} values wrap`).toBe(0)
      }
    })

    test('relationship panels remain usable', async ({ page }) => {
      await page.goto('/opportunities/OPP-001')
      const groups = page.locator('.related__group')
      await expect(groups).toHaveCount(4)

      for (let i = 0; i < (await groups.count()); i++) {
        const g = groups.nth(i)
        const label = await g.locator('.related__label').innerText()
        expect(label.trim().length, 'each group is labelled').toBeGreaterThan(0)
        // The count is visible, not only available to screen readers.
        await expect(g.locator('.related__count')).toBeVisible()
      }

      // Links inside a group are reachable and correctly targeted.
      await expect(groups.nth(0).getByRole('link')).toHaveAttribute('href', '/organizations/ORG-001')
    })

    test(`screenshots at ${vp.name}`, async ({ page }) => {
      for (const route of SHOT_ROUTES) {
        await page.goto(route.path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        if (route.name.endsWith('-search')) {
          await page.getByRole('searchbox').fill('water')
        }
        await page.waitForTimeout(120)
        await page.screenshot({
          path: `${SHOTS}/${vp.name}--${route.name}.png`,
          fullPage: true,
        })
      }
    })
  })
}

test('text stays readable at 200% zoom without horizontal scrolling', async ({ page }) => {
  // 1440 CSS px at 200% is effectively a 720px-wide viewport.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/opportunities/OPP-001')

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px' // 200% of the 16px base
  })

  expect(await hasHorizontalOverflow(page), 'no overflow at 200% text size').toBe(false)

  const key = await page.locator('.fields__key').first().boundingBox()
  expect(key!.height, 'labels grow with text rather than being clipped').toBeGreaterThan(24)
})
