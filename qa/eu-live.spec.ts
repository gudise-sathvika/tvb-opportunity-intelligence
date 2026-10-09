import { expect, test, type Page, type Route } from '@playwright/test'
import { externalRequests, watchPage } from './helpers'

/**
 * Phase 21C: the Discovery panel's live EU Funding & Tenders Portal (SEDIA)
 * search, exercised fully offline.
 *
 * The browser only talks to the same-origin bridge (`/__tvb/eu/search`); these
 * tests intercept THAT browser request and answer a SEDIA-shaped body, so the
 * server-side handler never runs and no real source is contacted — while the
 * page still flows through the REAL EU adapter, the REAL Phase D orchestrator,
 * and the REAL Phase E review handoff.
 */

const BRIDGE_PATH = '**/__tvb/eu/search'

const topUrl = (ref: string) =>
  `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${ref}`

/** A valid SEDIA response with one OPEN topic and one FORTHCOMING topic. */
const EU_RESPONSE = JSON.stringify({
  apiVersion: '2.155',
  totalResults: 2,
  results: [
    {
      reference: 'HORIZON-OPEN',
      url: topUrl('HORIZON-OPEN'),
      metadata: {
        DATASOURCE: ['SEDIA'],
        type: ['1'],
        status: ['31094502'],
        title: ['AI RESEARCH GRANT'],
        callIdentifier: ['HORIZON-CL4-2026'],
        deadlineDate: ['2030-12-01T17:00:00.000+0000'],
      },
    },
    {
      reference: 'HORIZON-SOON',
      url: topUrl('HORIZON-SOON'),
      metadata: {
        DATASOURCE: ['SEDIA'],
        type: ['1'],
        status: ['31094501'],
        title: ['FORTHCOMING AI TOPIC'],
        callIdentifier: ['HORIZON-CL4-2026'],
        deadlineDate: ['2030-12-02T17:00:00.000+0000'],
      },
    },
  ],
})

async function selectCompanyRows(page: Page, count: number) {
  const checkboxes = page.locator('.dg-company__check')
  for (let index = 0; index < count; index += 1) {
    await checkboxes.nth(index).check()
  }
}

function summaryCell(page: Page, label: string) {
  return page.locator('.stat', { hasText: label }).locator('.stat__count')
}

async function routeEuBridgeRecording(page: Page, payloads: string[]) {
  await page.route(BRIDGE_PATH, async (route: Route) => {
    payloads.push(route.request().postData() ?? '')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 200, body: EU_RESPONSE }),
    })
  })
}

test('the live EU funding button exists separately from the scenario and other live controls', async ({ page }) => {
  await page.goto('/discovery')
  await expect(page.getByRole('button', { name: 'Run Live EU Funding Search' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run Live Funding Search' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run Live TED Search' })).toBeVisible()
})

test('a live EU run queries SEDIA through the real pipeline and marks only open calls confirmed', async ({ page }) => {
  const w = watchPage(page)
  const payloads: string[] = []
  await page.goto('/discovery')
  await routeEuBridgeRecording(page, payloads)

  await page.getByLabel('Keyword').fill('artificial intelligence')
  await selectCompanyRows(page, 3)
  await page.getByRole('button', { name: 'Run Live EU Funding Search' }).click()
  await expect(page.locator('.dg-results')).toBeVisible()

  await expect(summaryCell(page, 'Companies processed')).toHaveText('3')
  await expect(summaryCell(page, 'Domain')).toHaveText('Grants')
  await expect(summaryCell(page, 'Overall outcome')).toHaveText('Completed')

  await expect(page.locator('.dg-banner', { hasText: 'EU grant topics and cascade funding calls' })).toBeVisible()
  await expect(page.getByText('This run queried the real EU Funding & Tenders Portal')).toBeVisible()
  await expect(page.locator('.dg-source', { hasText: 'SU-EU-001' })).toHaveCount(3)

  await expect(page.locator('.dg-result')).toHaveCount(3)
  for (const row of await page.locator('.dg-result').all()) {
    await expect(row.locator('.dg-result__counts')).toContainText('Candidates: 2')
    await expect(row.locator('.dg-result__counts')).toContainText('Open (passed gate): 1')
    await expect(row.locator('.dg-result__counts')).toContainText('Excluded: 1')
  }

  await expect(page.locator('.dg-candidate')).toHaveCount(6)
  await expect(page.locator('.dg-candidate', { hasText: 'Open (confirmed)' })).toHaveCount(3)
  await expect(page.locator('.dg-candidate', { hasText: 'Excluded:' })).toHaveCount(3)
  await expect(page.locator('.dg-candidate__meta').first()).toContainText('GRANT_TOPIC')
  await expect(page.locator('.dg-candidate__link').first()).toHaveAttribute('href', /ec\.europa\.eu/)

  // ONE same-origin EU bridge call for the whole run.
  expect(payloads.length, 'one bridge call for the whole run').toBe(1)
  const parsed = JSON.parse(payloads[0]) as { runId: string; keyword: string; companyId: string }
  expect(parsed.runId).toBe('RUN-EU-0001')
  expect(parsed.keyword).toBe('artificial intelligence')
  expect(parsed.companyId).toBe('RUN')

  expect(w.pageErrors, 'no uncaught page errors').toEqual([])
  expect(w.consoleErrors, 'no console errors').toEqual([])
  expect(externalRequests(w.requests), 'no external requests — the bridge kept everything same-origin').toEqual([])
})
