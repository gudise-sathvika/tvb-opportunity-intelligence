/**
 * Procurement match review fixture store — Phase Q deterministic demo data.
 *
 * Four review items built through the REAL Phase Q engine
 * (`proposeProcurementMatches`) and the REAL Phase Q decision path
 * (`applyProcurementMatchReviewDecision`), frozen and held in memory for the
 * page session:
 *  - RFB-001 (Rooftop Solar) × COMP-001 (AgriSolar) → PROPOSED → APPROVED (RVW-200);
 *  - RFB-002 (Water-Quality Data) × COMP-003 (Sarva Jal) → PROPOSED → PENDING;
 *  - RFB-001 (Rooftop Solar) × COMP-002 (Northfield) → NOT_A_MATCH → REJECTED (RVW-201);
 *  - RFB-003 (Pump Station) × COMP-003 (Sarva Jal) → PROPOSED → PENDING.
 * Notice and company values are the REAL imported vault records RFB-001…003
 * and COMP-001…003, transcribed field-for-field from the snapshot; no Vault
 * record is read, written, or created. Decisions survive client-side
 * navigation and reset on reload — persistence is a future layer, as in
 * Phase F and Phase M.
 */

import type { ProcurementCompanyRecord, ProcurementSourceRecord } from './procurement-proposal'
import { proposeProcurementMatches } from './procurement-proposal'
import type { ProcurementMatchReviewItem } from './procurement-match-review'
import { applyProcurementMatchReviewDecision, createProcurementMatchReviewItem } from './procurement-match-review'

export const PMATCH_REVIEW_FIXTURE_CREATED_AT = '2026-10-13T00:00:00.000Z'
const DECIDED_AT_APPROVE = '2026-10-15T00:00:00.000Z'
const DECIDED_AT_REJECT = '2026-10-16T00:00:00.000Z'
const REVIEWER_APPROVE = 'RVW-200'
const REVIEWER_REJECT = 'RVW-201'

/* Real COMP-001…003 company-universe values, transcribed from the snapshot. */
const AGRISOLAR: ProcurementCompanyRecord = {
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

const NORTHFIELD: ProcurementCompanyRecord = {
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
    'Small Business Administration size-standard self-certification (illustrative, fictional)',
  ],
}

const SARVAJAL: ProcurementCompanyRecord = {
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

const COMPANIES: Readonly<Record<string, ProcurementCompanyRecord>> = Object.freeze({
  'COMP-001': AGRISOLAR,
  'COMP-002': NORTHFIELD,
  'COMP-003': SARVAJAL,
})

/* Real RFB-001…003 notice values, transcribed from the snapshot. */
const ROOFTOP_SOLAR: ProcurementSourceRecord = {
  recordId: 'RFB-001',
  recordType: 'notice',
  name: 'DEMO — Rooftop Solar Installation — Works Framework',
  country: 'India',
  industries: ['Renewable energy'],
  description:
    'FICTIONAL DEMONSTRATION RECORD. Supply and installation of rooftop solar photovoltaic systems for three demonstration sites, including mounting structure, inverter, cabling, commissioning, and a two-year defect liability period. Nothing in this record describes a real tender.',
}

const WATER_QUALITY: ProcurementSourceRecord = {
  recordId: 'RFB-002',
  recordType: 'notice',
  name: 'DEMO — Water-Quality Data Analysis Services — Multi Lot',
  country: 'India',
  industries: [],
  description:
    'FICTIONAL DEMONSTRATION RECORD. Statistical analysis of a demonstration water-quality dataset across three separate lots, covering data validation, trend analysis, and reporting. Nothing in this record describes a real tender.',
}

const PUMP_STATION: ProcurementSourceRecord = {
  recordId: 'RFB-003',
  recordType: 'notice',
  name: 'DEMO — Pump Station Rehabilitation — Single Source',
  country: 'India',
  industries: [],
  description:
    'FICTIONAL DEMONSTRATION RECORD. Rehabilitation of a single demonstration pumping station, awarded without competition because the demonstration authority holds the sole demonstration licence for the equipment. Nothing in this record describes a real tender.',
}

const NOTICES: Readonly<Record<string, ProcurementSourceRecord>> = Object.freeze({
  'RFB-001': ROOFTOP_SOLAR,
  'RFB-002': WATER_QUALITY,
  'RFB-003': PUMP_STATION,
})

function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
  const object = value as Record<string, unknown>
  for (const key of Object.keys(object)) {
    const child = object[key]
    if (child !== null && typeof child === 'object') deepFreeze(child)
  }
  return Object.freeze(object) as T
}

function buildItems(): readonly ProcurementMatchReviewItem[] {
  const pairs: ReadonlyArray<readonly [ProcurementSourceRecord, ProcurementCompanyRecord]> = [
    [ROOFTOP_SOLAR, AGRISOLAR],
    [WATER_QUALITY, SARVAJAL],
    [ROOFTOP_SOLAR, NORTHFIELD],
    [PUMP_STATION, SARVAJAL],
  ]
  const items = pairs.map(([source, company]) =>
    createProcurementMatchReviewItem(proposeProcurementMatches(source, [company])[0], {
      noticeName: NOTICES[source.recordId]?.name ?? null,
      companyName: COMPANIES[company.companyId]?.name ?? null,
      createdAt: PMATCH_REVIEW_FIXTURE_CREATED_AT,
    }),
  )
  const approved = applyProcurementMatchReviewDecision(items[0], {
    proposalId: items[0].proposal.proposalId,
    decision: 'APPROVED',
    reviewerId: REVIEWER_APPROVE,
    decidedAt: DECIDED_AT_APPROVE,
  })
  const rejected = applyProcurementMatchReviewDecision(items[2], {
    proposalId: items[2].proposal.proposalId,
    decision: 'REJECTED',
    reviewerId: REVIEWER_REJECT,
    decidedAt: DECIDED_AT_REJECT,
    reason: 'No industry or location overlap with Northfield Robotics.',
  })
  return deepFreeze([approved, items[1], rejected, items[3]])
}

let itemsState: readonly ProcurementMatchReviewItem[] = buildItems()

export interface ProcurementMatchReviewFixtureStore {
  items(): readonly ProcurementMatchReviewItem[]
  item(proposalId: string): ProcurementMatchReviewItem | undefined
  apply(input: {
    proposalId: string
    decision: 'APPROVED' | 'REJECTED'
    reviewerId: string
    decidedAt: string
    reason?: string | null
  }): ProcurementMatchReviewItem
  reset(): void
}

export const procurementMatchReviewFixtureStore: ProcurementMatchReviewFixtureStore = {
  items(): readonly ProcurementMatchReviewItem[] {
    return itemsState
  },
  item(proposalId: string): ProcurementMatchReviewItem | undefined {
    return itemsState.find((item) => item.proposal.proposalId === proposalId)
  },
  apply(input): ProcurementMatchReviewItem {
    const current = itemsState.find((item) => item.proposal.proposalId === input.proposalId)
    if (current === undefined) {
      throw new Error(`unknown procurement match review proposal: ${input.proposalId}`)
    }
    const updated = applyProcurementMatchReviewDecision(current, input)
    itemsState = deepFreeze(itemsState.map((item) => (item === current ? updated : item)))
    return updated
  },
  reset(): void {
    itemsState = buildItems()
  },
}