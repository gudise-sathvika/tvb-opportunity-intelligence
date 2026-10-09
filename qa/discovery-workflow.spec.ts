import { expect, test, type Page } from '@playwright/test'
import {
  expectAppChrome,
  externalRequests,
  hasHorizontalOverflow,
  watchPage,
} from './helpers'

/**
 * Phase I: transparent agent workflow visualization (§12).
 *
 * Covers: the three stages in order, Agent 1's real source values, Agent 2's
 * real classification values, Agent 3's honest not-run state with no fake
 * matching, access-state display incl. the blocked case, Grant/RFP
 * terminology, the requested filter context, the unchanged handoff, and the
 * usual no-network / no-error / responsive / keyboard bar.
 */

async function selectAllCompanies(page: Page) {
  const checkboxes = page.locator('.dg-company__check')
  for (let index = 0; index < 3; index += 1) {
    await checkboxes.nth(index).check()
  }
  await expect(page.getByRole('status')).toContainText('3 companies selected')
}

function workflow(page: Page) {
  return page.getByRole('region', { name: 'Automation workflow' })
}

function agent(page: Page, index: 0 | 1 | 2) {
  return workflow(page).locator('.dg-agent').nth(index)
}

test.describe('three agent stages', () => {
  test('the workflow renders the three stages in order with the transparency note', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    const flow = workflow(page)
    await expect(flow.getByRole('heading', { name: 'Automation workflow' })).toBeVisible()
    await expect(flow).toContainText(
      'Automation does not directly create Vault records. Candidates pass through discovery, classification, deduplication, and human review before any future write.',
    )
    await expect(flow.locator('.dg-agent')).toHaveCount(3)
    await expect(agent(page, 0)).toContainText('Agent 1')
    await expect(agent(page, 0).getByRole('heading', { name: 'Source Discovery' })).toBeVisible()
    await expect(agent(page, 0)).toContainText('Find candidate information from configured sources.')
    await expect(agent(page, 1).getByRole('heading', { name: 'Classification' })).toBeVisible()
    await expect(agent(page, 1)).toContainText(
      'Classify/extract candidates as Grant or RFP using the existing deterministic pipeline.',
    )
    await expect(agent(page, 2).getByRole('heading', { name: 'Company Matching' })).toBeVisible()
    await expect(agent(page, 2)).toContainText('Match approved opportunities to TVB companies.')
    // The two flow arrows are decorative.
    await expect(flow.locator('.dg-flow')).toHaveCount(2)
    await expectAppChrome(page)
  })

  test('Agent 1 shows the actual source run values', async ({ page }) => {
    const w = watchPage(page)
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    const first = agent(page, 0)
    await expect(first).toContainText('✓ Completed')
    await expect(first).toContainText('Sources checked: 3')
    await expect(first).toContainText('Candidates received: 6')

    await first.getByText('Show source detail').click()
    await expect(first.getByText('Fixture Procurement Portal (local, deterministic)')).toHaveCount(3)
    await expect(first.getByText('SU-FX-001', { exact: true })).toHaveCount(3)
    await expect(first.getByText('Access: AVAILABLE')).toHaveCount(3)
    await expect(first.getByText('Results received: 2 · Candidates created: 2')).toHaveCount(3)
    // Nothing claims a blocked fixture source was scraped.
    await expect(workflow(page).getByText(/scraped/i)).toHaveCount(0)

    expect(w.pageErrors, 'no uncaught page errors').toEqual([])
    expect(w.consoleErrors, 'no console errors').toEqual([])
    expect(w.failedRequests, 'no failed requests').toEqual([])
    expect(externalRequests(w.requests), 'no external requests').toEqual([])
  })

  test('Agent 2 shows the actual classification values', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    const second = agent(page, 1)
    await expect(second).toContainText('✓ Completed')
    await expect(second).toContainText('Candidates received: 6')
    await expect(second).toContainText('Candidates classified: 6')
    await expect(second).toContainText('RFP: 6')
    await expect(second).toContainText('Needs review: 6')
    await expect(second).toContainText('Duplicates: 0')

    await second.getByText('Show classification detail').click()
    await expect(second.getByText('Fixture IT Equipment Supply Tender (Year 1)')).toHaveCount(3)
    const rows = second.locator('.dg-agent__item')
    await expect(rows).toHaveCount(6)
    for (const row of await rows.all()) {
      await expect(row).toContainText('RFP')
      await expect(row).toContainText('Normalized')
    }
  })

  test('a Grants run classifies its findings as Grants', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByRole('button', { name: 'Run Grant Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    await expect(agent(page, 1)).toContainText('Grant: 3')
    await expect(agent(page, 1)).toContainText('Needs review: 3')
  })
})

test.describe('Agent 3 honesty', () => {
  test('matching is explicitly not run with no fake results', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    const third = agent(page, 2)
    await expect(third).toContainText('○ Not run')
    await expect(third).toContainText('Not run — matching is a later phase.')
    await expect(third).toContainText('Not implemented in this phase.')
    await expect(third).toContainText('Runs after approved candidates are available.')
    await expect(third.locator('details')).toHaveCount(0, 'nothing to expand: no results exist')
    // No invented matching output anywhere in the workflow.
    await expect(workflow(page).getByText(/match score|matches found|matching complete|matched to/i)).toHaveCount(0)
  })

  test('the workflow invents no AI behavior', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByRole('button', { name: 'Run Grant Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    const flow = workflow(page)
    await expect(flow.getByText(/confidence|model name|token count|reasoning|AI found|agent execution/i)).toHaveCount(0)
    await expect(flow.getByText(/RFB/)).toHaveCount(0, 'Grant/RFP terminology only')
  })
})

test.describe('blocked and failed sources', () => {
  test('a blocked run shows every source as blocked with its real reason', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByLabel('Blocked source').check()
    await page.getByRole('button', { name: 'Run Grant Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    const first = agent(page, 0)
    await expect(first).toContainText('Sources checked: 3')
    await expect(first).toContainText('Candidates received: 0')
    await expect(first).toContainText('Blocked sources: 3')
    await first.getByText('Show source detail').click()
    await expect(first.getByText('Blocked', { exact: true })).toHaveCount(3)
    await expect(first.getByText('Access: AVAILABLE')).toHaveCount(3)
    await expect(first.getByText(/adapter_not_available/)).toHaveCount(3)
    await expect(first).toContainText('Blocked or failed sources were not queried for listings.')

    const second = agent(page, 1)
    await expect(second).toContainText('○ Not run')
    await expect(second).toContainText('No candidates reached classification.')
  })

  test('a failed run leaves classification not run', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByLabel('Source fails').check()
    await page.getByRole('button', { name: 'Run Grant Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    await expect(agent(page, 0)).toContainText('Failed sources: 3')
    await expect(agent(page, 1)).toContainText('○ Not run')
    await expect(agent(page, 2)).toContainText('○ Not run')
  })
})

test.describe('requested filter context', () => {
  test('the workflow shows what the automation was asked to find', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByLabel('Sector / Category').selectOption('infrastructure')
    await page.getByLabel('Keyword').fill('tender')
    await page.getByLabel('Location').selectOption('usa')
    await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    const requested = workflow(page).locator('.dg-requested')
    await expect(requested).toContainText('Companies:')
    await expect(requested).toContainText('1839 Ventures')
    await expect(requested).toContainText('Aavo')
    await expect(requested).toContainText('Aditya Birla')
    await expect(requested).toContainText('Domain: RFP')
    await expect(requested).toContainText('Sector: Infrastructure')
    await expect(requested).toContainText('Keyword: tender')
    await expect(requested).toContainText('Location: USA')
  })

  test('a single company reads as Company, and an empty keyword as a dash', async ({ page }) => {
    await page.goto('/discovery')
    await page.locator('.dg-company__check').nth(1).check()
    await page.getByRole('button', { name: 'Run Grant Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    const requested = workflow(page).locator('.dg-requested')
    await expect(requested).toContainText('Company: Aavo')
    await expect(requested).toContainText('Domain: Grants')
    await expect(requested).toContainText('Keyword: —')
  })
})

test.describe('handoff, responsive, keyboard', () => {
  test('the review handoff still works beneath the workflow', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByRole('button', { name: 'Run Grant Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    await expect(page.getByRole('link', { name: 'Review 3 candidates' })).toBeVisible()
    await page.getByRole('link', { name: 'View Review Queue' }).click()
    await expect(page).toHaveURL(/\/review$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Human review')
  })

  for (const width of [1440, 1024, 768, 390]) {
    test(`no horizontal overflow with the workflow open at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/discovery')
      await selectAllCompanies(page)
      await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
      await expect(page.locator('.dg-results')).toBeVisible()
      expect(await hasHorizontalOverflow(page), `workflow at ${width}px`).toBe(false)

      await agent(page, 0).getByText('Show source detail').click()
      await agent(page, 1).getByText('Show classification detail').click()
      expect(await hasHorizontalOverflow(page), `workflow expanded at ${width}px`).toBe(false)
    })
  }

  test('stage details toggle with the keyboard and keep visible focus', async ({ page }) => {
    await page.goto('/discovery')
    await selectAllCompanies(page)
    await page.getByRole('button', { name: 'Run RFP Discovery' }).click()
    await expect(page.locator('.dg-results')).toBeVisible()

    // Tab from the top until the first stage disclosure takes focus.
    let focused = false
    for (let i = 0; i < 60 && !focused; i++) {
      await page.keyboard.press('Tab')
      focused = await page.evaluate(
        () => document.activeElement?.textContent === 'Show source detail',
      )
    }
    expect(focused, 'the source disclosure is reachable by Tab').toBe(true)
    const outlined = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return false
      const style = getComputedStyle(el)
      return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
    })
    expect(outlined, 'the focused disclosure shows an outline').toBe(true)

    await page.keyboard.press('Enter')
    await expect(agent(page, 0).locator('details')).toHaveAttribute('open', '')
    await page.keyboard.press('Enter')
    await expect(agent(page, 0).locator('details')).not.toHaveAttribute('open', '')
  })
})