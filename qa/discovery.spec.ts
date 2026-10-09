import { expect, test, type Page } from '@playwright/test'
import {
  expectAppChrome,
  externalRequests,
  hasHorizontalOverflow,
  watchPage,
} from './helpers'

/**
 * Phase G: the Discovery Control Panel (Phase G brief §17).
 *
 * Covers: the route and nav entry, real company selection, the Grants/RFPs
 * mode separation, run execution with the deterministic fixture numbers, the
 * nine-part run summary, per-company results, the review handoff into the
 * Phase F queue, in-memory run history, fixture-transparency labelling, no
 * network or console errors, and responsive/accessibility basics.
 */

async function selectAllCompanies(page: Page) {
  // Keep fixture-workflow checks bounded to the fixture's historical three-run
  // count; the separate selector test covers selecting all 189 source names.
  const checkboxes = page.locator('.dg-company__check')
  for (let index = 0; index < 3; index += 1) {
    await checkboxes.nth(index).check()
  }
  await expect(page.locator('.dg-count')).toContainText('3 companies selected')
}

async function runGrantDiscovery(page: Page) {
  await page.getByRole('button', { name: 'Run Grant Discovery' }).click()
  await expect(page.locator('.dg-results')).toBeVisible()
}

/** The summary cell whose label matches, scoped like the review stats. */
function summaryCell(page: Page, label: string) {
  return page.locator('.stat', { hasText: label }).locator('.stat__count')
}

test.describe('discovery route and chrome', () => {
  test('loads with the exact heading, subtitle, and scenario-mode label', async ({ page }) => {
    const w = watchPage(page)
    await page.goto('/discovery')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Discovery')
    await expect(page.locator('.page__description')).toContainText('Find grants and RFPs for TVB companies.')
    await expect(page.locator('.dg-banner')).toContainText('Scenario mode — runs against local source adapters')
    // The panel is honest: it never claims to be a live search of a real source.
    await expect(
      page.getByText(/is a live search|live search of|scraped findings|connected to GlobalTenders|querying GlobalTenders/i),
    ).toHaveCount(0)
    await expectAppChrome(page)

    expect(w.pageErrors, 'no uncaught page errors').toEqual([])
    expect(w.consoleErrors, 'no console errors').toEqual([])
    expect(w.failedRequests, 'no failed requests').toEqual([])
    expect(externalRequests(w.requests), 'no external requests').toEqual([])
  })

  test('Discovery is workspace territory, not a top-bar destination', async ({ page }) => {
    await page.goto('/funding')
    const nav = page.locator('nav[aria-label="Primary"]')
    await expect(nav.getByRole('link', { name: 'Discovery', exact: true })).toHaveCount(0)

    // It hangs off the funding workspace: the overview flow strip is how a
    // reader reaches it...
    await page.goto('/funding')
    await page.getByRole('link', { name: 'Discover', exact: true }).click()
    await expect(page).toHaveURL(/\/discovery$/)

    // ...and once there, the workspace bar says where you are.
    await expect(page.locator('.wbar__tab--active')).toHaveText('Source discovery')
  })

  test('the page keeps one h1 and a consistent heading hierarchy', async ({ page }) => {
    await page.goto('/discovery')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    const levels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3')).map((h) => Number(h.tagName[1])),
    )
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1], 'no heading level jumps').toBeLessThanOrEqual(1)
    }
  })
})

test.describe('company selection', () => {
  test('shows five alphabetized source names per page without synthetic Company IDs', async ({ page }) => {
    await page.goto('/discovery')
    const checks = page.locator('.dg-company__check')
    await expect(checks).toHaveCount(5)
    await expect(page.locator('.dg-company__name')).toHaveText([
      '1839 Ventures',
      'Aavo',
      'Aditya Birla',
      'Advait techserve',
      'Agyle Networks',
    ])
    await expect(page.getByText('1–5 of 189')).toBeVisible()
    await expect(page.locator('.dg-company .idbadge')).toHaveCount(0)
  })

  test('pagination exposes all names and preserves selections between pages', async ({ page }) => {
    await page.goto('/discovery')
    const names: string[] = []
    const next = page.getByRole('button', { name: 'Next companies' })

    while (true) {
      names.push(...(await page.locator('.dg-company__name').allTextContents()))
      if (await next.isDisabled()) break
      await next.click()
    }

    expect(names).toHaveLength(189)
    expect(new Set(names).size).toBe(189)
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' })))
    for (const expected of ['Aavo', 'Harvard Alumni Entrepreneurs', 'UT Austin']) {
      expect(names).toContain(expected)
    }

    await page.getByRole('button', { name: 'Previous companies' }).click()
    await page.getByRole('button', { name: 'Previous companies' }).click()
    await page.getByRole('button', { name: 'Previous companies' }).click()
    await page.locator('.dg-company__check').first().check()
    await next.click()
    await expect(page.locator('.dg-count')).toContainText('1 company selected')
    await page.getByRole('button', { name: 'Previous companies' }).click()
    await expect(page.locator('.dg-company__check').first()).toBeChecked()
  })

  test('search finds directory names and select all visible applies to the current page', async ({ page }) => {
    await page.goto('/discovery')
    await page.getByRole('searchbox', { name: 'Search companies' }).fill('Harvard Alumni')
    await expect(page.locator('.dg-company__name')).toHaveText(['Harvard Alumni Entrepreneurs'])
    await expect(page.getByText('1–1 of 1')).toBeVisible()

    await page.getByRole('searchbox', { name: 'Search companies' }).fill('UT Austin')
    await expect(page.locator('.dg-company__name')).toHaveText(['UT Austin'])

    await page.getByRole('searchbox', { name: 'Search companies' }).fill('')
    await page.getByRole('button', { name: 'Select all visible' }).click()
    await expect(page.locator('.dg-count')).toContainText('5 companies selected')
    await page.getByRole('button', { name: 'Next companies' }).click()
    await expect(page.locator('.dg-company__check:checked')).toHaveCount(0)
    await page.getByRole('button', { name: 'Select all visible' }).click()
    await expect(page.locator('.dg-count')).toContainText('10 companies selected')
    await page.getByRole('button', { name: 'Previous companies' }).click()
    await expect(page.locator('.dg-company__check:checked')).toHaveCount(5)

    await page.getByRole('button', { name: 'Clear selection' }).click()
    await expect(page.locator('.dg-count')).toContainText('0 companies selected')
    await expect(page.locator('.dg-company__check:checked')).toHaveCount(0)
  })

  test('the live selection count reflects checkboxes and enables the run actions', async ({ page }) => {
    await page.goto('/discovery')
    await expect(page.locator('.dg-count')).toContainText('0 companies selected')
    const grants = page.getByRole('button', { name: 'Run Grant Discovery' })
    const rfps = page.getByRole('button', { name: 'Run RFP Discovery' })
    await expect(grants).toBeDisabled()
    await expect(rfps).toBeDisabled()

    await page.locator('.dg-company__check').nth(0).check()
    await expect(page.locator('.dg-count')).toContainText('1 company selected')
    await expect(grants).toBeEnabled()
    await expect(rfps).toBeEnabled()

    await page.locator('.dg-company__check').nth(0).uncheck()
    await expect(page.locator('.dg-count')).toContainText('0 companies selected')
    await expect(grants).toBeDisabled()
    await expect(rfps).toBeDisabled()
  })

  test('select all source names and clear selection update the count', async ({ page }) => {
    await page.goto('/discovery')
    await page.getByRole('button', { name: 'Select all visible' }).click()
    await expect(page.locator('.dg-count')).toContainText('5 companies selected')
    await expect(page.locator('.dg-company__check')).toHaveCount(5)
    for (const check of await page.locator('.dg-company__check').all()) {
      await expect(check).toBeChecked()
    }

    await page.getByRole('button', { name: 'Clear selection' }).click()
    await expect(page.locator('.dg-count')).toContainText('0 companies selected')
    for (const check of await page.locator('.dg-company__check').all()) {
      await expect(check).not.toBeChecked()
    }
    await expect(page.locator('.dg-instruction')).toContainText('Select at least one company')
  })
})

test.describe('domain and scenario selection', () => {
  test('exposes exactly two modes labelled Grants and RFPs, Grants first', async ({ page }) => {
    await page.goto('/discovery')
    const domain = page.getByRole('group', { name: 'What to look for' })
    const radios = domain.getByRole('radio')
    await expect(radios).toHaveCount(2)
    await expect(domain.getByLabel('Grants')).toBeChecked()
    await expect(domain.getByLabel('RFPs')).not.toBeChecked()
    await domain.getByLabel('RFPs').check()
    await expect(domain.getByLabel('RFPs')).toBeChecked()
  })

  test('exposes standard, source-fails, and blocked source scenarios', async ({ page }) => {
    await page.goto('/discovery')
    const scenarios = page.getByRole('group', { name: 'Scenario' })
    const radios = scenarios.getByRole('radio')
    await expect(radios).toHaveCount(3)
    await expect(scenarios.getByLabel('Standard')).toBeChecked()
    await scenarios.getByLabel('Source fails').check()
    await expect(scenarios.getByLabel('Source fails')).toBeChecked()
    await scenarios.getByLabel('Blocked source').check()
    await expect(scenarios.getByLabel('Blocked source')).toBeChecked()
  })

  test('with no companies selected both run buttons are disabled with an instruction', async ({ page }) => {
    await page.goto('/discovery')
    const grant = page.getByRole('button', { name: 'Run Grant Discovery' })
    const rfb = page.getByRole('button', { name: 'Run RFP Discovery' })
    await expect(grant).toBeDisabled()
    await expect(rfb).toBeDisabled()
    await expect(page.locator('.dg-instruction')).toContainText('Select at least one company')
  })
})

test.describe('grant discovery runs', () => {
  test('the selected source name can run Grants and RFP discovery without a synthetic company ID', async ({
    page,
  }) => {
    await page.goto('/discovery')
    await page.getByLabel('Aavo', { exact: true }).check()
    await expect(page.getByRole('button', { name: 'Run Grant Discovery' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Run RFP Discovery' })).toBeEnabled()

    await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()
    await expect(summaryCell(page, 'Companies processed')).toHaveText('1')
    await expect(summaryCell(page, 'Domain')).toHaveText('RFP')
    await expect(page.locator('.dg-result__name')).toHaveText(['Aavo'])
    await expect(page.locator('.dg-results').getByText(/COMP-00[123]/)).toHaveCount(0)

    await page.getByRole('button', { name: 'Run Grant Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()
    await expect(summaryCell(page, 'Domain')).toHaveText('Grants')
    await expect(page.locator('.dg-result__name')).toHaveText(['Aavo'])
  })

  test('a standard Grants run renders the real fixture summary numbers', async ({ page }) => {
    const w = watchPage(page)
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await runGrantDiscovery(page)

    await expect(summaryCell(page, 'Companies processed')).toHaveText('3')
    await expect(summaryCell(page, 'Domain')).toHaveText('Grants')
    await expect(summaryCell(page, 'Sources attempted')).toHaveText('3')
    await expect(summaryCell(page, 'Candidates found')).toHaveText('3')
    await expect(summaryCell(page, 'Candidates requiring review')).toHaveText('3')
    await expect(summaryCell(page, 'Duplicates')).toHaveText('0')
    await expect(summaryCell(page, 'Blocked sources')).toHaveText('0')
    await expect(summaryCell(page, 'Failed sources')).toHaveText('0')
    await expect(summaryCell(page, 'Overall outcome')).toHaveText('Completed')
    // No invented metrics on the panel.
    await expect(page.getByText(/trend|percentage|success rate/i)).toHaveCount(0)

    expect(w.pageErrors, 'no uncaught page errors').toEqual([])
    expect(w.consoleErrors, 'no console errors').toEqual([])
    expect(externalRequests(w.requests), 'no external requests').toEqual([])
  })

  test('Grants discovers exactly one funding candidate per company', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await runGrantDiscovery(page)

    await expect(page.locator('.dg-result')).toHaveCount(3)
    for (const row of await page.locator('.dg-result').all()) {
      await expect(row.locator('.dg-result__summary .dg-chip')).toHaveText('Completed')
      await expect(row.locator('.dg-result__counts')).toContainText('Candidates: 1')
      await expect(row.locator('.dg-result__counts')).toContainText('Needs review: 1')
    }
    // Domain separation: no RFP listing ever appears in a Grants run.
    await expect(page.getByText('Fixture Framework Agreement for Construction Services')).toHaveCount(0)
  })

  test('the per-company detail expands to the fixture source run', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await runGrantDiscovery(page)

    await page.locator('.dg-result').first().locator('summary').click()
    const firstResult = page.locator('.dg-result').first()
    await expect(firstResult.locator('.dg-source', { hasText: 'SU-FX-002' })).toBeVisible()
    await expect(firstResult.locator('.dg-candidates')).toContainText('Fixture Climate Innovation Grant Programme')
  })

  test('a standard RFP run discovers two procurement candidates per company', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    await expect(summaryCell(page, 'Domain')).toHaveText('RFP')
    await expect(summaryCell(page, 'Candidates found')).toHaveText('6')
    await expect(summaryCell(page, 'Candidates requiring review')).toHaveText('6')
    await expect(summaryCell(page, 'Sources attempted')).toHaveText('3')
    await expect(page.locator('.dg-result')).toHaveCount(3)
    for (const row of await page.locator('.dg-result').all()) {
      await expect(row.locator('.dg-result__counts')).toContainText('Candidates: 2')
      await expect(row.locator('.dg-result__counts')).toContainText('Needs review: 2')
    }
    await expect(page.locator('.dg-results').getByText('Fixture IT Equipment Supply Tender (Year 1)')).toHaveCount(3)
  })

  test('each run button executes its own domain regardless of the radio', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByLabel('RFPs').check()
    await page.getByRole('button', { name: 'Run Grant Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()
    await expect(summaryCell(page, 'Domain')).toHaveText('Grants')
    await expect(summaryCell(page, 'Candidates found')).toHaveText('3')
  })

  test('the running state appears while companies execute', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByRole('button', { name: 'Run Grant Discovery' }).click()
    // Execution is sequential with a paint yield between companies, so the
    // progress list is visible before the summary lands.
    await expect(page.getByText('Running discovery', { exact: false })).toBeVisible({ timeout: 3000 })
    await expect(page.locator('.dg-progress__row')).toHaveCount(3)
    await expect(page.locator('.dg-results')).toBeVisible()
    await expect(page.locator('.dg-progress')).toHaveCount(0)
  })
})

test.describe('failure and blocked scenarios', () => {
  test('Source fails produces a failed run with no candidates and no handoff count', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByLabel('Source fails').check()
    await runGrantDiscovery(page)

    await expect(summaryCell(page, 'Overall outcome')).toHaveText('Failed')
    await expect(summaryCell(page, 'Candidates found')).toHaveText('0')
    await expect(summaryCell(page, 'Failed sources')).toHaveText('3')
    for (const row of await page.locator('.dg-result').all()) {
      await expect(row.locator('.dg-result__summary .dg-chip')).toHaveText('Failed')
    }
    await expect(page.getByRole('link', { name: /Review \d candidates/ })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'View Review Queue' })).toBeVisible()
  })

  test('Blocked source blocks every company with no candidates', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByLabel('Blocked source').check()
    await runGrantDiscovery(page)

    await expect(summaryCell(page, 'Overall outcome')).toHaveText('Blocked')
    await expect(summaryCell(page, 'Blocked sources')).toHaveText('3')
    await expect(summaryCell(page, 'Candidates found')).toHaveText('0')
    for (const row of await page.locator('.dg-result').all()) {
      await expect(row.locator('.dg-result__summary .dg-chip')).toHaveText('Blocked')
    }
    await expect(page.getByRole('link', { name: /Review \d candidates/ })).toHaveCount(0)
  })
})

test.describe('review handoff', () => {
  test('a Grants run hands its three findings into the Human review queue', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await runGrantDiscovery(page)

    await expect(page.getByRole('link', { name: 'Review 3 candidates' })).toBeVisible()
    await page.getByRole('link', { name: 'Review 3 candidates' }).click()
    await expect(page).toHaveURL(/\/review$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Human review')

    // The four original needs-review rows plus the three discovery findings.
    await expect(page.locator('tbody tr')).toHaveCount(7)
    await expect(page.locator('tbody', { hasText: 'Fixture Climate Innovation Grant Programme' })).toBeVisible()
    // Only in-domain findings ever reach the queue after a Grants run.
    await expect(page.getByText('Fixture Framework Agreement for Construction Services')).toHaveCount(0)
  })

  test('View Review Queue navigates to the Phase F queue', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await runGrantDiscovery(page)
    await page.getByRole('link', { name: 'View Review Queue' }).click()
    await expect(page).toHaveURL(/\/review$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Human review')
  })

  test('a failed run keeps the queue untouched', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByLabel('Source fails').check()
    await runGrantDiscovery(page)
    await page.getByRole('link', { name: 'View Review Queue' }).click()
    await expect(page).toHaveURL(/\/review$/)
    await expect(page.locator('tbody tr')).toHaveCount(4, { timeout: 3000 })
  })
})

test.describe('run history', () => {
  test('starts empty and records a completed run with its real counts', async ({ page }) => {
    await page.goto('/discovery')
    await expect(page.locator('.dg-history')).toHaveCount(0)
    await expect(page.locator('.dg-panel', { hasText: 'Recent Discovery Runs' })).toContainText(
      'No discovery runs yet in this session.',
    )

    await selectAllCompanies(page)
    await runGrantDiscovery(page)
    await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    // Two runs: the grants run and the RFP run, newest last.
    const runs = page.locator('.dg-history__run')
    await expect(runs).toHaveCount(2)
    await expect(runs.nth(0)).toContainText('RUN-G-0001')
    await expect(runs.nth(0)).toContainText('Grants')
    await expect(runs.nth(0)).toContainText('3 companies')
    await expect(runs.nth(0)).toContainText('3 candidates')
    await expect(runs.nth(0)).toContainText('Completed')
    await expect(runs.nth(1)).toContainText('RUN-G-0002')
    await expect(runs.nth(1)).toContainText('RFPs')
    await expect(runs.nth(1)).toContainText('6 candidates')
  })

  test('history is in-memory: a reload starts a fresh session', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await runGrantDiscovery(page)
    await expect(page.locator('.dg-history__run')).toHaveCount(1)

    await page.reload()
    await expect(page.locator('.dg-panel', { hasText: 'Recent Discovery Runs' })).toContainText(
      'No discovery runs yet in this session.',
    )
  })
})

test.describe('responsive and accessibility', () => {
  const widths = [1440, 1024, 768, 390]

  for (const width of widths) {
    test(`no horizontal overflow on the control panel at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/discovery')
      expect(await hasHorizontalOverflow(page), `panel at ${width}px`).toBe(false)

      await selectAllCompanies(page)
      await runGrantDiscovery(page)
      expect(await hasHorizontalOverflow(page), `panel after a run at ${width}px`).toBe(false)
    })
  }

  test('form controls are reachable by keyboard with visible focus', async ({ page }) => {
    await page.goto('/discovery')
    const steps = 26
    const hidden: string[] = []
    for (let i = 0; i < steps; i++) {
      await page.keyboard.press('Tab')
      const check = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return 'end'
        const style = getComputedStyle(el)
        const outlined =
          style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && style.outlineColor !== 'transparent'
        const label =
          (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) ||
          el.getAttribute('aria-label') ||
          (el as HTMLInputElement).value ||
          el.id ||
          el.tagName
        return outlined ? 'ok' : `no outline on: ${label}`
      })
      if (check === 'end') break
      if (check !== 'ok') hidden.push(check)
    }
    expect(hidden, 'focused elements show a visible focus outline').toEqual([])

    // The key controls are real inputs in the tab order.
    for (const name of ['Run Grant Discovery', 'Run RFP Discovery', 'Select all visible', 'Clear selection']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
  })

  test('status chips never rely on colour alone', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await runGrantDiscovery(page)
    const labels = await page.locator('.dg-chip').allTextContents()
    expect(labels.length, 'status chips are labelled').toBeGreaterThanOrEqual(4)
    for (const label of labels) expect(label.trim().length).toBeGreaterThan(0)
  })
})