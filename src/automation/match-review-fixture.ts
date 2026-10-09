/**
 * Match review fixture store — Phase M deterministic demo data.
 *
 * Four review items built through the REAL Phase L engine (`proposeMatches`)
 * and the REAL Phase M decision path (`applyMatchReviewDecision`), frozen and
 * held in memory for the page session:
 *  - water tender × Sarva Jal → PROPOSED → APPROVED (RVW-100);
 *  - water tender × AgriSolar → PROPOSED → PENDING;
 *  - water tender × Northfield → NOT_A_MATCH → REJECTED (RVW-101);
 *  - solar grant × AgriSolar → PROPOSED → PENDING.
 * Company values mirror the real company universe field-for-field; no Vault
 * record is read, written, or created. Decisions survive client-side
 * navigation and reset on reload — persistence is a future layer, as in
 * Phase F.
 */

import type { MatchCompanyRecord, MatchSourceRecord } from './match-proposal'
import { proposeMatches } from './match-proposal'
import type { MatchReviewItem } from './match-review'
import { applyMatchReviewDecision, createMatchReviewItem } from './match-review'

export const MATCH_REVIEW_FIXTURE_CREATED_AT = '2026-10-07T00:00:00.000Z'
const DECIDED_AT_APPROVE = '2026-10-10T00:00:00.000Z'
const DECIDED_AT_REJECT = '2026-10-11T00:00:00.000Z'
const REVIEWER_APPROVE = 'RVW-100'
const REVIEWER_REJECT = 'RVW-101'

/* Real company-universe values, mirrored without importing the data layer. */
const AGRISOLAR: MatchCompanyRecord = {
  companyId: 'COMP-001',
  name: 'DEMO — AgriSolar Systems Private Limited',
  country: 'India',
  industries: ['Agricultural technology', 'Renewable energy', 'Manufacturing'],
  description:
    'FICTIONAL DEMONSTRATION PROFILE. AgriSolar is an invented company. It designs and manufactures small solar-powered irrigation pumping units and cold-storage enclosures for smallholder farmers, and services them through regional technicians. Every figure on this record is illustrative and fabricated. This is not a real company, not a real client of TVB, and not based on any actual business.',
  capabilities: [
    'Solar photovoltaic pumping systems',
    'IoT remote monitoring',
    'Cold-chain storage enclosures',
    'Decentralised rural electrification',
    'Farmer cold-chain infrastructure',
    'Water-efficient irrigation',
    'Udyam registration (illustrative, fictional)',
    'ISO 9001 (illustrative, fictional)',
  ],
}

const NORTHFIELD: MatchCompanyRecord = {
  companyId: 'COMP-002',
  name: 'DEMO — Northfield Robotics Inc',
  country: 'USA',
  industries: ['Industrial automation', 'Robotics', 'Advanced manufacturing'],
  description:
    'FICTIONAL DEMONSTRATION PROFILE. Northfield is an invented company. It designs and integrates robotic inspection and material-handling systems for automotive and aerospace component manufacturers, with a service arm supplying replacement grippers and vision hardware. Every figure on this record is illustrative and fabricated. This is not a real company, not a real client of TVB, and not based on any actual business.',
  capabilities: [
    'Computer vision inspection',
    'Collaborative robotics',
    'Industrial control software',
    'Automated quality inspection',
    'Warehouse automation',
    'Aerospace component inspection',
  ],
}

const SARVAJAL: MatchCompanyRecord = {
  companyId: 'COMP-003',
  name: 'DEMO — Sarva Jal Technologies LLP',
  country: 'India',
  industries: ['Water technology', 'Sanitation', 'Environment services'],
  description:
    'FICTIONAL DEMONSTRATION PROFILE. Sarva Jal is an invented company. It designs low-cost ceramic water filter modules for rural community water systems and provides installation and maintenance services through local partners. Every figure on this record is illustrative and fabricated. This is not a real company, not a real client of TVB, and not based on any actual business.',
  capabilities: [
    'Ceramic ultrafiltration',
    'Point-of-use water treatment',
    'Remote water quality sensing',
    'Rural drinking water supply',
    'Greywater reuse',
  ],
}

const COMPANIES: Readonly<Record<string, MatchCompanyRecord>> = Object.freeze({
  'COMP-001': AGRISOLAR,
  'COMP-002': NORTHFIELD,
  'COMP-003': SARVAJAL,
})

const WATER_TENDER: MatchSourceRecord = {
  recordId: 'FX-M-3001',
  recordType: 'notice',
  name: 'Fixture Rural Water Supply Tender',
  country: 'India',
  industries: ['Water technology', 'Sanitation'],
  description: 'Rural community water supply works.',
}

const SOLAR_GRANT: MatchSourceRecord = {
  recordId: 'FX-M-3002',
  recordType: 'opportunity',
  name: 'Fixture Solar Irrigation Grant',
  country: 'India',
  industries: ['Energy'],
  description: null,
}

function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
  const object = value as Record<string, unknown>
  for (const key of Object.keys(object)) {
    const child = object[key]
    if (child !== null && typeof child === 'object') deepFreeze(child)
  }
  return Object.freeze(object) as T
}

function buildItems(): readonly MatchReviewItem[] {
  const water = proposeMatches(WATER_TENDER, [SARVAJAL, AGRISOLAR, NORTHFIELD])
  const solar = proposeMatches(SOLAR_GRANT, [AGRISOLAR])
  const names: Readonly<Record<string, string>> = Object.freeze({
    'FX-M-3001': 'Fixture Rural Water Supply Tender',
    'FX-M-3002': 'Fixture Solar Irrigation Grant',
  })
  const items = [...water, ...solar].map((proposal) =>
    createMatchReviewItem(proposal, {
      companyName: COMPANIES[proposal.companyId]?.name ?? null,
      sourceName: names[proposal.sourceRecordId] ?? null,
      createdAt: MATCH_REVIEW_FIXTURE_CREATED_AT,
    }),
  )
  const approved = applyMatchReviewDecision(items[0], {
    proposalId: items[0].proposal.proposalId,
    decision: 'APPROVED',
    reviewerId: REVIEWER_APPROVE,
    decidedAt: DECIDED_AT_APPROVE,
  })
  const rejected = applyMatchReviewDecision(items[2], {
    proposalId: items[2].proposal.proposalId,
    decision: 'REJECTED',
    reviewerId: REVIEWER_REJECT,
    decidedAt: DECIDED_AT_REJECT,
    reason: 'No sector or location overlap with Northfield.',
  })
  return deepFreeze([approved, items[1], rejected, items[3]])
}

let itemsState: readonly MatchReviewItem[] = buildItems()

export interface MatchReviewFixtureStore {
  items(): readonly MatchReviewItem[]
  item(proposalId: string): MatchReviewItem | undefined
  apply(input: {
    proposalId: string
    decision: 'APPROVED' | 'REJECTED'
    reviewerId: string
    decidedAt: string
    reason?: string | null
  }): MatchReviewItem
  reset(): void
}

export const matchReviewFixtureStore: MatchReviewFixtureStore = {
  items(): readonly MatchReviewItem[] {
    return itemsState
  },
  item(proposalId: string): MatchReviewItem | undefined {
    return itemsState.find((item) => item.proposal.proposalId === proposalId)
  },
  apply(input): MatchReviewItem {
    const current = itemsState.find((item) => item.proposal.proposalId === input.proposalId)
    if (current === undefined) {
      throw new Error(`unknown match review proposal: ${input.proposalId}`)
    }
    const updated = applyMatchReviewDecision(current, input)
    itemsState = deepFreeze(itemsState.map((item) => (item === current ? updated : item)))
    return updated
  },
  reset(): void {
    itemsState = buildItems()
  },
}
