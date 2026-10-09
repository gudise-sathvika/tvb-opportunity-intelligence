import { expect, test, type Page, type Route } from '@playwright/test'
import { externalRequests, watchPage } from './helpers'
import { TED_SEARCH_RESPONSE_RECORDING } from '../src/automation/ted-fixture'

/**
 * Phase 4: the Discovery panel's live TED search, exercised fully offline.
 *
 * The browser only ever talks to the same-origin bridge (`/__tvb/ted/search`);
 * these tests intercept THAT browser request with `page.route` and answer a
 * byte-for-byte recorded TED response. Because the interception happens before
 * the request reaches the preview server, the server-side handler never runs —
 * so no real source is contacted and every assertion stays deterministic.
 * The page content still flows through the REAL adapter, the REAL Phase D
 * orchestrator, and the REAL Phase E review handoff.
 */

const BRIDGE_PATH = '**/__tvb/ted/search'

/** A valid TED response that matched nothing (distinct from a failure). */
const EMPTY_TED_RESPONSE = JSON.stringify({ notices: [], totalNoticeCount: 0, iterationNextToken: null, timedOut: false })

async function selectCompanyRows(page: Page, count: number) {
  const checkboxes = page.locator('.dg-company__check')
  for (let index = 0; index < count; index += 1) {
    await checkboxes.nth(index).check()
  }
  const label = count === 1 ? 'company' : 'companies'
  await expect(page.locator('.dg-count')).toContainText(`${count} ${label} selected`)
}

/** The summary cell whose label matches, scoped like the review stats. */
function summaryCell(page: Page, label: string) {
  return page.locator('.stat', { hasText: label }).locator('.stat__count')
}

async function routeBridgeRecording(page: Page, payloads: string[]) {
  await page.route(BRIDGE_PATH, async (route: Route) => {
    payloads.push(route.request().postData() ?? '')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 200, body: TED_SEARCH_RESPONSE_RECORDING }),
    })
  })
}

async function runLiveSearch(page: Page, options: { companies?: number; keyword?: string } = {}) {
  const keyword = options.keyword ?? 'solar energy'
  if (keyword !== '') {
    await page.getByLabel('Keyword').fill(keyword)
  }
  await selectCompanyRows(page, options.companies ?? 3)
  await page.getByRole('button', { name: 'Run Live TED Search' }).click()
  await expect(page.locator('.dg-results')).toBeVisible()
}

test('a live TED run with the bridge intercepted shows the real notices through the real pipeline', async ({ page }) => {
  const w = watchPage(page)
  const payloads: string[] = []
  await page.goto('/discovery')
  await routeBridgeRecording(page, payloads)
  await runLiveSearch(page)

  await expect(summaryCell(page, 'Companies processed')).toHaveText('3')
  await expect(summaryCell(page, 'Domain')).toHaveText('RFP')
  await expect(summaryCell(page, 'Sources attempted')).toHaveText('3')
  await expect(summaryCell(page, 'Candidates found')).toHaveText('9')
  await expect(summaryCell(page, 'Candidates requiring review')).toHaveText('9')
  await expect(summaryCell(page, 'Duplicates')).toHaveText('0')
  await expect(summaryCell(page, 'Blocked sources')).toHaveText('0')
  await expect(summaryCell(page, 'Failed sources')).toHaveText('0')
  await expect(summaryCell(page, 'Overall outcome')).toHaveText('Completed')
  // The results note is honest about the source for live runs.
  await expect(page.getByText('This run queried the real TED source.')).toBeVisible()

  await expect(page.locator('.dg-result')).toHaveCount(3)
  for (const row of await page.locator('.dg-result').all()) {
    await expect(row.locator('.dg-result__summary .dg-chip')).toHaveText('Completed')
    await expect(row.locator('.dg-result__counts')).toContainText('Candidates: 3')
    await expect(row.locator('.dg-result__counts')).toContainText('Needs review: 3')
  }

  // The real source identity and kind are shown, not a fixture.
  await expect(page.locator('.dg-source', { hasText: 'SU-TED-001' })).toHaveCount(3)
  await expect(page.locator('.dg-source', { hasText: 'Tenders Electronic Daily' })).toHaveCount(3)
  await expect(page.locator('.dg-chip--source-real', { hasText: 'Real source' })).not.toHaveCount(0)
  // The three real notices are listed as candidates, per company.
  await expect(page.getByText('Poland – Solar energy', { exact: false })).not.toHaveCount(0)
  await expect(page.locator('.dg-results').getByText(/Solar energy/i)).toHaveCount(9)

  // Exactly three same-origin bridge calls, each carrying the run and keyword.
  expect(payloads.length, 'one bridge call per company').toBe(3)
  for (const payload of payloads) {
    const parsed = JSON.parse(payload) as { runId: string; keyword: string; requestedAt: string }
    expect(parsed.runId).toBe('RUN-T-0001')
    expect(parsed.keyword).toBe('solar energy')
    expect(typeof parsed.requestedAt).toBe('string')
  }

  // Run history records the live run with the real outcome counts.
  await expect(page.locator('.dg-history__run')).toHaveCount(1)
  await expect(page.locator('.dg-history__run').first()).toContainText('RUN-T-0001')
  await expect(page.locator('.dg-history__run').first()).toContainText('RFPs')
  await expect(page.locator('.dg-history__run').first()).toContainText('3 companies')
  await expect(page.locator('.dg-history__run').first()).toContainText('9 candidates')
  await expect(page.locator('.dg-history__run').first()).toContainText('Completed')

  // No console/page errors and NOTHING ever left the local preview origin.
  expect(w.pageErrors, 'no uncaught page errors').toEqual([])
  expect(w.consoleErrors, 'no console errors').toEqual([])
  expect(w.failedRequests, 'no failed requests').toEqual([])
  expect(externalRequests(w.requests), 'no external requests — the bridge kept everything same-origin').toEqual([])
})

test('a live run hands the TED candidates into the Human review queue', async ({ page }) => {
  const payloads: string[] = []
  await page.goto('/discovery')
  await routeBridgeRecording(page, payloads)
  await runLiveSearch(page)

  await page.getByRole('link', { name: 'Review 9 candidates' }).click()
  await expect(page).toHaveURL(/\/review$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Human review')

  // The four seeded demo review items plus nine live TED findings (two Polish
  // notices per company, one Latvian per company).
  await expect(page.locator('tbody tr')).toHaveCount(13)
  await expect(page.locator('tbody tr', { hasText: 'Poland – Solar energy', exact: false })).toHaveCount(6)
  await expect(page.locator('tbody tr', { hasText: 'Latvia – Solar energy', exact: false })).toHaveCount(3)
})

test('the panel explains the live search term before running (blank vs entered keyword)', async ({ page }) => {
  await page.goto('/discovery')

  // Blank keyword: the panel says Live TED uses the company name while Live
  // Funding runs a broad posted search, and is honest that TED matches tender
  // titles only.
  const scope = page.locator('.dg-scope-note')
  await expect(scope).toContainText('Live TED uses each company’s own name as its search term')
  await expect(scope).toContainText('broad search of posted opportunities')
  await expect(scope).toContainText('matches tender titles only')
  await expect(scope).toContainText('not buyer names, supplier names, or every tender field')
  await expect(page.locator('#dg-keyword-hint')).toContainText('Leave it blank and Live TED searches each company')

  // Entering a keyword changes the search term for every selected company.
  await page.getByLabel('Keyword').fill('solar energy')
  await expect(scope).toContainText('“solar energy” is used as the search term for every selected company')
  await expect(scope).not.toContainText('as its search term')
})

test('a successful empty TED response is Completed (no results), distinct from a failed request', async ({ page }) => {
  const w = watchPage(page)
  await page.goto('/discovery')
  await page.route(BRIDGE_PATH, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 200, body: EMPTY_TED_RESPONSE }),
    })
  })

  await runLiveSearch(page, { companies: 1, keyword: '' })

  // A completed empty search is not a failure and not proof of no opportunities.
  await expect(summaryCell(page, 'Overall outcome')).toHaveText('Completed (no results)')
  await expect(summaryCell(page, 'Candidates found')).toHaveText('0')
  await expect(summaryCell(page, 'Failed sources')).toHaveText('0')
  await expect(page.locator('.dg-result .dg-empty')).toContainText('Search completed with no matching results')
  await expect(page.locator('.dg-result .dg-empty')).toContainText('does not prove no opportunities exist')
  await expect(page.getByRole('link', { name: /Review \d candidates/ })).toHaveCount(0)

  expect(w.pageErrors, 'no uncaught page errors').toEqual([])
  expect(externalRequests(w.requests), 'no external requests').toEqual([])
})

test('a bridge failure is a failed run with no candidates and no review handoff', async ({ page }) => {
  const w = watchPage(page)
  await page.goto('/discovery')
  await page.route(BRIDGE_PATH, async (route: Route) => {
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        status: 502,
        body: null,
        errors: [{ code: 'source_failure', message: 'live TED search failed: source unreachable' }],
      }),
    })
  })

  await runLiveSearch(page, { companies: 1 })
  await expect(summaryCell(page, 'Overall outcome')).toHaveText('Failed')
  await expect(summaryCell(page, 'Candidates found')).toHaveText('0')
  await expect(summaryCell(page, 'Failed sources')).toHaveText('1')
  await expect(page.locator('.dg-result').first().locator('.dg-result__summary .dg-chip')).toHaveText('Failed')
  await expect(page.getByRole('link', { name: /Review \d candidates/ })).toHaveCount(0)
  await expect(page.locator('.dg-agent__errors').first()).toContainText('source unreachable')
  // A failed request is explicitly NOT reported as an empty result.
  await expect(page.locator('.dg-result .dg-empty').first()).toContainText('The source request failed')
  await expect(page.locator('.dg-result .dg-empty').first()).not.toContainText('Search completed with no matching results')

  expect(externalRequests(w.requests), 'no external requests').toEqual([])
})