import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  extractIntelligenceFromContent,
  resolveCompanyWebsite,
  enrichTargetCompany,
  handleBatchCompanyEnrichment,
} from './handler'

test('resolveCompanyWebsite preserves supplied URL with proper scheme', () => {
  const result = resolveCompanyWebsite('Pacewisdom', 'pacewisdom.com')
  assert.equal(result.url, 'https://pacewisdom.com')
  assert.equal(result.via, 'supplied-url')
})

test('resolveCompanyWebsite discovers website when URL is missing', () => {
  const result = resolveCompanyWebsite('Pacewisdom', '')
  assert.equal(result.url, 'https://www.pacewisdom.com/')
  assert.equal(result.via, 'search-discovery')
})

test('extractIntelligenceFromContent accurately detects dual presence (India + US)', () => {
  const content = `
    <h1>Pacewisdom Software Solutions</h1>
    <p>We are a custom software development company based in Bangalore, Karnataka, India.</p>
    <p>Our US operating office is located in San Francisco, California.</p>
    <p>We build artificial intelligence models, computer vision pipelines, and custom web applications.</p>
    <p>We also provide automated QA testing and cloud migration services on AWS.</p>
  `
  const intel = extractIntelligenceFromContent('Pacewisdom', 'https://pacewisdom.com', content)

  assert.equal(intel.isMultiJurisdiction, true)
  assert.ok(intel.operatingCountries.includes('India'))
  assert.ok(intel.operatingCountries.includes('United States'))
  assert.ok(intel.sectors.includes('Software Services'))
  assert.ok(intel.sectors.includes('Artificial Intelligence'))
  assert.ok(intel.capabilities.includes('Custom Web Applications'))
  assert.ok(intel.capabilities.includes('Computer Vision'))
  assert.ok(intel.capabilities.includes('Automated QA Testing'))
  assert.ok(intel.capabilities.includes('Cloud Migration'))
})

test('enrichTargetCompany successfully parses mock Firecrawl API response', async () => {
  const mockFetch: typeof globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('api.firecrawl.dev')) {
      return new Response(
        JSON.stringify({
          data: {
            markdown: '# Enterprise AI and Software Development\nHeadquartered in Bangalore, India with offices in Austin, Texas. Specializing in machine learning and cloud architecture.',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response('Not found', { status: 404 })
  }

  const res = await enrichTargetCompany(
    { companyName: 'Pacewisdom', websiteUrl: 'https://pacewisdom.com', apiKey: 'fc_test_key' },
    { fetchImpl: mockFetch },
  )

  assert.equal(res.ok, true)
  assert.ok(res.profile !== null)
  assert.equal(res.profile?.companyName, 'Pacewisdom')
  assert.equal(res.profile?.isMultiJurisdiction, true)
  assert.ok(res.profile?.capabilities.includes('Cloud Migration'))
})

test('handleBatchCompanyEnrichment enriches multiple companies', async () => {
  const mockFetch: typeof globalThis.fetch = async () => {
    return new Response('<html><body>Technology consulting in Bangalore, India</body></html>', { status: 200 })
  }

  const batch = await handleBatchCompanyEnrichment(
    {
      companies: [
        { companyName: 'Company A', websiteUrl: 'https://comp-a.in' },
        { companyName: 'Company B', websiteUrl: null },
      ],
    },
    { fetchImpl: mockFetch },
  )

  assert.equal(batch.ok, true)
  assert.equal(batch.profiles.length, 2)
  assert.equal(batch.profiles[1].resolvedVia, 'search-discovery')
})
