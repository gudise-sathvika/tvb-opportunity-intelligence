import { expect, type Page } from '@playwright/test'

/** Every list route, with the h1 it must render and its expected row count.
 *
 * `rows` is the number of rendered table rows on the page. Collections that
 * hold no records in the production snapshot render the app's empty state
 * instead of a table, so their row count is 0.
 *
 * `linkable` is true only when the list's rows navigate to detail pages.
 * Companies is a name-only directory: its rows carry no detail links.
 */
export const LIST_ROUTES = [
  // Funding and Procurement are the hubs; their collection tables are titled
  // Grants and RFB, but the page heading is the hub name.
  { path: '/opportunities', h1: 'Funding', rows: 4, linkable: true },
  // The Companies page is the name directory: five names per page. The rows
  // are names only and resolve to no Company detail page.
  { path: '/companies', h1: 'Companies', rows: 5, linkable: false },
  // Matches, Applications, Notices, Bids and Contracts hold no records in the
  // production snapshot; each list renders the empty state.
  { path: '/matches', h1: 'Matches', rows: 0, linkable: false },
  { path: '/applications', h1: 'Applications', rows: 0, linkable: false },
  { path: '/organizations', h1: 'Organizations', rows: 4, linkable: true },
  { path: '/sources', h1: 'Sources', rows: 6, linkable: true },
  { path: '/notices', h1: 'Procurement', rows: 0, linkable: false },
  { path: '/bids', h1: 'Bids', rows: 0, linkable: false },
  { path: '/contracts', h1: 'Contracts', rows: 0, linkable: false },
] as const

/**
 * One representative detail route per record type present in the production
 * snapshot, with its rendered field count. Fictional record types have no
 * records here; their not-found handling is asserted in routes.spec.ts.
 */
export const DETAIL_ROUTES = [
  { path: '/opportunities/OPP-001', id: 'OPP-001', type: 'Opportunity', fields: 30 },
  { path: '/organizations/ORG-001', id: 'ORG-001', type: 'Organization', fields: 7 },
  { path: '/sources/SRC-001', id: 'SRC-001', type: 'Source', fields: 8 },
] as const

export const VIEWPORTS = [
  { name: 'mobile-375', width: 375, height: 780 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
] as const

/**
 * Collects console errors/warnings and every network request that leaves the
 * page. Returned object is mutated live, so it can be asserted on after
 * navigation completes.
 */
export function watchPage(page: Page) {
  const consoleErrors: string[] = []
  const consoleWarnings: string[] = []
  const pageErrors: string[] = []
  const requests: { url: string; method: string; resourceType: string }[] = []
  const failedRequests: { url: string; error: string }[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
    if (msg.type() === 'warning') consoleWarnings.push(msg.text())
  })
  page.on('pageerror', (err) => pageErrors.push(err.message))
  page.on('request', (req) => {
    requests.push({ url: req.url(), method: req.method(), resourceType: req.resourceType() })
  })
  page.on('requestfailed', (req) => {
    failedRequests.push({ url: req.url(), error: req.failure()?.errorText ?? 'unknown' })
  })

  return { consoleErrors, consoleWarnings, pageErrors, requests, failedRequests }
}

/** The local preview origin. Anything else would be a third-party request. */
export const LOCAL_ORIGIN = 'http://localhost:4187'

/** Requests to anything not on the local preview origin. */
export function externalRequests(requests: { url: string }[]): string[] {
  return requests
    .map((r) => r.url)
    .filter((u) => !u.startsWith(LOCAL_ORIGIN) && !u.startsWith('data:') && !u.startsWith('blob:'))
}

/**
 * Assert the application chrome is present: the persistent top navigation.
 *
 * This replaces the old demo-notice precondition. There is no persistent demo
 * banner any more; the chrome every internal route must carry is the top bar.
 */
export async function expectAppChrome(page: Page) {
  const topnav = page.locator('header.topnav')
  await expect(topnav).toBeVisible()
  // There is never a sidebar as well.
  await expect(page.locator('.sidebar')).toHaveCount(0)
}

/** True when the document scrolls sideways at the current viewport. */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const de = document.documentElement
    return de.scrollWidth > de.clientWidth + 1
  })
}

/** Widest offending element, to make an overflow report actionable. */
export async function widestOverflowingElement(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 1
    let worst: { tag: string; cls: string; right: number } | null = null
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      if (r.right > limit) {
        if (!worst || r.right > worst.right) {
          worst = { tag: el.tagName.toLowerCase(), cls: el.className?.toString().slice(0, 60) ?? '', right: Math.round(r.right) }
        }
      }
    }
    return worst
  })
}
