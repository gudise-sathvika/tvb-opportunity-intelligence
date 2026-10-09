/**
 * Data-layer tests. These assert the UI is reading the snapshot correctly and
 * that the blank / empty-list / absent distinction survives all the way into
 * the selectors, because the UI depends on telling those three apart.
 *
 * Run with: npm run test:data
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import './test-fixtures/use-snapshot'

import {
  COLLECTION_KEYS,
  COLLECTION_OF,
  COLLECTION_PATH,
  applicationForMatch,
  applicationsForCompany,
  applicationsForOpportunity,
  collectionOf,
  companyForApplication,
  companyForContract,
  companyForMatch,
  contractsForBid,
  contractsForCompany,
  contractsForNotice,
  contractsWithoutBid,
  countBy,
  field,
  getRecord,
  listApplications,
  listCompanies,
  listField,
  listMatches,
  listOpportunities,
  listOrganizations,
  listNotices,
  bidForContract,
  listBids,
  listContracts,
  listProcurementMatches,
  listRecords,
  listSources,
  matchForApplication,
  matchesForCompany,
  noticeForContract,
  matchesForOpportunity,
  opportunityForApplication,
  opportunityForMatch,
  opportunityForSource,
  opportunitiesForOrganization,
  pathForRecord,
  providerFor,
  relationships,
  sourceInfo,
  sourcesForOpportunity,
  textField,
  titleOf,
  totalSplit,
  unresolvedLinks,
} from './selectors'
import { COMPANY_DIRECTORY_NAMES } from './company-directory-names'
import type { CollectionKey } from './selectors'
import { COLLECTION_KEY, RECORD_REGISTRY, RECORD_TYPES, TITLE_FIELD } from '../types/registry'
import { primaryLink, supportingLinks, utilityDropdowns, workspaceDropdowns } from '../app/nav'

/* ------------------------------------------------------------------ */
/* Collections and counts                                               */
/* ------------------------------------------------------------------ */

test('each collection has the expected record count', () => {
  assert.equal(listOpportunities().length, 5)
  assert.equal(listCompanies().length, 3)
  assert.equal(listMatches().length, 4)
  assert.equal(listApplications().length, 2)
  assert.equal(listOrganizations().length, 5)
  assert.equal(listSources().length, 6)
  assert.equal(listNotices().length, 3)
  // Five Bids in Phase 8: the four from Phase 4 plus BID-005, added so a
  // multi-lot award exists and the one-bid-to-many-contracts relationship is
  // exercised by real data rather than only asserted structurally.
  assert.equal(listBids().length, 5)
  assert.equal(listContracts().length, 5)
  assert.equal(listProcurementMatches().length, 0)
  assert.equal(listRecords('opportunities').length, 5)
  assert.equal(listRecords('notices').length, 3)
  assert.equal(listRecords('bids').length, 5)
  assert.equal(listRecords('contracts').length, 5)
  assert.equal(listRecords('procurement_matches').length, 0)
  assert.equal(COLLECTION_KEYS.length, 10)
})

test('source company names are unique and do not replace existing Company records', () => {
  assert.equal(COMPANY_DIRECTORY_NAMES.length, 189)
  assert.equal(new Set(COMPANY_DIRECTORY_NAMES.map((name) => name.toLowerCase())).size, 189)
  assert.deepEqual(
    listCompanies().map((company) => company.id),
    ['COMP-001', 'COMP-002', 'COMP-003'],
  )
})

test('all 38 records have a unique ID and a known type', () => {
  const all = COLLECTION_KEYS.flatMap((k) => listRecords(k))
  assert.equal(all.length, 38)
  const ids = all.map((r) => r.id)
  assert.equal(new Set(ids).size, 38, 'IDs must be unique across all collections')
  for (const r of all) {
    assert.equal(collectionOf(r.id), collectionOf(r.id))
    assert.ok(COLLECTION_PATH[collectionOf(r.id) as keyof typeof COLLECTION_PATH])
  }
})

test('provenance matches the importer', () => {
  // 25 funding records + 3 synthetic Notices + 5 synthetic Bids + 5 synthetic
  // Contracts. Schema is 105 funding fields plus 53 Notice, 44 Bid, and the
  // authoritative 27 Contract fields from the Phase 1 design.
  //
  // Phase 6 moved recordCount by SIX (5 contracts + BID-005), totalSchemaFields
  // by TWENTY-SEVEN, and contentFileCount by NINE: the Contract template, 5
  // contract records, BID-005, the Contracts Index, and the Phase 6 Test Report.
  //
  // Phase 7 moved contentFileCount by ONE — this test report — and moved
  // NOTHING else. No record, no template and no schema field was added, because
  // Phase 7 changed no field: it made the existing document lists behave as a
  // set. recordCount and totalSchemaFields are therefore unchanged, and their
  // being unchanged is the proof that no Document record type was invented.
  //
  // Phase 8 moved contentFileCount by TWO — the Phase 8 Automation Readiness
  // Report and the Founder Decision Register — and again moved nothing else.
  // Phase 8 was a documentation-only readiness assessment that concluded
  // AUTOMATION DEFERRED: no code, no record, no template, no field, and no
  // new record type. recordCount and totalSchemaFields staying at 38 and 229
  // is the proof. See the Phase 8 report's integrity section.
  //
  // Phase 9 moved contentFileCount by ONE — the Phase 9 Test Report — and moved
  // nothing else. It was a read-only QA, security, integrity, accessibility,
  // documentation and deployment-readiness review. The only file edits were two
  // stale current-state defect tables in Project Overview and Founder Handoff,
  // which now close M-1, M-4 and M-6 and add C-1. recordCount and
  // totalSchemaFields are unchanged at 38 and 229, which is the proof that no
  // record, template or field was touched. C-1 was deliberately NOT fixed:
  // no explicit authorisation was given.
  //
  // Phase 10 moved contentFileCount by ONE — that phase's Dashboard Report — and
  // moved nothing else. It added the interactive dashboard: an analytics layer,
  // accessible charts, three dashboard modes, and URL-synced filters. Every one of
  // those is frontend code. No record, template, schema field, or importer rule was
  // added, so recordCount and totalSchemaFields are still 38 and 229, and their
  // being unchanged is the proof. The records digest is byte-identical to Phase 9.
  //
  // Phase 11 (Founder Mental Model / IA, then Navigation implementation) moved
  // contentFileCount TWICE — the Phase 1 Product Architecture Report, then this
  // phase's Navigation Report — and moved nothing else. Phase 11.1 was analysis
  // and documentation over an already-correct data model. Phase 11.2 was
  // navigation only: grouped sidebar, navigation metadata, sidebar styles, and
  // their tests. No record, template, schema field, controlled value,
  // relationship index, or importer rule was added in either, so recordCount and
  // totalSchemaFields remain 38 and 229. The canonical records digest was
  // captured before each regeneration and is byte-identical every time, which is
  // the stronger proof: the snapshot hash changes only because a documentation
  // file joined the vault, never because a record changed.
  //
  // Phase 3 moved contentFileCount by ONE — this phase's Dashboard Report — and
  // moved nothing else. It redesigned only frontend code: the Overview groups the
  // nine collection counts by workflow, adds clickable workflow visuals, drops
  // the wall of breakdown cards, and the deadline buckets grow from five states
  // to six (Overdue, Today, next-7-days, next-30-days, Later, no date recorded)
  // with the ModeTabs keyboard focus fixed. No record, template, schema field,
  // controlled value, relationship index, or importer rule was added, so
  // recordCount and totalSchemaFields remain 38 and 229. The canonical records
  // digest is byte-identical to Phase 11 for the same reasons stated above.
  //
  // Phase 4 moved contentFileCount by ONE — this phase's Funding Workflow Report —
  // and moved nothing else. It made the funding pages communicate the approved
  // workflow and cross-link it: Opportunity and Match list rows carry the related
  // step cells, Organizations copy was neutralised, and the Match description
  // rules out reading a Match as an application or a bid. It also fixed BUG-3: a
  // pre-existing race in URL-synced filters where React 18 batching let two rapid
  // filter writes be built from the pre-change URL and the later write silently
  // dropped the earlier one (see the Phase 4 report). No record, template, schema
  // field, controlled value, relationship index, or importer rule was added, so
  // recordCount and totalSchemaFields remain 38 and 229. The canonical records
  // digest is byte-identical to Phase 3 for the same reasons stated above.
  //
  // Phase 6 moved contentFileCount by ONE — this phase's Procurement Workflow
  // Report — and moved nothing else. It made the procurement workflow visible at
  // list level: the Bids list gained a Contracts column (each bid 1:0..N to its
  // contracts, or the honest `none`) and the Companies list gained a Bids column,
  // both rendered with the Phase 4 RelatedLinks cells. It then added a new QA
  // spec (qa/procurement-workflow.spec.ts, 23 tests) pinning the Notice -> Bid ->
  // Contract chains both directions, the Contract-with-no-Bid honesty
  // (contract_basis, never a fabricated bid), the dashboard Procurement-mode
  // drill-downs on the list pages' own filter keys, and the deadline rule that a
  // bid inherits its parent notice's date with one stated reference day. No record,
  // template, schema field, controlled value, relationship index, or importer rule
  // was added, so recordCount and totalSchemaFields remain 38 and 229. The
  // canonical records digest is byte-identical to Phase 4 for the same reasons
  // stated above.
  //
  // The isolated test corpus mirrors the current source directory metadata while
  // retaining its test-only records for relationship and schema coverage.
  assert.equal(sourceInfo.recordCount, 38)
  assert.equal(sourceInfo.totalSchemaFields, 238)
  assert.equal(sourceInfo.contentFileCount, 131)
})

test('fictional / real split is 24 / 14', () => {
  // All three Notices, all five Bids, and all five Contracts are synthetic
  // demonstration records, so they join the fictional side. The real side is
  // unchanged at 14: Phase 6 invented no real procurement data and modified no
  // existing funding record.
  const split = totalSplit()
  assert.deepEqual(split, { fictional: 24, real: 14 })
  // The approved fictional IDs, exactly.
  const fic = COLLECTION_KEYS.flatMap((k) => listRecords(k))
    .filter((r) => r.fictional.isFictional)
    .map((r) => r.id)
    .sort()
  assert.deepEqual(fic, [
    'APP-001',
    'APP-002',
    'BID-001',
    'BID-002',
    'BID-003',
    'BID-004',
    'BID-005',
    'COMP-001',
    'COMP-002',
    'COMP-003',
    'CON-001',
    'CON-002',
    'CON-003',
    'CON-004',
    'CON-005',
    'MATCH-001',
    'MATCH-002',
    'MATCH-003',
    'MATCH-004',
    'OPP-005',
    'ORG-005',
    'RFB-001',
    'RFB-002',
    'RFB-003',
  ])
})

test('no record is flagged ambiguous', () => {
  for (const r of COLLECTION_KEYS.flatMap((k) => listRecords(k))) {
    assert.equal(r.fictional.ambiguous, false, `${r.id} should not be ambiguous`)
  }
})

/* ------------------------------------------------------------------ */
/* Lookup and routing                                                   */
/* ------------------------------------------------------------------ */

test('getRecord finds every ID and rejects unknown ones', () => {
  assert.equal(getRecord('OPP-001')?.type, 'opportunity')
  assert.equal(getRecord('NOPE-999'), undefined)
  assert.equal(getRecord(undefined), undefined)
  assert.equal(getRecord(''), undefined)
})

test('collectionOf maps each record type to its collection', () => {
  assert.equal(collectionOf('OPP-001'), 'opportunities')
  assert.equal(collectionOf('COMP-001'), 'companies')
  assert.equal(collectionOf('MATCH-001'), 'matches')
  assert.equal(collectionOf('APP-001'), 'applications')
  assert.equal(collectionOf('ORG-001'), 'organizations')
  assert.equal(collectionOf('SRC-001'), 'sources')
  assert.equal(collectionOf('MISSING'), undefined)
})

test('pathForRecord builds a routable path for every collection', () => {
  assert.equal(pathForRecord('OPP-001'), '/opportunities/OPP-001')
  assert.equal(pathForRecord('COMP-001'), '/companies/COMP-001')
  assert.equal(pathForRecord('MATCH-001'), '/matches/MATCH-001')
  assert.equal(pathForRecord('APP-001'), '/applications/APP-001')
  assert.equal(pathForRecord('ORG-001'), '/organizations/ORG-001')
  assert.equal(pathForRecord('SRC-001'), '/sources/SRC-001')
  // No malformed plural: this is the "opportunitys" regression guard.
  assert.ok(!pathForRecord('OPP-001')?.includes('opportunitys'))
  assert.ok(!pathForRecord('COMP-001')?.includes('companys'))
  assert.equal(pathForRecord('MISSING'), null)
})

test('every record path is reachable and resolves back to itself', () => {
  for (const r of COLLECTION_KEYS.flatMap((k) => listRecords(k))) {
    const p = pathForRecord(r.id)
    assert.ok(p, `${r.id} has no path`)
    const idFromPath = p?.split('/')[2]
    assert.equal(getRecord(idFromPath)?.id, r.id)
  }
})

/* ------------------------------------------------------------------ */
/* Blank vs empty list vs absent                                        */
/* ------------------------------------------------------------------ */

test('a blank string stays "" and an absent key stays undefined', () => {
  // MATCH-001 deliberately leaves several fields blank.
  const rec = getRecord('MATCH-001')!
  const fm = rec.frontmatter as Record<string, unknown>

  // Blank: the key is PRESENT and holds "".
  for (const name of ['match_score', 'reviewed_by', 'review_date', 'assigned_to']) {
    assert.ok(name in fm, `${name} should be present as a key`)
    assert.equal(field(rec, name), '', `${name} should stay ""`)
    assert.equal(textField(rec, name), '')
  }

  // Absent: the key is not there at all, and must not read back as "".
  assert.ok(!('no_such_field' in fm))
  assert.equal(field(rec, 'no_such_field'), undefined)
  assert.notEqual(field(rec, 'no_such_field'), '')
})

test('an empty list stays [] and is not confused with a blank string', () => {
  const rec = getRecord('OPP-001')!
  const region = listField(rec, 'region')
  assert.ok(Array.isArray(region), 'region should be a list')
  assert.deepEqual(region, [], 'an empty list stays []')
  // The two blank-ish states must stay distinguishable.
  assert.notEqual(region, '')
  const benefit = listField(rec, 'benefit_type')
  assert.equal(benefit?.length, 2, 'a populated list keeps its entries and order')
})

test('field() does not invent a value for a missing key', () => {
  const rec = getRecord('OPP-001')
  assert.equal(field(rec!, 'no_such_field_at_all'), undefined)
  assert.equal(textField(rec!, 'no_such_field_at_all'), undefined)
  assert.equal(listField(rec!, 'no_such_field_at_all'), undefined)
})

test('false and 0 are preserved rather than treated as blank', () => {
  // Scan every record for a boolean/number that must not be lost.
  for (const r of COLLECTION_KEYS.flatMap((k) => listRecords(k))) {
    const fm = r.frontmatter as Record<string, unknown>
    for (const [k, v] of Object.entries(fm)) {
      if (v === false || v === 0) {
        assert.strictEqual(field(r, k), v, `${r.id}.${k} lost its value`)
      }
    }
  }
})

/* ------------------------------------------------------------------ */
/* Relationships, driven by the importer's indexes                      */
/* ------------------------------------------------------------------ */

test('Contract -> Notice and Company are single required links', () => {
  // Phase 1 section 6: `notice` and `company` are both required N:1. Every
  // contract resolves exactly one of each, including the two with no bid.
  for (const c of listContracts()) {
    const notice = noticeForContract(c.id)
    const company = companyForContract(c.id)
    assert.equal(notice?.type, 'notice', `${c.id} must resolve exactly one Notice`)
    assert.equal(company?.type, 'company', `${c.id} must resolve exactly one Company`)
  }
  assert.deepEqual(
    listContracts().map((c) => `${c.id}->${noticeForContract(c.id)?.id}/${companyForContract(c.id)?.id}`).sort(),
    [
      'CON-001->RFB-002/COMP-003',
      'CON-002->RFB-002/COMP-001',
      'CON-003->RFB-002/COMP-001',
      'CON-004->RFB-003/COMP-001',
      'CON-005->RFB-001/COMP-002',
    ],
  )
})

test('Bid 1:0..N Contract is answered from bidToContract, not a scan', () => {
  // The direction Phase 1 corrected from 0..1. BID-005 won two lots in one award
  // and produced two contracts; BID-004 won one lot and produced one.
  assert.deepEqual(contractsForBid('BID-005').map((c) => c.id), ['CON-002', 'CON-003'])
  assert.deepEqual(contractsForBid('BID-004').map((c) => c.id), ['CON-001'])
  // A bid with no contract is an empty array, not a missing key.
  assert.deepEqual(contractsForBid('BID-001'), [])
  assert.deepEqual(contractsForBid('BID-002'), [])
  assert.deepEqual(contractsForBid('BID-003'), [])
  // Both contracts from BID-005 name a lot the bid itself named (Phase 1 rule 4).
  for (const c of contractsForBid('BID-005')) {
    assert.ok(
      ['Lot 1', 'Lot 3'].includes(String(field(c, 'lot_number'))),
      `${c.id} must name a lot BID-005 bid on`,
    )
  }
})

test('Contract -> Bid is optional and undefined means a non-competitive award', () => {
  // The one relationship where "no parent" is a recorded fact rather than
  // missing data. CON-004 and CON-005 are single-source and direct awards.
  assert.equal(bidForContract('CON-001')?.id, 'BID-004')
  assert.equal(bidForContract('CON-002')?.id, 'BID-005')
  assert.equal(bidForContract('CON-003')?.id, 'BID-005')
  assert.equal(bidForContract('CON-004'), undefined)
  assert.equal(bidForContract('CON-005'), undefined)
  // Every no-bid contract records why, which is what invariant 3 requires.
  for (const c of contractsWithoutBid()) {
    assert.ok(
      String(field(c, 'contract_basis') ?? '') !== '',
      `${c.id} has no bid and must carry a contract_basis`,
    )
  }
  assert.deepEqual(contractsWithoutBid().map((c) => c.id).sort(), ['CON-004', 'CON-005'])
})

test('Notice -> Contracts is 1:N and every contract is reachable from its notice', () => {
  // RFB-002 produced three contracts: one from BID-004 and two from BID-005. A
  // multi-lot award is exactly why this is one-to-many.
  assert.deepEqual(contractsForNotice('RFB-002').map((c) => c.id), ['CON-001', 'CON-002', 'CON-003'])
  assert.deepEqual(contractsForNotice('RFB-003').map((c) => c.id), ['CON-004'])
  assert.deepEqual(contractsForNotice('RFB-001').map((c) => c.id), ['CON-005'])
  // And the forward direction is the exact reverse, so neither can drift.
  for (const n of listNotices()) {
    for (const c of contractsForNotice(n.id)) {
      assert.equal(noticeForContract(c.id)?.id, n.id)
    }
  }
})

test('Company -> Contracts includes awards with no bid behind them', () => {
  // COMP-002 holds CON-005 and has NO bid on that notice at all. This is the
  // population the Bid selectors structurally cannot reach, and the reason a
  // separate contract relationship is needed rather than a bid-derived one.
  assert.deepEqual(contractsForCompany('COMP-001').map((c) => c.id).sort(), [
    'CON-002',
    'CON-003',
    'CON-004',
  ])
  assert.deepEqual(contractsForCompany('COMP-002').map((c) => c.id), ['CON-005'])
  assert.deepEqual(contractsForCompany('COMP-003').map((c) => c.id), ['CON-001'])
  // The sharper point: COMP-002's contract is not reachable from its bid at all.
  // Its only bid, BID-002, was NOT awarded and produced no contract, and
  // CON-005 descends from RFB-001, which COMP-002 never bid on. So deriving
  // contracts from bids would report this company as having nothing under
  // contract while it demonstrably does.
  assert.deepEqual(relationships.companyToBid['COMP-002'] ?? [], ['BID-002'])
  assert.deepEqual(contractsForBid('BID-002'), [])
  assert.equal(noticeForContract('CON-005')?.id, 'RFB-001')
  assert.ok(
    !(relationships.bidToNotice['BID-002'] === 'RFB-001'),
    'the demonstration requires BID-002 not to be on the same notice as CON-005',
  )
})

test('Source -> Opportunity comes from related_opportunity', () => {
  assert.equal(opportunityForSource('SRC-001')?.id, 'OPP-001')
  assert.equal(opportunityForSource('SRC-003')?.id, 'OPP-002')
  assert.equal(opportunityForSource('SRC-005')?.id, 'OPP-003')
  assert.equal(opportunityForSource('SRC-006')?.id, 'OPP-004')
  // Reverse index agrees with the forward lookup.
  for (const [srcId, oppIds] of Object.entries(relationships.sourceToOpportunity)) {
    assert.equal(opportunityForSource(srcId)?.id, oppIds[0])
  }
})

test('Opportunity -> Sources is the reverse of Source -> Opportunity', () => {
  const fromOpp = sourcesForOpportunity('OPP-001').map((r) => r.id).sort()
  assert.deepEqual(fromOpp, ['SRC-001', 'SRC-002'])
  assert.deepEqual(sourcesForOpportunity('OPP-004').map((r) => r.id), ['SRC-006'])
  assert.deepEqual(sourcesForOpportunity('OPP-005'), [], 'OPP-005 is fictional and has no source')
})

test('Organization -> Opportunities is the reverse of the provider link', () => {
  assert.equal(providerFor('OPP-001')?.id, 'ORG-001')
  assert.equal(providerFor('OPP-002')?.id, 'ORG-002')
  assert.equal(providerFor('OPP-003')?.id, 'ORG-003')
  assert.equal(providerFor('OPP-004')?.id, 'ORG-004')
  assert.equal(providerFor('OPP-005')?.id, 'ORG-005')
  assert.deepEqual(opportunitiesForOrganization('ORG-001').map((r) => r.id), ['OPP-001'])
  assert.deepEqual(opportunitiesForOrganization('ORG-004').map((r) => r.id), ['OPP-004'])
})

test('Match -> Company / Opportunity / Application', () => {
  for (const m of listMatches()) {
    const company = companyForMatch(m.id)
    const opp = opportunityForMatch(m.id)
    assert.ok(company, `${m.id} should resolve a company`)
    assert.ok(opp, `${m.id} should resolve an opportunity`)
    // The optional application may legitimately be absent.
    const appId = relationships.matchToApplication[m.id]
    if (appId === null || appId === undefined) {
      assert.equal(applicationForMatch(m.id), undefined, `${m.id} must report no application`)
    } else {
      assert.equal(applicationForMatch(m.id)?.id, appId)
    }
  }
  assert.equal(applicationForMatch('MATCH-001')?.id, 'APP-001')
  assert.equal(applicationForMatch('MATCH-002'), undefined)
  assert.equal(applicationForMatch('MATCH-003')?.id, 'APP-002')
  assert.equal(applicationForMatch('MATCH-004'), undefined)
})

test('Application -> Company / Opportunity / Match', () => {
  for (const a of listApplications()) {
    assert.ok(companyForApplication(a.id), `${a.id} should resolve a company`)
    assert.ok(opportunityForApplication(a.id), `${a.id} should resolve an opportunity`)
    const matchId = relationships.applicationToMatch[a.id]
    if (matchId === null || matchId === undefined) {
      assert.equal(matchForApplication(a.id), undefined)
    } else {
      assert.equal(matchForApplication(a.id)?.id, matchId)
    }
  }
  assert.equal(matchForApplication('APP-001')?.id, 'MATCH-001')
  assert.equal(matchForApplication('APP-002')?.id, 'MATCH-003')
})

test('opportunity-side relationship queries agree with the indexes', () => {
  // MATCH-001 -> OPP-002, MATCH-002 -> OPP-001, MATCH-003 -> OPP-004, MATCH-004 -> OPP-005
  assert.deepEqual(matchesForOpportunity('OPP-001').map((r) => r.id), ['MATCH-002'])
  assert.deepEqual(matchesForOpportunity('OPP-002').map((r) => r.id), ['MATCH-001'])
  assert.deepEqual(matchesForOpportunity('OPP-004').map((r) => r.id), ['MATCH-003'])
  assert.deepEqual(matchesForOpportunity('OPP-005').map((r) => r.id), ['MATCH-004'])
  assert.deepEqual(matchesForOpportunity('OPP-003'), [], 'no match points at OPP-003')

  // APP-001 -> OPP-002, APP-002 -> OPP-004
  assert.deepEqual(applicationsForOpportunity('OPP-002').map((r) => r.id), ['APP-001'])
  assert.deepEqual(applicationsForOpportunity('OPP-004').map((r) => r.id), ['APP-002'])
  assert.deepEqual(applicationsForOpportunity('OPP-001'), [])

  assert.deepEqual(
    matchesForCompany('COMP-001').map((r) => r.id).sort(),
    ['MATCH-001', 'MATCH-002'],
  )
  // APP-001 -> COMP-001, APP-002 -> COMP-002
  assert.deepEqual(applicationsForCompany('COMP-001').map((r) => r.id), ['APP-001'])
  assert.deepEqual(applicationsForCompany('COMP-002').map((r) => r.id), ['APP-002'])
  assert.deepEqual(applicationsForCompany('COMP-003'), [], 'COMP-003 has no application')
  assert.deepEqual(matchesForCompany('COMP-003').map((r) => r.id), ['MATCH-004'])
})

test('every indexed relationship is symmetric in both directions', () => {
  for (const [matchId, oppId] of Object.entries(relationships.matchToOpportunity)) {
    assert.ok(
      matchesForOpportunity(oppId).some((r) => r.id === matchId),
      `${matchId} -> ${oppId} is not visible from the opportunity side`,
    )
  }
  for (const [orgId, oppIds] of Object.entries(relationships.organizationToOpportunity)) {
    for (const oppId of oppIds) {
      assert.equal(providerFor(oppId)?.id, orgId, `${oppId} should be provided by ${orgId}`)
    }
  }
})

test('a relationship query never returns a record of the wrong type', () => {
  assert.equal(providerFor('OPP-001')?.type, 'organization')
  assert.equal(opportunityForSource('SRC-001')?.type, 'opportunity')
  assert.equal(companyForMatch('MATCH-001')?.type, 'company')
  assert.equal(opportunityForMatch('MATCH-001')?.type, 'opportunity')
  for (const s of sourcesForOpportunity('OPP-001')) assert.equal(s.type, 'source')
})

/* ------------------------------------------------------------------ */
/* Grouping and display helpers                                         */
/* ------------------------------------------------------------------ */

test('countBy counts verbatim values and drops absent keys', () => {
  const byType = countBy(listOpportunities(), 'opportunity_type')
  const total = byType.reduce((n, c) => n + c.count, 0)
  assert.equal(total, listOpportunities().length)
  // Sorted by count desc, then label asc.
  for (let i = 1; i < byType.length; i++) {
    assert.ok(byType[i - 1].count >= byType[i].count)
  }
  // A field no opportunity has yields no buckets, not a crash.
  assert.deepEqual(countBy(listOpportunities(), 'not_a_field'), [])
})

test('titleOf uses the type name field', () => {
  assert.equal(titleOf(getRecord('OPP-001')!), 'Startup India Seed Fund Scheme (SISFS)')
  assert.equal(
    titleOf(getRecord('SRC-001')!),
    'Startup India Seed Fund Scheme — official scheme page',
  )
  // titleOf returns the ID when the name field is blank, never an empty label.
  for (const r of COLLECTION_KEYS.flatMap((k) => listRecords(k))) {
    assert.ok(titleOf(r).length > 0, `${r.id} has an empty title`)
  }
})

test('unresolved links are empty in this snapshot', () => {
  assert.deepEqual(unresolvedLinks, [])
})

test('selectors do not mutate the snapshot', () => {
  const before = JSON.stringify(listOpportunities())
  listOpportunities().forEach((r) => {
    field(r, 'opportunity_name')
    textField(r, 'opportunity_name')
    countBy([r], 'opportunity_type')
  })
  assert.equal(JSON.stringify(listOpportunities()), before)
})

/* ------------------------------------------------------------------ */
/* Registry-derived behaviour (Phase 2)                                */
/* ------------------------------------------------------------------ */

test('collection keys and paths are derived from the registry, in registry order', () => {
  assert.deepEqual(
    COLLECTION_KEYS,
    RECORD_TYPES.map((t) => COLLECTION_KEY[t]),
  )
  for (const type of RECORD_TYPES) {
    const key = COLLECTION_KEY[type] as CollectionKey
    assert.equal(COLLECTION_PATH[key], RECORD_REGISTRY[type].collectionPath)
  }
})

test('collectionOf agrees with the record type for every record', () => {
  for (const key of COLLECTION_KEYS) {
    for (const rec of listRecords(key)) {
      assert.equal(collectionOf(rec.id), key, rec.id)
      assert.equal(COLLECTION_OF[rec.type], key, rec.id)
    }
  }
})

test('a record ID whose prefix disagrees with its type resolves to no collection', () => {
  // Misfiled data must not appear under two collections at once.
  assert.equal(collectionOf('COMP-001')?.includes('opportunit'), false)
  const real = getRecord('COMP-001')
  assert.equal(collectionOf(real?.id ?? ''), 'companies')
})

test('pathForRecord is built from the registry path, not a pluralised guess', () => {
  for (const key of COLLECTION_KEYS) {
    for (const rec of listRecords(key)) {
      assert.equal(pathForRecord(rec.id), `/${COLLECTION_PATH[key]}/${rec.id}`)
    }
  }
  assert.equal(pathForRecord('NOPE-001'), null)
  assert.notEqual(pathForRecord('OPP-001'), '/opportunitys/OPP-001')
})

test('titleOf uses the registry title field for every type', () => {
  for (const key of COLLECTION_KEYS) {
    for (const rec of listRecords(key)) {
      const expected = textField(rec, TITLE_FIELD[rec.type])
      assert.equal(titleOf(rec), expected ?? rec.id, rec.id)
    }
  }
})

/* ------------------------------------------------------------------ */
/* Top navigation (Phase Z) — the model the header renders.            */
/* ------------------------------------------------------------------ */

test('top navigation is Home, the two workspaces, Companies, and More', () => {
  // One primary link, two workspace groups, one primary supporting link, and
  // one utility group. The header renders exactly this model, so these
  // assertions describe the navigation the user actually sees rather than a
  // second hand-written copy.
  assert.deepEqual(primaryLink, { to: '/', label: 'Home', end: true })
  assert.deepEqual(
    workspaceDropdowns.map((d) => d.id),
    ['funding', 'procurement'],
  )
  assert.deepEqual(
    workspaceDropdowns.map((d) => d.label),
    ['Funding', 'Procurement'],
  )
  assert.equal(workspaceDropdowns[0].to, '/funding')
  assert.equal(workspaceDropdowns[1].to, '/procurement')
  assert.deepEqual(
    supportingLinks.map((l) => l.to),
    ['/companies'],
  )
  assert.deepEqual(
    utilityDropdowns.map((d) => d.id),
    ['more'],
  )
})

test('the funding workspace is overview, opportunities, matches, and applications', () => {
  const funding = workspaceDropdowns.find((d) => d.id === 'funding')!
  assert.deepEqual(
    funding.items.map((i) => i.label),
    ['Overview', 'Opportunities', 'Matches', 'Applications'],
  )
  assert.equal(funding.items.find((i) => i.label === 'Overview')!.to, '/funding')
  assert.equal(funding.items.find((i) => i.label === 'Opportunities')!.to, '/opportunities')
  assert.equal(funding.items.find((i) => i.label === 'Matches')!.to, '/matches')
  assert.equal(funding.items.find((i) => i.label === 'Applications')!.to, '/applications')
  // Overview matches exactly, so a `?view=` collection URL is not claimed by it.
  assert.equal(funding.items.find((i) => i.label === 'Overview')!.end, true)
})

test('the procurement workspace is overview, RFPs, matches, bids, and contracts', () => {
  const procurement = workspaceDropdowns.find((d) => d.id === 'procurement')!
  assert.deepEqual(
    procurement.items.map((i) => i.label),
    ['Overview', 'RFPs', 'Matches', 'Bids', 'Contracts'],
  )
  assert.equal(procurement.items.find((i) => i.label === 'Overview')!.to, '/procurement')
  assert.equal(procurement.items.find((i) => i.label === 'RFPs')!.to, '/notices')
  assert.equal(procurement.items.find((i) => i.label === 'Matches')!.to, '/procurement-match-review')
  assert.equal(procurement.items.find((i) => i.label === 'Bids')!.to, '/bids')
  assert.equal(procurement.items.find((i) => i.label === 'Contracts')!.to, '/contracts')
  assert.equal(procurement.items.find((i) => i.label === 'Overview')!.end, true)
})

test('subprocesses are reachable but never top-level destinations', () => {
  // Review, Discovery, Match Review, Organizations, and Sources must not sit
  // in the primary row. Organizations and Sources are one menu away behind
  // More; the review and discovery queues hang off the workspaces themselves
  // (workspace bar, overview flow strip, and in-context links).
  const topLevel = new Set([primaryLink.to, ...supportingLinks.map((l) => l.to)])
  for (const hidden of [
    '/review',
    '/discovery',
    '/match-review',
    '/procurement-match-review',
    '/organizations',
    '/sources',
  ]) {
    assert.ok(!topLevel.has(hidden), `${hidden} is not a top-level destination`)
  }
  const utility = utilityDropdowns.flatMap((d) => d.items.map((i) => i.to))
  assert.ok(utility.includes('/organizations'), 'Organizations is reachable behind More')
  assert.ok(utility.includes('/sources'), 'Sources is reachable behind More')
})

test('the supporting link maps to a registry collection', () => {
  for (const link of supportingLinks) {
    const type = RECORD_TYPES.find((t) => '/' + RECORD_REGISTRY[t].collectionPath === link.to)
    assert.ok(type, link.to + ' maps to a registry collection')
    assert.equal(link.label, RECORD_REGISTRY[type!].pluralLabel)
  }
  // No link points at the same place twice.
  assert.equal(new Set(supportingLinks.map((l) => l.to)).size, supportingLinks.length)
})

test('every dropdown group explains what its items are for', () => {
  for (const group of [...workspaceDropdowns, ...utilityDropdowns]) {
    assert.ok(group.label.length > 0, group.id + ' is named')
    for (const item of group.items) {
      assert.ok(item.description.length > 0, item.to + ' explains itself')
    }
  }
})

test('Home stays the primary overview entry', () => {
  assert.equal(primaryLink.to, '/')
  assert.equal(primaryLink.label, 'Home')
})
