import { expect, test, type Page, type Route } from '@playwright/test'
import { externalRequests, watchPage } from './helpers'

/**
 * Phase 20B: the Discovery panel's live Grants.gov funding-opportunity search,
 * exercised fully offline.
 *
 * The browser only ever talks to the same-origin bridge
 * (`/__tvb/grantsgov/search`); these tests intercept THAT browser request with
 * `page.route` and answer a Grants.gov `search2`-shaped body. The interception
 * happens before the request reaches the preview server, so the server-side
 * handler never runs and no real source is contacted — while the page still
 * flows through the REAL adapter, the REAL Phase D orchestrator, and the REAL
 * Phase E review handoff.
 *
 * Live funding runs must stay separate from fixture/scenario runs and the live
 * TED path; these tests assert that separation explicitly.
 */

const BRIDGE_PATH = '**/__tvb/grantsgov/search'

/** A valid Grants.gov response with THREE posted opportunities. */
const GRANTS_GOV_RESPONSE = JSON.stringify({
  errorcode: 0,
  msg: 'success',
  data: {
    hitCount: 3,
    oppHits: [
      {
        id: '1001',
        number: 'DOE-SOLAR-2026-A',
        title: 'SOLAR ENERGY RESEARCH AND DEMONSTRATION GRANT',
        agencyCode: 'DOE',
        agency: 'Department of Energy',
        openDate: '01/15/2026',
        closeDate: '04/30/2030',
        oppStatus: 'posted',
        docType: 'synopsis',
        cfdaList: ['81.087'],
      },
      {
        id: '1002',
        number: 'DOE-SOLAR-2026-B',
        title: 'SOLAR ENERGY WORKFORCE TRAINING OPPORTUNITY',
        agencyCode: 'DOE',
        agency: 'Department of Energy',
        openDate: '02/01/2026',
        closeDate: '05/15/2030',
        oppStatus: 'posted',
        docType: 'synopsis',
        cfdaList: ['81.087'],
      },
      {
        id: '1003',
        number: 'DOE-SOLAR-2026-C',
        title: 'SOLAR ENERGY STORAGE PILOT SOLICITATION',
        agencyCode: 'DOE',
        agency: 'Department of Energy',
        openDate: '03/01/2026',
        closeDate: '06/30/2030',
        oppStatus: 'forecasted',
        docType: 'forecast',
        cfdaList: ['81.087'],
      },
    ],
    errorMsgs: [],
  },
})

/** A valid Grants.gov response that matched nothing (distinct from a failure). */
const EMPTY_GRANTS_GOV_RESPONSE = JSON.stringify({
  errorcode: 0,
  msg: 'success',
  data: { hitCount: 0, oppHits: [], errorMsgs: [] },
})

async function selectCompanyRows(page: Page, count: number) {
  const checkboxes = page.locator('.dg-company__check')
  for (let index = 0; index < count; index += 1) {
    await checkboxes.nth(index).check()
  }
  const label = count === 1 ? 'company' : 'companies'
  await expect(page.locator('.dg-count')).toContainText(`${count} ${label} selected`)
}

function summaryCell(page: Page, label: string) {
  return page.locator('.stat', { hasText: label }).locator('.stat__count')
}

async function routeBridgeRecording(page: Page, payloads: string[]) {
  await page.route(BRIDGE_PATH, async (route: Route) => {
    payloads.push(route.request().postData() ?? '')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 200, body: GRANTS_GOV_RESPONSE }),
    })
  })
}

async function runLiveFundingSearch(page: Page, options: { companies?: number; keyword?: string } = {}) {
  const keyword = options.keyword ?? 'solar energy'
  if (keyword !== '') {
    await page.getByLabel('Keyword').fill(keyword)
  }
  await selectCompanyRows(page, options.companies ?? 3)
  await page.getByRole('button', { name: 'Run Live Funding Search' }).click()
  await expect(page.locator('.dg-results')).toBeVisible()
}

test('the live funding button exists separately from the scenario and TED controls', async ({ page }) => {
  await page.goto('/discovery')
  await expect(page.getByRole('button', { name: 'Run Live Funding Search' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run Live TED Search' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run Grant Discovery' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run RFP Discovery' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Standard' })).toBeVisible()
})

test('a live funding run queries Grants.gov through the real pipeline and never claims open/eligible', async ({ page }) => {
  const w = watchPage(page)
  const payloads: string[] = []
  await page.goto('/discovery')
  await routeBridgeRecording(page, payloads)
  await runLiveFundingSearch(page)

  await expect(summaryCell(page, 'Companies processed')).toHaveText('3')
  await expect(summaryCell(page, 'Domain')).toHaveText('Grants')
  await expect(summaryCell(page, 'Sources attempted')).toHaveText('3')
  await expect(summaryCell(page, 'Duplicates')).toHaveText('0')
  await expect(summaryCell(page, 'Blocked sources')).toHaveText('0')
  await expect(summaryCell(page, 'Failed sources')).toHaveText('0')
  await expect(summaryCell(page, 'Overall outcome')).toHaveText('Completed')

  // Truthful provenance: the real Grants.gov source is named, and records are
  // only labelled Open (confirmed) through the open-opportunity gate.
  await expect(page.locator('.dg-banner', { hasText: 'US federal grant opportunities' })).toBeVisible()
  await expect(page.locator('.dg-banner', { hasText: 'open-opportunity gate passes' })).toBeVisible()
  await expect(page.getByText('This run queried the real Grants.gov source')).toBeVisible()
  await expect(page.locator('.dg-source', { hasText: 'SU-GRANTS-001' })).toHaveCount(3)
  await expect(page.locator('.dg-source', { hasText: 'Grants.gov' })).toHaveCount(3)
  await expect(page.locator('.dg-chip--source-real', { hasText: 'Real source' })).not.toHaveCount(0)

  await expect(page.locator('.dg-result')).toHaveCount(3)
  for (const row of await page.locator('.dg-result').all()) {
    await expect(row.locator('.dg-result__summary .dg-chip')).toHaveText('Completed')
    await expect(row.locator('.dg-result__counts')).toContainText('Candidates: 3')
    // Phase 20C gate counts: 2 posted/future pass, 1 forecasted is excluded.
    await expect(row.locator('.dg-result__counts')).toContainText('Retrieved: 3')
    await expect(row.locator('.dg-result__counts')).toContainText('Open (passed gate): 2')
    await expect(row.locator('.dg-result__counts')).toContainText('Excluded: 1')
  }

  // Real opportunity detail: title, agency, status, close date, official link, verdict.
  await expect(page.locator('.dg-candidate')).toHaveCount(9)
  await expect(page.locator('.dg-candidate', { hasText: 'Open (confirmed)' })).toHaveCount(6)
  await expect(page.locator('.dg-candidate', { hasText: 'Excluded:' })).toHaveCount(3)
  await expect(page.locator('.dg-candidate__meta').first()).toContainText('Department of Energy')
  const officialLink = page.locator('.dg-candidate__link').first()
  await expect(officialLink).toHaveAttribute('href', /\/search-results-detail\/\d+/)

  // Phase 20D: ONE same-origin Grants.gov bridge call for the whole run (the
  // query is identical for every selected company), carrying the run, keyword,
  // and the posted-only status filter. The pool is shared, not company-matched.
  await expect(page.getByText('is searched ONCE for the run', { exact: false })).toBeVisible()
  await expect(page.getByText('not company-matched', { exact: false })).toBeVisible()
  expect(payloads.length, 'one bridge call for the whole run').toBe(1)
  const parsed = JSON.parse(payloads[0]) as {
    runId: string
    keyword: string
    oppStatuses: string
    companyId: string
    requestedAt: string
  }
  expect(parsed.runId).toBe('RUN-G-0001')
  expect(parsed.keyword).toBe('solar energy')
  expect(parsed.oppStatuses).toBe('posted')
  expect(parsed.companyId).toBe('RUN')
  expect(typeof parsed.requestedAt).toBe('string')

  // Run history records the live funding run distinctly.
  await expect(page.locator('.dg-history__run')).toHaveCount(1)
  await expect(page.locator('.dg-history__run').first()).toContainText('RUN-G-0001')
  await expect(page.locator('.dg-history__run').first()).toContainText('Grants')
  await expect(page.locator('.dg-history__run').first()).toContainText('3 companies')
  await expect(page.locator('.dg-history__run').first()).toContainText('Completed')

  // The live funding path never falls back to USAspending.
  await expect(page.getByText('USAspending', { exact: false })).toHaveCount(0)

  expect(w.pageErrors, 'no uncaught page errors').toEqual([])
  expect(w.consoleErrors, 'no console errors').toEqual([])
  expect(w.failedRequests, 'no failed requests').toEqual([])
  expect(externalRequests(w.requests), 'no external requests — the bridge kept everything same-origin').toEqual([])
})

test('a successful empty Grants.gov response is Completed (no results), not a failure', async ({ page }) => {
  const w = watchPage(page)
  const payloads: string[] = []
  await page.goto('/discovery')
  await page.route(BRIDGE_PATH, async (route: Route) => {
    payloads.push(route.request().postData() ?? '')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 200, body: EMPTY_GRANTS_GOV_RESPONSE }),
    })
  })

  await runLiveFundingSearch(page, { companies: 1, keyword: '' })

  await expect(summaryCell(page, 'Overall outcome')).toHaveText('Completed (no results)')
  await expect(summaryCell(page, 'Candidates found')).toHaveText('0')
  await expect(summaryCell(page, 'Failed sources')).toHaveText('0')
  await expect(page.locator('.dg-result .dg-empty')).toContainText('Search completed with no matching results')
  // A blank keyword is a broad posted search, not a company-name substitution.
  const parsed = JSON.parse(payloads[0]) as { keyword: string; oppStatuses: string }
  expect(parsed.keyword).toBe('')
  expect(parsed.oppStatuses).toBe('posted')

  expect(w.pageErrors, 'no uncaught page errors').toEqual([])
  expect(externalRequests(w.requests), 'no external requests').toEqual([])
})

test('a bridge failure is a failed live funding run with no candidates and no review handoff', async ({ page }) => {
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
        errors: [{ code: 'source_failure', message: 'live Grants.gov search failed: source unreachable' }],
      }),
    })
  })

  await runLiveFundingSearch(page, { companies: 1 })
  await expect(summaryCell(page, 'Overall outcome')).toHaveText('Failed')
  await expect(summaryCell(page, 'Candidates found')).toHaveText('0')
  await expect(summaryCell(page, 'Failed sources')).toHaveText('1')
  await expect(page.locator('.dg-result').first().locator('.dg-result__summary .dg-chip')).toHaveText('Failed')
  await expect(page.getByRole('link', { name: /Review \d candidates/ })).toHaveCount(0)
  await expect(page.locator('.dg-agent__errors').first()).toContainText('source unreachable')

  expect(externalRequests(w.requests), 'no external requests').toEqual([])
})
