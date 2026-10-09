/**
 * Phase 22 open-opportunity classifier tests.
 *
 * One normalized vocabulary answers "is this record a genuinely-actionable
 * opportunity RIGHT NOW?" for every source. The honesty rules under test:
 *  - open ONLY when the source says open/active, the deadline is a parseable
 *    future date, and the link is official;
 *  - unknown/missing status is never open;
 *  - a missing deadline is unknown, never open;
 *  - a past deadline is expired (or closed when the source says closed);
 *  - awarded / archived / USAspending records are historical, never open;
 *  - forthcoming is its own bucket, never merged into open.
 *
 * Candidates are built through the real Phase C transform over synthetic
 * fixture results — no network, no files, no clock.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  EU_SEDIA_SOURCE_ID,
  FIXTURE_FUNDING_SOURCE_ID,
  GRANTS_GOV_SOURCE_ID,
  TED_SOURCE_ID,
  USA_SPENDING_SOURCE_ID,
} from './registry'
import {
  OPPORTUNITY_STATE_RULE_VERSION,
  OPPORTUNITY_STATES,
  classifyOpportunityState,
  isActionableOpen,
  isOpenState,
  partitionByActionability,
  tedNoticeKind,
} from './opportunity-status'
import { candidateFromRawResult } from './transform'
import { fixtureRequest, makeRaw, syntheticAdapterResult } from './phase-c-fixtures'
import type { DiscoveryCandidate } from './candidate'

const NOW = '2026-10-09T12:00:00.000Z'
const FUTURE = '2026-12-31'
const PAST = '2026-01-01'

const OFFICIAL_GRANTS = 'https://www.grants.gov/search-results-detail/350001'
const OFFICIAL_EU = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/HORIZON-OPEN'
const OFFICIAL_TED = 'https://ted.europa.eu/en/notice/-/detail/123456-2026'

/** Build a real candidate through the Phase C transform, then override flat fields. */
function candidate(overrides: Partial<DiscoveryCandidate>): DiscoveryCandidate {
  const request = fixtureRequest({
    sourceId: FIXTURE_FUNDING_SOURCE_ID,
    domain: 'funding',
    runId: 'RUN-PHASE22',
    requestedAt: NOW,
  })
  const adapterResult = syntheticAdapterResult({
    request,
    sourceName: 'Phase 22 classifier fixture',
    adapterType: 'fixture',
    results: [
      makeRaw({
        sourceUrl: 'https://fixture.invalid/opportunity',
        title: 'Classifier fixture',
        sourceRecordId: 'CV-1',
      }),
    ],
  })
  const raw = adapterResult.results[0] ?? assert.fail('expected a raw result')
  const base = candidateFromRawResult(adapterResult, raw)
  return { ...base, ...overrides }
}

test('the classifier declares a locked rule version and a six-state vocabulary', () => {
  assert.equal(OPPORTUNITY_STATE_RULE_VERSION, 'phase22-1')
  assert.deepEqual(OPPORTUNITY_STATES, ['open', 'forthcoming', 'expired', 'closed', 'historical', 'unknown'])
  assert.equal(isOpenState('open'), true)
  for (const state of ['forthcoming', 'expired', 'closed', 'historical', 'unknown'] as const) {
    assert.equal(isOpenState(state), false)
  }
})

test('Grants.gov: posted + future close + official URL is open; everything else is not', () => {
  const cases: ReadonlyArray<[string, Partial<DiscoveryCandidate>, string]> = [
    [
      'posted, future close, official URL',
      { sourceStatus: 'posted', sourceDeadline: FUTURE, sourceUrl: OFFICIAL_GRANTS },
      'open',
    ],
    [
      'posted but the close date has passed',
      { sourceStatus: 'posted', sourceDeadline: PAST, sourceUrl: OFFICIAL_GRANTS },
      'expired',
    ],
    [
      'posted with no close date',
      { sourceStatus: 'posted', sourceDeadline: null, sourceUrl: OFFICIAL_GRANTS },
      'unknown',
    ],
    [
      'posted but a non-official URL',
      { sourceStatus: 'posted', sourceDeadline: FUTURE, sourceUrl: 'https://example.org/350001' },
      'unknown',
    ],
    ['forecasted', { sourceStatus: 'forecasted', sourceDeadline: FUTURE, sourceUrl: OFFICIAL_GRANTS }, 'forthcoming'],
    ['closed', { sourceStatus: 'closed', sourceDeadline: FUTURE, sourceUrl: OFFICIAL_GRANTS }, 'closed'],
    ['archived', { sourceStatus: 'archived', sourceDeadline: FUTURE, sourceUrl: OFFICIAL_GRANTS }, 'historical'],
    ['missing status', { sourceStatus: null, sourceDeadline: FUTURE, sourceUrl: OFFICIAL_GRANTS }, 'unknown'],
  ]
  for (const [label, overrides, expected] of cases) {
    const verdict = classifyOpportunityState(candidate({ sourceId: GRANTS_GOV_SOURCE_ID, ...overrides }), NOW)
    assert.equal(verdict.state, expected, `Grants.gov ${label}`)
  }
})

test('EU SEDIA: open + future deadline is open; forthcoming and closed are distinct', () => {
  const cases: ReadonlyArray<[string, Partial<DiscoveryCandidate>, string]> = [
    ['open, future deadline, official URL', { sourceStatus: 'open', sourceDeadline: FUTURE, sourceUrl: OFFICIAL_EU }, 'open'],
    ['open but the deadline has passed', { sourceStatus: 'open', sourceDeadline: PAST, sourceUrl: OFFICIAL_EU }, 'expired'],
    ['open with no deadline', { sourceStatus: 'open', sourceDeadline: null, sourceUrl: OFFICIAL_EU }, 'unknown'],
    [
      'open but a non-official URL',
      { sourceStatus: 'open', sourceDeadline: FUTURE, sourceUrl: 'https://example.org/topic' },
      'unknown',
    ],
    ['forthcoming', { sourceStatus: 'forthcoming', sourceDeadline: FUTURE, sourceUrl: OFFICIAL_EU }, 'forthcoming'],
    ['closed', { sourceStatus: 'closed', sourceDeadline: FUTURE, sourceUrl: OFFICIAL_EU }, 'closed'],
    ['unmapped status', { sourceStatus: null, sourceDeadline: FUTURE, sourceUrl: OFFICIAL_EU }, 'unknown'],
  ]
  for (const [label, overrides, expected] of cases) {
    const verdict = classifyOpportunityState(candidate({ sourceId: EU_SEDIA_SOURCE_ID, ...overrides }), NOW)
    assert.equal(verdict.state, expected, `EU ${label}`)
  }
})

test('TED: only contract notices (cn-*) become opportunities; awards and PIN notices do not', () => {
  const cases: ReadonlyArray<[string, Partial<DiscoveryCandidate>, string]> = [
    [
      'contract notice with a future deadline',
      { sourceRawType: 'cn-standard', sourceDeadline: FUTURE, sourceUrl: OFFICIAL_TED },
      'open',
    ],
    [
      'contract notice whose deadline has passed',
      { sourceRawType: 'cn-standard', sourceDeadline: PAST, sourceUrl: OFFICIAL_TED },
      'expired',
    ],
    [
      'contract notice with no deadline',
      { sourceRawType: 'cn-standard', sourceDeadline: null, sourceUrl: OFFICIAL_TED },
      'unknown',
    ],
    [
      'contract notice with a non-official URL',
      { sourceRawType: 'cn-standard', sourceDeadline: FUTURE, sourceUrl: 'https://example.org/n' },
      'unknown',
    ],
    ['contract-award notice', { sourceRawType: 'can-standard', sourceDeadline: FUTURE, sourceUrl: OFFICIAL_TED }, 'historical'],
    ['voluntary ex-ante notice', { sourceRawType: 'veat', sourceDeadline: FUTURE, sourceUrl: OFFICIAL_TED }, 'historical'],
    ['prior-information notice', { sourceRawType: 'pin-only', sourceDeadline: FUTURE, sourceUrl: OFFICIAL_TED }, 'forthcoming'],
    ['no notice type', { sourceRawType: null, sourceDeadline: FUTURE, sourceUrl: OFFICIAL_TED }, 'unknown'],
  ]
  for (const [label, overrides, expected] of cases) {
    const verdict = classifyOpportunityState(candidate({ sourceId: TED_SOURCE_ID, ...overrides }), NOW)
    assert.equal(verdict.state, expected, `TED ${label}`)
  }

  assert.equal(tedNoticeKind('CN-Standard'), 'cn')
  assert.equal(tedNoticeKind('can-standard'), 'can')
  assert.equal(tedNoticeKind('veat'), 'veat')
  assert.equal(tedNoticeKind(null), null)
  assert.equal(tedNoticeKind('  '), null)
})

test('the ingest gate admits only classifier-open records and preserves the rest', () => {
  const openTed = candidate({
    candidateId: 'C-OPEN',
    sourceId: TED_SOURCE_ID,
    sourceRawType: 'cn-standard',
    sourceDeadline: FUTURE,
    sourceUrl: OFFICIAL_TED,
  })
  const awardTed = candidate({
    candidateId: 'C-AWARD',
    sourceId: TED_SOURCE_ID,
    sourceRawType: 'can-standard',
    sourceDeadline: null,
    sourceUrl: OFFICIAL_TED,
  })
  const noDeadlineTed = candidate({
    candidateId: 'C-NODATE',
    sourceId: TED_SOURCE_ID,
    sourceRawType: 'cn-standard',
    sourceDeadline: null,
    sourceUrl: OFFICIAL_TED,
  })
  const pinTed = candidate({
    candidateId: 'C-PIN',
    sourceId: TED_SOURCE_ID,
    sourceRawType: 'pin-only',
    sourceDeadline: FUTURE,
    sourceUrl: OFFICIAL_TED,
  })

  assert.equal(isActionableOpen(openTed, NOW), true)
  assert.equal(isActionableOpen(awardTed, NOW), false)
  assert.equal(isActionableOpen(noDeadlineTed, NOW), false)
  assert.equal(isActionableOpen(pinTed, NOW), false)

  const input = [openTed, awardTed, noDeadlineTed, pinTed]
  const { actionable, excluded } = partitionByActionability(input, NOW)
  assert.deepEqual(
    actionable.map((c) => c.candidateId),
    ['C-OPEN'],
  )
  assert.deepEqual(
    excluded.map((c) => c.candidateId),
    ['C-AWARD', 'C-NODATE', 'C-PIN'],
  )
  assert.equal(actionable.length + excluded.length, input.length, 'no record is dropped')
})

test('USAspending is always historical and an unknown source is never open', () => {
  const usaspending = classifyOpportunityState(
    candidate({ sourceId: USA_SPENDING_SOURCE_ID, sourceStatus: null, sourceDeadline: null }),
    NOW,
  )
  assert.equal(usaspending.state, 'historical')

  const unknownSource = classifyOpportunityState(
    candidate({ sourceId: 'SU-UNKNOWN-999', sourceStatus: 'open', sourceDeadline: FUTURE }),
    NOW,
  )
  assert.equal(unknownSource.state, 'unknown')
  assert.equal(isOpenState(unknownSource.state), false)
})
