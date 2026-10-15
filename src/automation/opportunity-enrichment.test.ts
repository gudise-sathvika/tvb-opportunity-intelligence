/**
 * Phase 09 opportunity enrichment tests — fully offline, synthetic payloads.
 *
 * Rules under test: only source-published fields are extracted, every value
 * carries evidence, gaps stay unknown with reasons, malformed payloads never
 * throw, and unknown sources yield empty enrichment.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { enrichOpportunityEvidence } from './opportunity-enrichment'
import type { RawResult } from './types'
import { EU_SEDIA_SOURCE_ID, FTS_SOURCE_ID, GRANTS_GOV_SOURCE_ID, TED_SOURCE_ID } from './registry'

const RETRIEVED_AT = '2026-10-14T00:00:00.000Z'

function raw(sourceId: string, payload: unknown, sourceUrl = 'https://official.invalid/record'): RawResult {
  return {
    sourceRecordId: 'R-1',
    sourceUrl,
    title: 'Test opportunity',
    description: null,
    publicationDate: null,
    deadline: null,
    issuingOrganization: null,
    country: null,
    rawType: null,
    rawPayload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    rawProvenance: { sourceId, sourceUrl, sourceRecordId: 'R-1', observedAt: RETRIEVED_AT, queryTerm: null },
  }
}

test('Grants.gov extracts assistance listings and states the applicant-type gap', () => {
  const out = enrichOpportunityEvidence(
    raw(GRANTS_GOV_SOURCE_ID, { id: '1', cfdaList: ['11.061', '11.061'], docType: 'synopsis' }),
    RETRIEVED_AT,
  )
  assert.deepEqual(out.programmes, ['11.061'])
  assert.equal(out.applicantTypes, null)
  assert.ok(out.notes.some((note) => note.includes('applicant-type')))
  assert.ok(out.evidence.every((item) => item.retrievedAt === RETRIEVED_AT && item.sourceUrl.length > 0))
})

test('EU SEDIA extracts programme, sector, budget and deadline-model evidence', () => {
  const out = enrichOpportunityEvidence(
    raw(EU_SEDIA_SOURCE_ID, {
      frameworkProgramme: 'Horizon Europe',
      callTitle: 'Call 2027-01',
      keywords: ['digital', 'digital', 'health'],
      typesOfAction: ['Research and Innovation Actions'],
      budgetOverview: 'EUR 10 million',
      deadlineModel: 'single-stage',
    }),
    RETRIEVED_AT,
  )
  assert.deepEqual(out.programmes, ['Horizon Europe', 'Call 2027-01'])
  assert.deepEqual(out.sectors, ['digital', 'health', 'Research and Innovation Actions'])
  assert.equal(out.budget, 'EUR 10 million')
  assert.ok(out.lifecycleNotes.some((note) => note.includes('single-stage')))
})

test('TED extracts CPV and contract nature as categories', () => {
  const out = enrichOpportunityEvidence(
    raw(TED_SOURCE_ID, { 'classification-cpv': ['48180000'], 'contract-nature': 'services' }),
    RETRIEVED_AT,
  )
  assert.deepEqual(out.categories, ['48180000', 'services'])
})

test('FTS extracts method, value, documents, amendments and award context', () => {
  const out = enrichOpportunityEvidence(
    raw(FTS_SOURCE_ID, {
      tender: {
        procurementMethod: 'open',
        procurementMethodDetails: 'Open procedure',
        value: { amount: 958333, currency: 'GBP' },
        documents: [{ title: 'Specification', url: 'https://docs.invalid/spec.pdf' }],
        amendments: [{ rationale: 'Deadline extended by one week' }],
      },
      awards: [{ status: 'active' }],
      contracts: [{ id: 'C-1' }],
    }),
    RETRIEVED_AT,
  )
  assert.deepEqual(out.categories, ['open', 'Open procedure'])
  assert.equal(out.value, '958333 GBP')
  assert.equal(out.documents.length, 1)
  assert.equal(out.documents[0].url, 'https://docs.invalid/spec.pdf')
  assert.ok(out.lifecycleNotes.some((note) => note.includes('Deadline extended')))
  assert.ok(out.lifecycleNotes.some((note) => note.includes('historical context')))
})

test('missing fields stay unknown and malformed payloads never throw', () => {
  const empty = enrichOpportunityEvidence(raw(FTS_SOURCE_ID, { tender: null }), RETRIEVED_AT)
  assert.equal(empty.categories, null)
  assert.ok(empty.notes.length > 0)
  const broken = enrichOpportunityEvidence(raw(GRANTS_GOV_SOURCE_ID, '{not json'), RETRIEVED_AT)
  assert.equal(broken.programmes, null)
  const unknown = enrichOpportunityEvidence(raw('SU-XX-999', { a: 1 }), RETRIEVED_AT)
  assert.equal(unknown.programmes, null)
  assert.ok(unknown.notes.some((note) => note.includes('no evidence extractor')))
})

test('Phase 14: EU action/MGA types and criterion links become evidenced programmes', () => {
  const out = enrichOpportunityEvidence(
    raw(EU_SEDIA_SOURCE_ID, {
      frameworkProgramme: 'Horizon Europe',
      actions: [
        JSON.stringify({ types: [{ typeOfAction: 'HORIZON-CSA HORIZON Coordination and Support Actions', typeOfMGA: [{ abbreviation: 'HORIZON-AG-LS', description: 'HORIZON Lump Sum Grant' }] }] }),
      ],
      links: JSON.stringify([
        { callIdentifier: 'HORIZON-CL4-2027-01', criterionCode: 'HORIZON-CSA', criterionDescription: 'Coordination and Support', url: 'https://ec.europa.eu/research/participants/submission/manage/screen/submission/create-draft/46820' },
        { criterionCode: 'X', url: 'https://evil.invalid/phish' },
      ]),
      topicConditions: '<div>General conditions</div>',
    }),
    RETRIEVED_AT,
  )
  assert.ok(out.programmes?.includes('Horizon Europe'))
  assert.ok(out.programmes?.includes('HORIZON-CSA HORIZON Coordination and Support Actions'))
  assert.ok(out.programmes?.includes('HORIZON-AG-LS'))
  assert.equal(out.documents.length, 1)
  assert.ok(out.documents[0].url.startsWith('https://ec.europa.eu/'))
  // Phase 24: the block has no h4 sections, so it stays honestly undescribed.
  assert.ok(out.notes.some((note) => note.includes('no parseable section headings')))
})

test('Phase 14: unparseable EU actions/links stay unknown without throwing', () => {
  const out = enrichOpportunityEvidence(
    raw(EU_SEDIA_SOURCE_ID, { actions: ['{broken json'], links: ['[1,2'] }),
    RETRIEVED_AT,
  )
  assert.ok(out.notes.some((note) => note.includes('no parseable action')))
  assert.ok(out.notes.some((note) => note.includes('no criterion or submission links')))
})

test('Phase 24: EU eligibility section headings and official document hrefs are extracted', () => {
  const out = enrichOpportunityEvidence(
    raw(EU_SEDIA_SOURCE_ID, {
      topicConditions: [
        '<div><h4>General conditions</h4><h4>2. Eligible Countries</h4><p>See <a href="https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/horizon/guidance/programme-guide_horizon_en.pdf">guide</a> and <a href="https://evil.invalid/x">phish</a></p></div>',
      ],
    }),
    RETRIEVED_AT,
  )
  assert.ok(out.lifecycleNotes.some((note) => note.includes('2. Eligible Countries')))
  assert.equal(out.documents.length, 1)
  assert.ok(out.documents[0].url.includes('programme-guide_horizon_en.pdf'))
  assert.ok(out.notes.some((note) => note.includes('pointers only')))
})

test('Phase 24: missing or heading-free conditions blocks stay honest', () => {
  const missing = enrichOpportunityEvidence(raw(EU_SEDIA_SOURCE_ID, {}), RETRIEVED_AT)
  assert.ok(missing.notes.some((note) => note.includes('no admissibility-conditions block')))
  const noHeadings = enrichOpportunityEvidence(
    raw(EU_SEDIA_SOURCE_ID, { topicConditions: ['<div><p>no sections here</p></div>'] }),
    RETRIEVED_AT,
  )
  assert.ok(noHeadings.notes.some((note) => note.includes('no parseable section headings')))
})

test('Phase 25: HTML eligibility sections yield verbatim traced excerpts', async () => {
  const { extractDocumentEvidence } = await import('./opportunity-enrichment')
  const html = '<div><h4>2. Eligible Countries</h4><p>Entities from EU Member States and associated countries may apply.</p><h4>Budget</h4><p>EUR 10 million.</p></div>';
  const out = extractDocumentEvidence(html, 'text/html', 'https://ec.europa.eu/x/topic', RETRIEVED_AT)
  assert.equal(out.status, 'explicitly_stated')
  assert.equal(out.findings.length, 1)
  assert.ok(out.findings[0].excerpt.includes('EU Member States'))
  assert.ok((out.findings[0].section ?? '').includes('Eligible Countries'))
  assert.equal(out.retrievedAt, RETRIEVED_AT)
})

test('Phase 25: PDFs, missing content, and irrelevant HTML stay honest', async () => {
  const { extractDocumentEvidence } = await import('./opportunity-enrichment')
  assert.equal(extractDocumentEvidence(null, null, 'https://ec.europa.eu/x.pdf', RETRIEVED_AT).status, 'document_unavailable')
  const pdf = extractDocumentEvidence('%PDF-1.4...', 'application/pdf', 'https://ec.europa.eu/x/guide.pdf', RETRIEVED_AT)
  assert.equal(pdf.status, 'unsupported_format')
  assert.equal(pdf.findings.length, 0)
  const none = extractDocumentEvidence('<div><h4>Budget</h4><p>EUR 10 million.</p></div>', 'text/html', 'https://ec.europa.eu/x', RETRIEVED_AT)
  assert.equal(none.status, 'not_found_in_examined_section')
})

test('Phase 26: EU enrichment carries verbatim document findings from retrieved HTML', () => {
  const out = enrichOpportunityEvidence(
    raw(EU_SEDIA_SOURCE_ID, {
      topicConditions: [
        '<div><h4>2. Eligible Countries</h4><p>Entities from EU Member States may apply.</p></div>',
      ],
    }),
    RETRIEVED_AT,
  )
  assert.equal(out.documentFindings.length, 1)
  assert.ok(out.documentFindings[0].excerpt.includes('EU Member States'))
  assert.ok((out.documentFindings[0].section ?? '').includes('Eligible Countries'))
})

test('Phase 26: empty conditions block yields no findings, only an honest note', () => {
  const out = enrichOpportunityEvidence(raw(EU_SEDIA_SOURCE_ID, {}), RETRIEVED_AT)
  assert.deepEqual(out.documentFindings, [])
})

test('Phase 34 (procurement): enquiry/award period ends surface as lifecycle evidence, never as deadline', () => {
  const out = enrichOpportunityEvidence(
    raw(FTS_SOURCE_ID, {
      tender: {
        status: 'active',
        procurementMethod: 'open',
        enquiryPeriod: { endDate: '2026-10-12T17:00:00+01:00' },
        awardPeriod: { endDate: '2027-05-02T23:59:59+01:00' },
      },
    }),
    RETRIEVED_AT,
  )
  assert.ok(out.lifecycleNotes.some((note) => note.includes('enquiries close: 2026-10-12') && note.includes('not the submission deadline')))
  assert.ok(out.lifecycleNotes.some((note) => note.includes('award activity ends: 2027-05-02')))
})

test('Phase 34 (procurement): complete notices without any periods stay honestly dateless', () => {
  const out = enrichOpportunityEvidence(
    raw(FTS_SOURCE_ID, { tender: { status: 'complete', procurementMethod: 'selective' } }),
    RETRIEVED_AT,
  )
  assert.ok(!out.lifecycleNotes.some((note) => note.includes('enquiries close') || note.includes('award activity ends')))
  assert.ok(out.lifecycleNotes.some((note) => note.includes('historical context')) || out.notes.length > 0)
})
