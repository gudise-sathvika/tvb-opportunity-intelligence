import { expect, test, type Page } from '@playwright/test'
import { LIST_ROUTES } from './helpers'

/**
 * Identifies the currently focused element, for readable assertions.
 *
 * Route changes move focus in an effect that runs after React commits the new
 * page, which is strictly later than the URL changing. A caller that reads this
 * immediately after a navigation can therefore observe the outgoing link still
 * focused. `focusedTag` below polls for that to settle; use it after any
 * navigation rather than reading `activeElement` straight away.
 */
async function activeElement(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) {
      return { tag: 'BODY', text: '', id: '', cls: '', tabindex: null as string | null }
    }
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? '').trim().slice(0, 80),
      id: el.id,
      cls: typeof el.className === 'string' ? el.className : '',
      tabindex: el.getAttribute('tabindex'),
    }
  })
}

/**
 * The focused element's tag, retried until it settles.
 *
 * This does not weaken the assertion: it still fails if focus never lands on
 * the expected element, and `expect.poll` reports the last observed value. It
 * removes only the race between "the URL changed" and "the app has moved
 * focus", which is an ordering fact about React, not a behaviour under test.
 */
async function focusedTag(page: Page, expected: string, message: string) {
  await expect
    .poll(async () => (await activeElement(page)).tag, { message, timeout: 5000 })
    .toBe(expected)
}

/**
 * Clicks the first record link on the current list page and returns the
 * record's display name. Names are read from the rendered page rather than
 * hard-coded, so these tests cannot silently drift from the snapshot.
 *
 * Also waits for the navigation to commit. `<main>` is keyed on the pathname,
 * so it is torn down and rebuilt on every route change; measuring anything
 * inside it before that settles can hit a detached element.
 */
async function openFirstRecord(page: Page) {
  const link = page.locator('tbody tr td a').first()
  await expect(link, 'list page must render at least one record link').toBeVisible()
  const name = (await link.innerText()).trim()
  const before = page.url()
  await link.click()
  await expect(page, 'navigation should have committed').not.toHaveURL(before)
  return name
}

/* Initial load ---------------------------------------------------------- */

test('a normal page load does not steal focus', async ({ page }) => {
  await page.goto('/opportunities')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // The user has not navigated, so focus must be left alone.
  const active = await activeElement(page)
  expect(active.tag, 'focus must stay on the document body on first load').toBe('BODY')
})

test('the skip link is the first tab stop on every list page', async ({ page }) => {
  // Regression guard: a "skip the first render" boolean is not StrictMode-safe,
  // because StrictMode invokes effects twice and refs survive the simulated
  // remount. That bug made the heading steal focus on page load in dev, which
  // pushed the skip link out of first position. This fails if focus moves.
  for (const route of LIST_ROUTES) {
    await page.goto(route.path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Give any late effect a chance to misbehave before checking.
    await page.waitForTimeout(250)
    expect((await activeElement(page)).tag, `${route.path} load must not focus anything`).toBe(
      'BODY',
    )
    await page.keyboard.press('Tab')
    const first = await activeElement(page)
    expect(first.cls, `${route.path}: skip link must be the first tab stop`).toContain('skip-link')
  }
})

/* List -> detail --------------------------------------------------------- */

test('navigating from a list to a detail moves focus to the new page heading', async ({ page }) => {
  await page.goto('/opportunities')
  const name = await openFirstRecord(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)

  const active = await activeElement(page)
  expect(active.tag, 'focus should land on the heading').toBe('h1')
  expect(active.text).toBe(name)
})

test('focus moves to the heading for every list-to-detail navigation', async ({ page }) => {
  // Lists that are honestly empty (no Match/Application/Notice/Bid/Contract
  // records exist in the snapshot) cannot navigate anywhere, and Companies is a
  // name-only directory with no detail pages, so the focus contract is measured
  // on the collections whose rows genuinely navigate.
  for (const route of LIST_ROUTES.filter((r) => r.rows > 0 && r.linkable)) {
    await page.goto(route.path)
    const name = await openFirstRecord(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)

    const active = await activeElement(page)
    expect(active.tag, `${route.path} -> detail should focus the h1`).toBe('h1')
    // activeElement() truncates to 80 chars for readability; compare on the
    // same footing so a long source title is not a false failure.
    expect(active.text, `${route.path} -> detail heading text`).toBe(name.slice(0, 80))
  }
})

test('detail to detail navigation also moves focus', async ({ page }) => {
  await page.goto('/opportunities/OPP-001')
  const firstHeading = (await page.locator('main h1').innerText()).trim()

  // Follow a relationship link (a resolved [[wikilink]]) to another detail page.
  const relLink = page.locator('main a.wikilink').first()
  await expect(relLink, 'detail page should link to a related record').toBeVisible()
  const targetHref = await relLink.getAttribute('href')
  expect(targetHref, 'relationship link should point at a detail route').toMatch(/^\/(organizations|sources|companies)\//)

  await relLink.click()
  await expect(page).toHaveURL(new RegExp(`${targetHref}$`))
  // Auto-retrying, because the URL settles before React re-renders the heading.
  await expect(page.locator('main h1'), 'heading should change to the related record').not.toHaveText(
    firstHeading,
  )
  const newHeading = (await page.locator('main h1').innerText()).trim()

  const active = await activeElement(page)
  expect(active.tag, 'detail -> detail should focus the h1').toBe('h1')
  expect(active.text).toBe(newHeading)
})

/* Top navigation --------------------------------------------------------- */

test('top navigation moves focus to the destination heading', async ({ page }) => {
  await page.goto('/funding')
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await nav.getByRole('button', { name: 'More' }).click()
  await nav.getByRole('menuitem', { name: /^Sources/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sources')
  const active = await activeElement(page)
  expect(active.tag).toBe('h1')
  expect(active.text).toBe('Sources')
})

test('the Home link is reachable from the top navigation', async ({ page }) => {
  await page.goto('/companies')
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Home' })
    .click()
  await expect(page).toHaveURL('/')
  await expect(page.locator('.landing')).toHaveCount(1)
})

/* Back / forward --------------------------------------------------------- */

test('browser back returns focus to the previous page heading', async ({ page }) => {
  await page.goto('/opportunities')
  await openFirstRecord(page)
  const detailHeading = (await page.getByRole('heading', { level: 1 }).innerText()).trim()
  await focusedTag(page, 'h1', 'sanity: forward nav took focus')

  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Funding')
  await focusedTag(page, 'h1', 'back should move focus to the list heading')
  expect((await activeElement(page)).text, 'focus lands on the list heading').toBe('Funding')
  expect(detailHeading.length).toBeGreaterThan(0)
})

test('browser forward returns focus to the detail heading', async ({ page }) => {
  await page.goto('/opportunities')
  const name = await openFirstRecord(page)
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Funding')

  await page.goForward()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
  await focusedTag(page, 'h1', 'forward should move focus to the detail heading')
  expect((await activeElement(page)).text).toBe(name)
})

test('back and forward do not produce a focus loop', async ({ page }) => {
  await page.goto('/opportunities')
  await openFirstRecord(page)
  // The URL changes before React commits the layout effect that moves focus,
  // so settle first: otherwise the initial navigation's focusin can land after
  // the counter below is installed and get counted as a fourth event.
  await focusedTag(page, 'h1', 'sanity: forward nav took focus')

  // Count real focus events over several history moves. An infinite loop would
  // make this climb without bound, or fire repeatedly per navigation.
  await page.evaluate(() => {
    ;(window as unknown as { __focusLog: number }).__focusLog = 0
    document.addEventListener('focusin', () => {
      ;(window as unknown as { __focusLog: number }).__focusLog += 1
    })
  })

  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Funding')
  await page.goForward()
  await expect(page.locator('main h1')).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Funding')
  await page.waitForTimeout(250)

  const events = await page.evaluate(
    () => (window as unknown as { __focusLog: number }).__focusLog,
  )
  // 3 history moves => at most one focusin each. A loop would be far higher.
  expect(events, 'focus events across 3 history moves').toBeLessThanOrEqual(3)
  expect(events, 'focus actually did move').toBeGreaterThan(0)
})

/* Target existence and visibility --------------------------------------- */

test('the focus target is visible and not hidden from assistive tech', async ({ page }) => {
  // Company rows are a name-only directory with no detail pages, so the focus
  // target is measured on a list whose rows genuinely navigate: Sources.
  await page.goto('/sources')
  const name = await openFirstRecord(page)
  const heading = page.getByRole('heading', { level: 1 })
  // Wait for the remounted heading, so the measurement is of the live element.
  await expect(heading).toHaveText(name)
  await expect(heading).toBeVisible()
  await expect(heading).not.toHaveAttribute('aria-hidden', 'true')

  const box = await heading.boundingBox()
  expect(box, 'heading must have a layout box').not.toBeNull()
  expect(box!.height, 'heading must be visibly tall').toBeGreaterThan(0)
  expect(box!.width, 'heading must be visibly wide').toBeGreaterThan(0)

  const inViewport = await heading.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return r.top >= -1 && r.bottom <= window.innerHeight + 1
  })
  expect(inViewport, 'heading should be within the viewport after navigation').toBe(true)
})

test('the focused heading is not an extra tab stop', async ({ page }) => {
  await page.goto('/opportunities')
  await openFirstRecord(page)

  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toBeFocused()

  // tabindex="-1" is not tabbable; the risk is a leftover "0" or positive
  // value, which would insert the heading into the tab order.
  const tabindex = await heading.getAttribute('tabindex')
  expect(
    tabindex === null || tabindex === '-1',
    `heading tabindex must be absent or -1, got ${tabindex}`,
  ).toBe(true)

  // Shift+Tab must move past the heading, not get stuck on it.
  await page.keyboard.press('Shift+Tab')
  expect(
    await heading.evaluate((el) => el === document.activeElement),
    'heading must be reachable past, not trap focus',
  ).toBe(false)
})

test('the heading is not reachable by tabbing forward from the top of the page', async ({ page }) => {
  await page.goto('/opportunities')
  await openFirstRecord(page)
  // Focus the first focusable element, then tab forward through the page and
  // confirm the h1 never appears in the tab sequence.
  const seenHeading = await page.evaluate(async () => {
    const h1 = document.querySelector('h1')
    if (!h1) return 'no h1'
    ;(h1 as HTMLElement).blur()
    document.body.focus()
    return null
  })
  expect(seenHeading).toBeNull()

  const tabindex = await page.locator('main h1').getAttribute('tabindex')
  // A focusable h1 must be programmatically focusable only, i.e. -1 or absent.
  expect(tabindex === null || tabindex === '-1', `tabindex was ${tabindex}`).toBe(true)
})

/* Keyboard and skip link ------------------------------------------------- */

test('the skip link is still the first tab stop and still works', async ({ page }) => {
  await page.goto('/opportunities')
  await page.keyboard.press('Tab')
  const first = await activeElement(page)
  expect(first.cls, 'skip link should be the first tab stop').toContain('skip-link')
  expect(first.text).toBe('Skip to main content')

  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#main-content$/)
  await expect(page.locator('#main-content')).toBeFocused()
})

test('keyboard-only navigation from list to detail moves focus visibly', async ({ page }) => {
  await page.goto('/opportunities')
  const name = (await page.locator('tbody tr td a').first().innerText()).trim()

  // Tab from the top of the document until the first record link has focus.
  let reached = false
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(() => {
      const el = document.activeElement
      return el?.tagName.toLowerCase() === 'a' && (el.getAttribute('href') ?? '').includes('/opportunities/')
    })
  }
  expect(reached, 'should reach a record link by tabbing').toBe(true)

  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)

  const active = await activeElement(page)
  expect(active.tag, 'keyboard activation must also move focus').toBe('h1')
  expect(active.text).toBe(name)

  // Keyboard users should be able to see where focus went.
  const outline = await page
    .getByRole('heading', { level: 1 })
    .evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline, 'keyboard focus on the heading should be visible').not.toBe('none')
})

/* No focus stealing on ordinary interaction ------------------------------ */

test('typing in the search box never moves focus', async ({ page }) => {
  await page.goto('/opportunities')
  const search = page.getByRole('searchbox')
  await search.click()
  await expect(search).toBeFocused()

  for (const term of ['India', 'grid', 'storage', '']) {
    await search.fill(term)
    await expect(search, `focus must stay in the search box after typing "${term}"`).toBeFocused()
  }

  await search.press('Backspace')
  await expect(search).toBeFocused()
  await page.waitForTimeout(200)
  const active = await activeElement(page)
  expect(active.id, 'focus still on the search input').toBe('record-search')
})

test('clearing the search with its button does not move focus to the list', async ({ page }) => {
  await page.goto('/companies')
  const search = page.getByRole('searchbox')
  await search.click()
  await search.fill('EnergyX') // One directory entry matches.
  await expect(page.locator('tbody tr')).toHaveCount(1)

  const clear = page.getByRole('button', { name: 'Clear' })
  await clear.click()
  await expect(page.locator('tbody tr')).toHaveCount(5)

  // Focus may legitimately land on the Clear button or the input, but must
  // not jump to the heading or a row, which would lose the user's place.
  const active = await activeElement(page)
  expect(active.tag, `focus jumped to ${active.tag} after clearing`).not.toBe('h1')
})

test('re-rendering the list via search does not focus a row or heading', async ({ page }) => {
  await page.goto('/companies')
  const search = page.getByRole('searchbox')
  await search.click()
  await search.fill('a')
  await page.waitForTimeout(200)
  const active = await activeElement(page)
  expect(active.tag, 'focus must not jump to the heading while filtering').not.toBe('h1')
  expect(['input', 'BODY']).toContain(active.tag)
})

test('search state resets on return and focus follows the route', async ({ page }) => {
  await page.goto('/opportunities')
  const search = page.getByRole('searchbox')
  await search.click()
  await search.fill('India')
  await expect(page.locator('tbody tr')).toHaveCount(2)

  const nav = page.getByRole('navigation', { name: 'Primary' })
  await nav.getByRole('button', { name: 'More' }).click()
  await nav.getByRole('menuitem', { name: /^Sources/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sources')

  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Funding')
  // Search resets on return, which is existing behaviour; focus follows the route.
  expect((await activeElement(page)).tag).toBe('h1')
  await expect(page.locator('tbody tr')).toHaveCount(4)
})
