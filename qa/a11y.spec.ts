import { expect, test } from '@playwright/test'
import { DETAIL_ROUTES, LIST_ROUTES, expectAppChrome } from './helpers'

/* ------------------------------------------------------------------ */
/* Landmarks and structure                                              */
/* ------------------------------------------------------------------ */

test('landmarks and heading hierarchy are correct on every page type', async ({ page }) => {
  for (const path of [
    ...LIST_ROUTES.map((r) => r.path),
    ...DETAIL_ROUTES.map((r) => r.path),
  ]) {
    await page.goto(path)

    await expect(page.locator('main#main-content'), `${path} main landmark`).toHaveCount(1)
    await expect(page.locator('nav[aria-label="Primary"]'), `${path} nav`).toHaveCount(1)
    await expect(page.locator('h1'), `${path} exactly one h1`).toHaveCount(1)

    // Heading levels never skip.
    const levels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => ({
        level: Number(h.tagName[1]),
        text: h.textContent?.trim().slice(0, 40) ?? '',
      })),
    )
    // The top navigation carries no headings of its own (its groups are disclosure
    // buttons and links), so the first heading in DOM order is the page's own h1.
    expect(levels[0].level, `${path} opens on the page h1`).toBe(1)
    for (let i = 1; i < levels.length; i++) {
      expect(
        levels[i].level - levels[i - 1].level,
        `${path} heading jump at "${levels[i].text}"`,
      ).toBeLessThanOrEqual(1)
    }
  }
})

test('the primary navigation exposes the workspace groups as disclosures', async ({ page }) => {
  // The top bar is the only navigation. Funding, Procurement, and More are
  // disclosure buttons over real menus of links, so a screen reader user
  // reaches every destination by name rather than by position.
  await page.goto('/funding')

  const nav = page.locator('nav[aria-label="Primary"]')
  await expect(nav).toBeVisible()

  const funding = nav.getByRole('button', { name: /Funding/ })
  await expect(funding).toHaveAttribute('aria-haspopup', 'true')
  await expect(funding).toHaveAttribute('aria-expanded', 'false')

  await funding.click()
  await expect(funding).toHaveAttribute('aria-expanded', 'true')
  await expect(nav.getByRole('menuitem', { name: /Opportunities/ })).toBeVisible()

  // Companies stays a plain link; supporting data sits behind More.
  await expect(nav.getByRole('link', { name: 'Companies' })).toBeVisible()
  const more = nav.getByRole('button', { name: /More/ })
  await more.click()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(nav.getByRole('menuitem', { name: /Sources/ })).toBeVisible()
})

test('there is never a secondary sidebar navigation', async ({ page }) => {
  await page.goto('/funding')
  await expect(page.locator('.sidebar')).toHaveCount(0)
})

test('skip link is the first tab stop and moves focus to main', async ({ page }) => {
  await page.goto('/opportunities')
  await page.keyboard.press('Tab')

  const skip = page.locator('.skip-link')
  await expect(skip).toBeFocused()
  // It must become visible once focused, not stay off-screen.
  const box = await skip.boundingBox()
  expect(box!.x, 'skip link is on-screen when focused').toBeGreaterThanOrEqual(0)

  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#main-content$/)
})

/* ------------------------------------------------------------------ */
/* Keyboard navigation                                                  */
/* ------------------------------------------------------------------ */

test('every interactive element is reachable by keyboard with visible focus', async ({ page }) => {
  await page.goto('/opportunities/OPP-001')

  const seen: string[] = []
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const style = getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? '').trim().slice(0, 40),
        href: el.getAttribute('href'),
        // A focus indicator: an outline, or a box/border change.
        outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
      }
    })
    if (!info) break
    seen.push(`${info.tag}:${info.text}`)
    expect(info.outline, `focus indicator visible on <${info.tag}> "${info.text}"`).toBe(true)
  }

  // The top navigation and in-content links are both reachable.
  expect(seen.some((s) => s.startsWith('a:Home')), 'top navigation reachable').toBe(true)
  expect(seen.length, 'tab order is not empty or a dead end').toBeGreaterThan(5)
})

test('the search field is labelled and reachable, and Enter does not navigate away', async ({ page }) => {
  await page.goto('/matches')
  const search = page.getByRole('searchbox', { name: 'Search Matches' })
  await search.focus()
  await expect(search).toBeFocused()

  const urlBefore = page.url()
  await search.press('Enter')
  await expect(page).toHaveURL(urlBefore)
  await expect(search).toBeFocused()
})

test('links and buttons have accessible names', async ({ page }) => {
  // A spread of list, detail, and workspace pages, so the check covers the
  // content regions that add their own links rather than only the chrome.
  for (const path of [
    '/opportunities',
    '/opportunities/OPP-001',
    '/matches/MATCH-002',
    '/funding',
    '/procurement',
  ]) {
    await page.goto(path)

    const unnamed = await page.evaluate(() => {
      const bad: string[] = []
      for (const el of Array.from(document.querySelectorAll('a[href], button'))) {
        const name = (
          el.getAttribute('aria-label') ??
          el.getAttribute('title') ??
          el.textContent ??
          ''
        ).trim()
        if (name.length === 0) bad.push(el.outerHTML.slice(0, 90))
      }
      return bad
    })
    expect(unnamed, `${path} interactive elements have names`).toEqual([])
  }
})

/* ------------------------------------------------------------------ */
/* Tables                                                               */
/* ------------------------------------------------------------------ */

test('tables use header cells, a caption, and a scope', async ({ page }) => {
  for (const route of LIST_ROUTES) {
    await page.goto(route.path)

    if (route.rows === 0) {
      // Collections the snapshot holds no records for render an explicit
      // empty state instead of a table, so there is no caption to require.
      await expect(page.locator('.empty'), `${route.path} empty state`).toBeVisible()
      continue
    }

    await expect(page.locator('table caption'), `${route.path} caption`).toHaveCount(1)
    const headers = page.locator('thead th')
    const count = await headers.count()
    expect(count, `${route.path} has column headers`).toBeGreaterThan(1)

    // Every header is a scope'd column header, not a bare th.
    for (let i = 0; i < count; i++) {
      await expect(headers.nth(i), `${route.path} header ${i} scope`).toHaveAttribute('scope', 'col')
    }

    // Cell count matches header count on every row.
    const mismatch = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'))
      const cols = document.querySelectorAll('thead th').length
      return rows.filter((r) => r.querySelectorAll('td').length !== cols).length
    })
    expect(mismatch, `${route.path} cell/header count`).toBe(0)
  }
})

/* ------------------------------------------------------------------ */
/* Contrast                                                             */
/* ------------------------------------------------------------------ */

/**
 * Collect leaf text nodes with their computed contrast ratio.
 *
 * Written as a helper rather than inline because the same measurement runs over
 * several routes, so a colour that only appears on one page type is still
 * measured somewhere.
 */
async function contrastSamples(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const parse = (c: string) => {
      const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1]
      // `color-mix()` computes to the modern `color(srgb r g b / a)` form, whose
      // channels are 0–1 floats rather than the 0–255 of rgb(). Without this the
      // background is read as near-black and every light-theme sample looks dark.
      const scale = c.includes('srgb') ? 255 : 1
      return { r: m[0] * scale, g: m[1] * scale, b: m[2] * scale, a: m.length > 3 ? m[3] : 1 }
    }
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    // Walk up for the first opaque background, since most text sits on a transparent
    // element inside a card.
    const effectiveBg = (el: Element): { r: number; g: number; b: number } => {
      let cur: Element | null = el
      while (cur) {
        const bg = parse(getComputedStyle(cur).backgroundColor)
        if (bg.a > 0.5) return bg
        cur = cur.parentElement
      }
      return { r: 255, g: 255, b: 255 }
    }

    const out: { sample: string; ratio: number; fontPx: number; bold: boolean }[] = []
    const nodes = Array.from(document.querySelectorAll('p, dd, dt, td, th, h1, h2, h3, a, span, li, code')).slice(0, 260)
    for (const el of nodes) {
      const text = (el.textContent ?? '').trim()
      // Only leaf-ish elements with their own visible text.
      if (!text || el.children.length > 0) continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      const st = getComputedStyle(el)
      if (st.visibility === 'hidden' || st.opacity === '0') continue
      const fg = parse(st.color)
      const bg = effectiveBg(el)
      const l1 = lum(fg)
      const l2 = lum(bg)
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      out.push({
        sample: text.slice(0, 34),
        ratio: Math.round(ratio * 100) / 100,
        fontPx: Math.round(parseFloat(st.fontSize)),
        bold: parseInt(st.fontWeight, 10) >= 700,
      })
    }
    return out
  })
}

test('body and key text meet WCAG AA contrast', async ({ page }) => {
  for (const path of ['/opportunities/OPP-001', '/procurement', '/companies']) {
    await page.goto(path)

    const results = await contrastSamples(page)
    expect(results.length, `${path} contrast samples found`).toBeGreaterThan(20)

    // AA: 4.5:1 for normal text, 3:1 for large text (>=18.66px bold or >=24px).
    const failures = results.filter((r) => {
      const large = r.fontPx >= 24 || (r.bold && r.fontPx >= 18.66)
      return r.ratio < (large ? 3 : 4.5)
    })

    expect(
      failures.map((f) => `${path}: "${f.sample}" ${f.ratio}:1 @${f.fontPx}px`),
      `${path} low contrast`,
    ).toEqual([])
  }
})

/* ------------------------------------------------------------------ */
/* Chrome, blank values, empty relationships                            */
/* ------------------------------------------------------------------ */

test('the top navigation is present and not clipped on every route', async ({ page }) => {
  for (const path of [
    ...LIST_ROUTES.map((r) => r.path),
    ...DETAIL_ROUTES.map((r) => r.path),
  ]) {
    await page.goto(path)
    await expectAppChrome(page)
    const clipped = await page.locator('.topnav').evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(clipped, `${path} top nav not clipped`).toBe(false)
  }
})

test('no demo prototype notice is rendered anywhere', async ({ page }) => {
  await page.goto('/funding')
  await expect(page.locator('.demo-notice')).toHaveCount(0)
  await expect(page.getByText('DEMO PROTOTYPE', { exact: false })).toHaveCount(0)
})

test('blank values and absent relationships are distinguished in the UI', async ({ page }) => {
  // OPP-001 leaves several optional fields deliberately blank in the snapshot.
  // A blank here renders as "(blank)" while an empty list renders "(empty
  // list)", so the assertion targets the blank marker rather than position.
  await page.goto('/opportunities/OPP-001')
  const blanks = page.locator('.value--blank')
  await expect(blanks.first()).toBeVisible()
  await expect(blanks.filter({ hasText: '(blank)' })).not.toHaveCount(0)

  // OPP-001 has no application, stated rather than hidden.
  await page.goto('/opportunities/OPP-001')
  const noApps = page.locator('.related__group', { hasText: 'Applications' })
  await expect(noApps).toContainText('No applications recorded')
  await expect(noApps.locator('.related__count')).toContainText('(0)')

  // A record with no matches says so.
  await page.goto('/opportunities/OPP-003')
  await expect(page.locator('.related__group', { hasText: 'Matches' })).toContainText('No matches recorded')
})

test('page zoom to 400% keeps content reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/opportunities')
  // 400% zoom at a 1280px window behaves like a 320px CSS viewport.
  await page.setViewportSize({ width: 320, height: 800 })
  await expect(page.locator('tbody tr')).toHaveCount(4)
  const scrollable = await page.evaluate(() => {
    const de = document.documentElement
    return de.scrollWidth <= de.clientWidth + 1
  })
  expect(scrollable, 'content reachable at 400% zoom without sideways scrolling').toBe(true)
})
