/**
 * Phase 06 live match workflow — unit tests (fully offline).
 *
 * The workflow is exercised end-to-end through the REAL GLEIF mapper, the
 * REAL adapters + pipeline + shared gate, and the REAL funding/procurement
 * engines, but every bridge is an injected fake returning recorded source
 * bodies — no network, no files, no clock (requestedAt is fixed).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runLiveMatchCheck } from './live-match-workflow'
import type { LiveMatchClients } from './live-match-workflow'

const REQUESTED_AT = '2026-10-09T00:00:00.000Z'

const GLEIF_BODY = JSON.stringify({
  data: [
    {
      id: '3C7474T6CDKPR9K6YT90',
      attributes: {
        lei: '3C7474T6CDKPR9K6YT90',
        entity: {
          legalName: { name: 'GENERAL ELECTRIC COMPANY' },
          legalAddress: { country: 'US' },
          status: 'ACTIVE',
        },
        registration: { status: 'ISSUED' },
      },
    },
    {
      id: 'RETIRED0000000000001',
      attributes: {
        lei: 'RETIRED0000000000001',
        entity: {
          legalName: { name: 'Retired Shell Ltd' },
          legalAddress: { country: 'GB' },
          status: 'INACTIVE',
        },
        registration: { status: 'RETIRED' },
      },
    },
  ],
})

const GRANTS_BODY = JSON.stringify({
  errorcode: 0,
  msg: 'Webservice Succeeds',
  data: {
    hitCount: 1,
    oppHits: [
      {
        id: '363929',
        number: 'NOAA-NMFS-PRPO-2026-31863',
        title: 'John H. Prescott Marine Mammal Rescue Assistance Grant',
        agencyCode: 'DOC',
        agency: 'Department of Commerce',
        openDate: '09/23/2026',
        closeDate: '12/01/2026',
        oppStatus: 'posted',
      },
    ],
  },
})

const FTS_BODY = JSON.stringify({
  uri: 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=10',
  publishedDate: '2026-10-09T00:00:00+01:00',
  releases: [
    {
      ocid: 'ocds-h6vhtk-TEST01',
      id: '000001-2026',
      date: '2026-10-09T00:00:00+01:00',
      tender: {
        id: 'T-1',
        title: 'Marine Research Services',
        status: 'active',
        tenderPeriod: { endDate: '2026-12-31T12:00:00Z' },
        procurementMethod: 'open',
      },
      buyer: { name: 'Test Buyer' },
    },
    {
      ocid: 'ocds-h6vhtk-TEST02',
      id: '000002-2026',
      date: '2026-10-08T00:00:00+01:00',
      tender: { id: 'T-2', title: 'Completed Test Framework', status: 'complete', procurementMethod: 'selective' },
      buyer: { name: 'Test Buyer' },
    },
  ],
})

function clients(): LiveMatchClients {
  return {
    gleif: async () => ({ ok: true, status: 200, body: GLEIF_BODY }),
    grantsgov: async () => ({ ok: true, status: 200, body: GRANTS_BODY }),
    fts: async () => ({ ok: true, status: 200, body: FTS_BODY }),
  }
}

test('verified companies are admitted, others rejected, and funding matches carry evidence', async () => {
  const result = await runLiveMatchCheck({ companyQuery: 'General Electric', requestedAt: REQUESTED_AT }, clients())

  assert.equal(result.errors.length, 0)
  assert.equal(result.companies.length, 1)
  assert.equal(result.companies[0].companyId, 'LEI-3C7474T6CDKPR9K6YT90')
  assert.equal(result.companies[0].country, 'United States')
  assert.equal(result.gleifRejected.length, 1)

  assert.equal(result.fundingEvaluated, 1)
  assert.equal(result.fundingActionable.length, 1)
  assert.equal(result.fundingExcluded, 0)

  const proposed = result.fundingProposals.filter((p) => p.status === 'PROPOSED')
  assert.equal(proposed.length, 1)
  assert.deepEqual([...proposed[0].matchedSignals], ['country-compatibility'])
  assert.ok(proposed[0].missingSignals.includes('industry-overlap'))
  assert.ok(proposed[0].proposalId.startsWith('MP:MATCH-RULES-v1:363929:LEI-'))
})

test('procurement notices are evaluated separately with honest missing evidence', async () => {
  const result = await runLiveMatchCheck({ companyQuery: 'General Electric', requestedAt: REQUESTED_AT }, clients())

  assert.equal(result.procurementEvaluated, 2)
  assert.equal(result.procurementActionable.length, 1)
  assert.equal(result.procurementExcluded, 1)
  // US company vs GB notice: country mismatches, everything else missing.
  assert.equal(result.procurementProposals.length, 1)
  assert.equal(result.procurementProposals[0].status, 'NOT_A_MATCH')
  assert.ok(result.procurementProposals[0].proposalId.startsWith('PP:PMATCH-RULES-v1:'))
})

test('a blank company query verifies nothing and proposes nothing', async () => {
  let calls = 0
  const counting = clients()
  const result = await runLiveMatchCheck(
    { companyQuery: '   ', requestedAt: REQUESTED_AT },
    { ...counting, gleif: (async () => { calls += 1; return { ok: true, status: 200, body: GLEIF_BODY } }) as LiveMatchClients['gleif'] },
  )
  assert.equal(calls, 0)
  assert.equal(result.companies.length, 0)
  assert.equal(result.fundingProposals.length, 0)
  assert.equal(result.procurementProposals.length, 0)
  assert.ok(result.errors.some((message) => message.includes('legal-name query is required')))
})

test('bridge failures are reported, never filler matches', async () => {
  const result = await runLiveMatchCheck(
    { companyQuery: 'General Electric', requestedAt: REQUESTED_AT },
    {
      gleif: async () => ({ ok: false, status: 502, body: null, errors: [{ code: 'source_failure', message: 'down' }] }),
      grantsgov: async () => { throw new Error('connection refused') },
      fts: async () => ({ ok: false, status: 502, body: null, errors: [{ code: 'source_failure', message: 'down' }] }),
    },
  )
  assert.equal(result.companies.length, 0)
  assert.equal(result.fundingProposals.length, 0)
  assert.equal(result.procurementProposals.length, 0)
  assert.equal(result.errors.length, 3)
})

const SEC_TICKERS_BODY = JSON.stringify({
  0: { cik_str: 40545, ticker: 'GE', title: 'GENERAL ELECTRIC CO' },
})

const SEC_SUBMISSIONS_BODY = JSON.stringify({
  cik: '0000040545',
  name: 'GENERAL ELECTRIC CO',
  sic: '3600',
  sicDescription: 'Electronic & Other Electrical Equipment (No Computer Equip)',
  website: '',
  addresses: { business: { city: 'EVENDALE', stateOrCountryDescription: 'OH' } },
})

function secClient() {
  return (async (request: { cik?: string }) => {
    if (request.cik !== undefined) {
      return { ok: true, status: 200, body: { tickers: '', submissions: SEC_SUBMISSIONS_BODY, resolvedCik: request.cik } }
    }
    return { ok: true, status: 200, body: { tickers: SEC_TICKERS_BODY, submissions: null, resolvedCik: null } }
  }) as LiveMatchClients['sec']
}

test('enrichment adds evidenced industry without changing engine behavior', async () => {
  const base = await runLiveMatchCheck({ companyQuery: 'General Electric', requestedAt: REQUESTED_AT }, clients())
  const enriched = await runLiveMatchCheck(
    { companyQuery: 'General Electric', requestedAt: REQUESTED_AT, enrich: true },
    { ...clients(), sec: secClient() },
  )

  // Backward compatibility: same inputs, same proposals with enrichment off.
  assert.equal(base.enrichments.length, 0)
  assert.deepEqual(
    enriched.fundingProposals.map((p) => [p.proposalId, p.status]),
    base.fundingProposals.map((p) => [p.proposalId, p.status]),
  )
  // Engines are untouched: opportunities carry no industry, so industry-overlap
  // stays missing and no eligibility is claimed from the new attribute.
  assert.equal(enriched.enrichments.length, 1)
  assert.equal(enriched.enrichments[0].enrichment.status, 'enriched')
  assert.ok((enriched.companies[0].industry ?? []).some((i) => i.includes('SIC 3600')))
  const proposed = enriched.fundingProposals.filter((p) => p.status === 'PROPOSED')
  assert.deepEqual([...proposed[0].matchedSignals], ['country-compatibility'])
  assert.ok(
    proposed[0].evidence.every((e) => e.signal !== 'industry-overlap' || e.outcome !== 'matched'),
    'industry must not match without opportunity-side evidence',
  )
})

test('enrichment failure keeps the verified profile and reports honestly', async () => {
  const failing = (async () => ({
    ok: false, status: 502, body: null, errors: [{ code: 'source_failure', message: 'down' }],
  })) as LiveMatchClients['sec']
  const result = await runLiveMatchCheck(
    { companyQuery: 'General Electric', requestedAt: REQUESTED_AT, enrich: true },
    { ...clients(), sec: failing },
  )
  assert.equal(result.companies.length, 1)
  assert.equal(result.companies[0].industry ?? null, null)
  assert.equal(result.fundingProposals.filter((p) => p.status === 'PROPOSED').length, 1)
  assert.ok(result.errors.some((message) => message.includes('SEC enrichment')))
})

test('Phase 12: zero verified companies with actionable opportunities yields zero proposals plus reasons', async () => {
  const empty = {
    gleif: async () => ({ ok: true, status: 200, body: JSON.stringify({ data: [] }) }),
    grantsgov: async () => ({ ok: true, status: 200, body: GRANTS_BODY }),
    fts: async () => ({ ok: true, status: 200, body: FTS_BODY }),
  } as LiveMatchClients
  const result = await runLiveMatchCheck({ companyQuery: 'FlareAI', requestedAt: REQUESTED_AT }, empty)
  assert.equal(result.companies.length, 0)
  assert.equal(result.fundingActionable.length, 1)
  assert.equal(result.fundingProposals.length, 0)
  assert.equal(result.procurementProposals.length, 0)
  assert.equal(result.enrichments.length, 0)
  assert.ok(result.errors.every((message) => !message.includes('SEC enrichment')))
})

test('Phase 12: all-excluded procurement carries states and reasons, never actionability', async () => {
  const result = await runLiveMatchCheck({ companyQuery: 'General Electric', requestedAt: REQUESTED_AT }, clients())
  assert.equal(result.procurementEvaluated, 2)
  assert.equal(result.procurementActionable.length, 1)
  assert.equal(result.procurementExcluded, 1)
  assert.equal(result.procurementExcludedDetails.length, 1)
  assert.equal(result.procurementExcludedDetails[0].recordId, 'ocds-h6vhtk-TEST02')
  assert.equal(result.procurementExcludedDetails[0].state, 'historical')
  assert.ok(result.procurementExcludedDetails[0].reason.length > 0)
})

test('Phase 12: enrichment never bypasses GLEIF verification', async () => {
  const empty = {
    gleif: async () => ({ ok: true, status: 200, body: JSON.stringify({ data: [] }) }),
    grantsgov: async () => ({ ok: true, status: 200, body: GRANTS_BODY }),
    fts: async () => ({ ok: true, status: 200, body: FTS_BODY }),
    sec: async () => ({ ok: true, status: 200, body: { tickers: '{}', submissions: null, resolvedCik: null } }),
  } as unknown as LiveMatchClients
  const result = await runLiveMatchCheck(
    { companyQuery: 'FlareAI', requestedAt: REQUESTED_AT, enrich: true },
    empty,
  )
  assert.equal(result.companies.length, 0)
  assert.equal(result.enrichments.length, 0)
  assert.equal(result.fundingProposals.length, 0)
})

const MULTI_GLEIF_BODY = JSON.stringify({
  data: ['CISCO SETTLEMENT|967600FKSRCBHV580D78|US', 'CISCO CONTRACTING|558600UYSUHGYVUQSJ52|US', 'CISCO NETHERLANDS|724500FF12ZZ70EF9183|NL'].map(
    (row) => {
      const [name, lei, country] = row.split('|')
      return {
        id: lei,
        attributes: {
          lei,
          entity: { legalName: { name }, legalAddress: { country }, status: 'ACTIVE' },
          registration: { status: 'ISSUED' },
        },
      }
    },
  ),
})

function multiClients(): LiveMatchClients {
  return {
    gleif: async () => ({ ok: true, status: 200, body: MULTI_GLEIF_BODY }),
    grantsgov: async () => ({ ok: true, status: 200, body: GRANTS_BODY }),
    fts: async () => ({ ok: true, status: 200, body: FTS_BODY }),
  }
}

test('Phase 12A: several ACTIVE hits are all verified without claiming the intended company', async () => {
  const result = await runLiveMatchCheck({ companyQuery: 'cisco', requestedAt: REQUESTED_AT }, multiClients())
  assert.equal(result.companies.length, 3)
  assert.deepEqual(result.unconfirmedCompanies, [])
  // 3 entities x 1 funding opportunity = 3 evaluated pairs; none asserts intent.
  assert.equal(result.fundingProposals.length, 3)
  assert.ok(
    result.companies.every((company) => company.provenance.status === 'verified'),
    'every evaluated company carries verified provenance',
  )
})

test('Phase 12A: only user-confirmed entities are evaluated; the rest are listed, never run', async () => {
  const confirmed = await runLiveMatchCheck(
    { companyQuery: 'cisco', requestedAt: REQUESTED_AT, confirmedCompanyIds: ['LEI-967600FKSRCBHV580D78'] },
    multiClients(),
  )
  assert.equal(confirmed.companies.length, 1)
  assert.equal(confirmed.companies[0].companyId, 'LEI-967600FKSRCBHV580D78')
  assert.equal(confirmed.unconfirmedCompanies.length, 2)
  assert.ok(confirmed.fundingProposals.every((proposal) => proposal.companyId === 'LEI-967600FKSRCBHV580D78'))
  assert.equal(confirmed.fundingProposals.length, 1)

  const none = await runLiveMatchCheck(
    { companyQuery: 'cisco', requestedAt: REQUESTED_AT, confirmedCompanyIds: [] },
    multiClients(),
  )
  assert.equal(none.companies.length, 0)
  assert.equal(none.unconfirmedCompanies.length, 3)
  assert.equal(none.fundingProposals.length, 0)
  assert.equal(none.procurementProposals.length, 0)
})

test('Phase 12A: pair counts separate evaluations from positive and negative outcomes', async () => {
  const result = await runLiveMatchCheck({ companyQuery: 'cisco', requestedAt: REQUESTED_AT }, multiClients())
  const positive = result.fundingProposals.filter((proposal) => proposal.status === 'PROPOSED')
  const negative = result.fundingProposals.filter((proposal) => proposal.status === 'NOT_A_MATCH')
  assert.equal(result.fundingProposals.length, positive.length + negative.length)
  assert.ok(negative.length > 0, 'expected genuine negative outcomes in this fixture')
  for (const proposal of negative) {
    assert.ok(!proposal.proposalId.includes('PROPOSED'), 'a negative outcome is never labelled positive')
  }
})

test('Phase 15C: valid zero-hit search is distinguished from filtered-out records', async () => {
  const empty = {
    gleif: async () => ({ ok: true, status: 200, body: JSON.stringify({ data: [] }) }),
    grantsgov: async () => ({ ok: true, status: 200, body: GRANTS_BODY }),
    fts: async () => ({ ok: true, status: 200, body: FTS_BODY }),
  } as LiveMatchClients
  const result = await runLiveMatchCheck({ companyQuery: 'FlareAI', requestedAt: REQUESTED_AT }, empty)
  assert.equal(result.gleifRawRecords, 0)
  assert.equal(result.companies.length, 0)
  assert.equal(result.gleifRejected.length, 0)
  assert.equal(result.errors.length, 0, 'a valid empty search reports no error')
  assert.equal(result.fundingActionable.length, 1, 'opportunities are still evaluated')
  assert.equal(result.fundingProposals.length, 0, 'but no company-level evaluations occur')
})

test('Phase 15C: returned-but-unqualified records carry their rejection reasons', async () => {
  const retired = {
    gleif: async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        data: [
          { id: 'R1', attributes: { lei: 'RETIRED0000000000001', entity: { legalName: { name: 'Old Shell Ltd' }, legalAddress: { country: 'GB' }, status: 'INACTIVE' }, registration: { status: 'RETIRED' } } },
        ],
      }),
    }),
    grantsgov: async () => ({ ok: true, status: 200, body: GRANTS_BODY }),
    fts: async () => ({ ok: true, status: 200, body: FTS_BODY }),
  } as LiveMatchClients
  const result = await runLiveMatchCheck({ companyQuery: 'Old Shell', requestedAt: REQUESTED_AT }, retired)
  assert.equal(result.gleifRawRecords, 1)
  assert.equal(result.companies.length, 0)
  assert.equal(result.gleifRejected.length, 1)
  })

test('Phase 15C: transport failure is an error, never a valid zero', async () => {
  const failing = {
    gleif: async () => {
      throw new Error('socket hang up')
    },
    grantsgov: async () => ({ ok: true, status: 200, body: GRANTS_BODY }),
    fts: async () => ({ ok: true, status: 200, body: FTS_BODY }),
  } as unknown as LiveMatchClients
  const result = await runLiveMatchCheck({ companyQuery: 'FlareAI', requestedAt: REQUESTED_AT }, failing)
  assert.equal(result.companies.length, 0)
  assert.ok(result.errors.some((message) => message.includes('GLEIF search failed')))
})
