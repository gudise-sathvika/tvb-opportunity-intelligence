/**
 * Dashboard analytics.
 *
 * Every function here is a pure function of the generated snapshot and an explicit
 * reference date. No function reads the clock, the DOM, or the network; the caller
 * passes `today` in. That is what makes every figure on the dashboard reproducible:
 * given the same snapshot and the same reference date, these functions return the
 * same numbers, which is what the unit tests assert.
 *
 * Three rules govern everything in this file.
 *
 * 1. Blanks stay blank. A record with no value for a field is counted in its own
 *    `(blank)` bucket rather than dropped, defaulted to zero, or folded into a
 *    neighbouring value. A distribution that silently omitted blanks would report a
 *    total that does not match the record count.
 *
 * 2. The three Bid axes stay separate. `eligibility_status`, `bid_decision`, and
 *    `bid_status` answer three different questions, so they are grouped and
 *    reported independently and are never combined into one "status".
 *
 * 3. Every figure is traceable. Each returned point carries the `ids` that produced
 *    it, so any chart segment can be drilled down to the exact records behind it
 *    and any test can assert against records rather than against a magic number.
 *
 * Nothing in this file sums money. Contract and Bid amounts are held in several
 * currencies that the vault never converts between, and blank amounts are common,
 * so any total would understate the corpus in a way that reads as a real figure.
 * Counts per currency are provided instead.
 */

import { BLANK } from '../data/blank'
import { attentionItems, companyProcurement, evidenceCoverage, isISODate, noticesWithBids } from '../data/procurement'
import type { AttentionItem } from '../data/procurement'
import {
  applicationsForCompany,
  applicationsForOpportunity,
  bidsForCompany,
  contractsForCompany,
  isFictional,
  listApplications,
  listBids,
  listCompanies,
  listContracts,
  listMatches,
  listNotices,
  listOpportunities,
  listOrganizations,
  listRecords,
  matchesForCompany,
  matchesForOpportunity,
  noticeForBid,
  opportunitiesForOrganization,
  titleOf,
} from '../data/selectors'
import type { CollectionKey } from '../data/selectors'
import { CONTROLLED_VALUES } from '../import/controlled-values'
import type { RecordRow } from '../types/records'

/** Every collection key, in registry order, as a plain list. */
const ALL_COLLECTIONS: readonly CollectionKey[] = [
  'opportunities',
  'companies',
  'matches',
  'applications',
  'organizations',
  'sources',
  'notices',
  'bids',
  'contracts',
]

/**
 * Record id to record, built once.
 *
 * Analytics receive bare id lists so that a chart segment stays a small payload,
 * but the fictional/real split still needs the row. One index beats a scan of all
 * nine collections per call, and it keeps the drill-down ids serialisable.
 */
const BY_ID: ReadonlyMap<string, RecordRow> = (() => {
  const m = new Map<string, RecordRow>()
  for (const key of ALL_COLLECTIONS) for (const r of listRecords(key)) m.set(r.id, r)
  return m
})()

/* ------------------------------------------------------------------ */
/* Shared shape                                                        */
/* ------------------------------------------------------------------ */

/**
 * The label used for records whose field is blank. Never a controlled value.
 *
 * Defined once in `data/blank.ts` and re-exported here so the analytics layer and the
 * list filters cannot drift apart: a drill-down link that selects the blank bucket
 * writes this exact label as the filter value, and it has to match what the filter
 * options say it is called or the link silently matches nothing.
 */
export { BLANK }

/**
 * One slice of a distribution.
 *
 * `count` is the figure to display. `percent` is `count` over the number of
 * records passed in, rounded to one decimal place for display, and is exactly 0
 * when that number is 0 — never `NaN` from a division by zero.
 *
 * `isBlank` exists so a renderer can style and explain the blank bucket without
 * string-matching its label.
 */
export interface SeriesPoint {
  /** The recorded value, verbatim, or `BLANK`. Never re-bucketed or renamed. */
  value: string
  /** Display label. Equal to `value` except where a blank needs explaining. */
  label: string
  count: number
  percent: number
  /** The records behind this figure, in snapshot order. Empty for a zero count. */
  ids: string[]
  fictional: number
  real: number
  isBlank: boolean
}

/** Round to one decimal place, and keep 0 rather than `-0`. */
function round1(n: number): number {
  const r = Math.round(n * 10) / 10
  return Object.is(r, -0) ? 0 : r
}

/** Share of `total` as a percentage, defined as 0 when `total` is 0. */
export function percentOf(count: number, total: number): number {
  return total === 0 ? 0 : round1((count / total) * 100)
}

/**
 * Count the fictional/real split of an id list against a row lookup.
 *
 * An id the lookup does not resolve is counted in neither bucket, because calling
 * it fictional or real would be a guess. Every caller in this file passes ids it
 * just read from the snapshot, so an unresolved id would mean the snapshot changed
 * underneath us; the invariant the tests assert is that `fictional + real` equals
 * the count for all real data.
 */
function splitOf(ids: string[], rows: ReadonlyMap<string, RecordRow>): { fictional: number; real: number } {
  let fictional = 0
  let real = 0
  for (const id of ids) {
    const row = rows.get(id)
    if (!row) continue
    if (isFictional(row)) fictional += 1
    else real += 1
  }
  return { fictional, real }
}

/** Build a point from a bucket of ids. */
function point(
  value: string,
  label: string,
  ids: string[],
  total: number,
  isBlank: boolean,
  rows: ReadonlyMap<string, RecordRow>,
): SeriesPoint {
  return {
    value,
    label,
    count: ids.length,
    percent: percentOf(ids.length, total),
    ids,
    ...splitOf(ids, rows),
    isBlank,
  }
}

/**
 * Group records by one field, as a deterministic distribution.
 *
 * When the field has a controlled vocabulary, every declared value is returned in
 * the schema's own order, including values with a count of zero. A zero is a true
 * statement — the vocabulary defines the state and no record is in it — and
 * omitting it would make the distribution look complete when it is not. Any value
 * present in the data but absent from the vocabulary is appended rather than
 * dropped, so an unexpected value can never disappear from a chart.
 *
 * A blank or absent field becomes its own `(blank)` bucket, placed last so it
 * never reads as part of the vocabulary. Only a genuine string counts as a value,
 * so a number or a list is treated as blank rather than coerced into a label.
 */
export function groupCounts(recs: RecordRow[], fieldName: string): SeriesPoint[] {
  const vocab = CONTROLLED_VALUES[fieldName]
  const ordered: string[] = vocab ? [...vocab] : []
  const seen = new Set(ordered)
  const byValue = new Map<string, string[]>()
  const blankIds: string[] = []
  // Built from the records handed in, not from a global index, so this function is
  // correct for any input rather than only for the current snapshot.
  const rows = new Map(recs.map((r) => [r.id, r]))

  for (const r of recs) {
    const raw = r.frontmatter[fieldName]
    if (typeof raw !== 'string' || raw === '') {
      blankIds.push(r.id)
      continue
    }
    if (!seen.has(raw)) {
      seen.add(raw)
      ordered.push(raw)
    }
    const bucket = byValue.get(raw)
    if (bucket) bucket.push(r.id)
    else byValue.set(raw, [r.id])
  }

  const points = ordered.map((v) => point(v, v, byValue.get(v) ?? [], recs.length, false, rows))
  if (blankIds.length > 0) {
    points.push(point(BLANK, `${BLANK} — no value recorded`, blankIds, recs.length, true, rows))
  }
  return points
}

/* ------------------------------------------------------------------ */
/* Deadline intelligence                                                */
/* ------------------------------------------------------------------ */

/**
 * The look-ahead windows used by `urgencyBuckets`.
 *
 * These are exported and rendered on screen so the thresholds are stated rather
 * than hidden. `data/procurement.ts` deliberately has no "due soon" bucket, because
 * an unstated window would be an invented threshold. A stated window is a different
 * thing: it makes the classification reproducible and lets a reader disagree with
 * the number rather than guess it. 7 and 30 days are the windows used, chosen
 * because both are familiar horizons and both are named wherever they apply.
 */
export const DAYS_SOON = 7
export const DAYS_MONTH = 30

export type Urgency = 'overdue' | 'today' | 'due_soon' | 'due_this_month' | 'due_later' | 'no_date'

export const URGENCY_LABEL: Record<Urgency, string> = {
  overdue: 'Overdue',
  today: 'Today',
  due_soon: `Next ${DAYS_SOON} days`,
  due_this_month: `Next ${DAYS_MONTH} days`,
  due_later: 'Later',
  no_date: 'No deadline recorded',
}

/** Buckets in a fixed, most-urgent-first order. */
export const URGENCY_ORDER: readonly Urgency[] = [
  'overdue',
  'today',
  'due_soon',
  'due_this_month',
  'due_later',
  'no_date',
]

/**
 * Whole days from `today` to `value`, or null when either is not a real date.
 *
 * Both values are parsed at UTC midnight and differenced there, so the result is a
 * whole number of days with no daylight-saving or timezone offset. The vault's
 * dates are date-only strings, so there is no time of day to lose.
 */
export function daysFrom(today: string, value: unknown): number | null {
  if (!isISODate(today) || !isISODate(value)) return null
  const a = Date.parse(`${today}T00:00:00Z`)
  const b = Date.parse(`${value}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/**
 * Classify one date into an urgency bucket against `today`.
 *
 * A date equal to `today` is its own bucket, not `overdue`: a deadline at the end
 * of the current day has not passed yet, and `today` is distinct from the
 * next-seven-days window so a reader can see at a glance what is due this exact
 * day versus what is merely approaching.
 */
export function urgencyOf(value: unknown, today: string): Urgency {
  const days = daysFrom(today, value)
  if (days === null) return 'no_date'
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= DAYS_SOON) return 'due_soon'
  if (days <= DAYS_MONTH) return 'due_this_month'
  return 'due_later'
}

/** A record paired with the one date of interest for its type. */
export interface DatedRecord {
  id: string
  date: unknown
}

/**
 * Bucket dated records into the urgency states.
 *
 * Always returns all five buckets, in `URGENCY_ORDER`, so a dashboard can show a
 * complete distribution rather than only the non-empty parts.
 */
export function urgencyBuckets(dated: DatedRecord[], today: string): SeriesPoint[] {
  const ids: Record<Urgency, string[]> = {
    overdue: [],
    today: [],
    due_soon: [],
    due_this_month: [],
    due_later: [],
    no_date: [],
  }
  for (const d of dated) ids[urgencyOf(d.date, today)].push(d.id)
  return URGENCY_ORDER.map((u) => point(u, URGENCY_LABEL[u], ids[u], dated.length, u === 'no_date', BY_ID))
}

/**
 * The one date field per record type that represents "when something is due".
 *
 * Each entry names a field the schema actually defines. A Bid has no deadline of
 * its own, so it is handled separately by `bidDeadlines`.
 */
export const PRIMARY_DATE_FIELD = {
  opportunities: 'application_deadline',
  matches: 'next_review_date',
  applications: 'application_deadline',
  notices: 'bid_submission_deadline',
  contracts: 'contract_end_date',
} as const

export type DeadlineCollection = keyof typeof PRIMARY_DATE_FIELD

/** Deadlines for one record type, as `{id, date}` pairs. */
export function primaryDeadlines(collection: DeadlineCollection): DatedRecord[] {
  const fieldName = PRIMARY_DATE_FIELD[collection]
  return listRecords(collection).map((r) => ({ id: r.id, date: r.frontmatter[fieldName] }))
}

/**
 * A Bid's deadline is the Notice it pursues, resolved rather than restated.
 *
 * A Bid record has no deadline field, so reading one would always give `no_date`.
 * Resolving the parent Notice is the same reasoning `bidDeadlineState` already
 * uses in `data/procurement.ts`, and a Bid whose Notice is missing stays
 * `no_date` rather than borrowing another notice's date.
 */
export function bidDeadlines(): DatedRecord[] {
  return listBids().map((b) => {
    const notice = noticeForBid(b.id)
    return { id: b.id, date: notice ? notice.frontmatter.bid_submission_deadline : undefined }
  })
}

/* ------------------------------------------------------------------ */
/* Funding mode                                                        */
/* ------------------------------------------------------------------ */

/**
 * One step of the funding pipeline: records that exist, proved by a recorded link.
 *
 * These are counts of records, not conversion rates. The only denominator used is
 * the Opportunity count, because the snapshot does not record a funnel and a rate
 * between two unrelated totals would be invented.
 */
export interface FundingStage {
  label: string
  /** The field or link the stage is derived from, for the tooltip and tests. */
  basis: string
  count: number
  percent: number
  ids: string[]
}

export function fundingPipeline(): FundingStage[] {
  const opportunities = listOpportunities()
  const stages: { label: string; basis: string; ids: string[] }[] = [
    {
      label: 'Opportunities recorded',
      basis: 'the opportunity collection itself',
      ids: opportunities.map((o) => o.id),
    },
    {
      label: 'With at least one Match',
      basis: 'matches.linked_opportunity',
      ids: opportunities.filter((o) => matchesForOpportunity(o.id).length > 0).map((o) => o.id),
    },
    {
      label: 'With at least one Application',
      basis: 'applications.opportunity',
      ids: opportunities.filter((o) => applicationsForOpportunity(o.id).length > 0).map((o) => o.id),
    },
    {
      label: 'Providing Organization linked',
      basis: 'opportunities.provider',
      ids: opportunities.filter((o) => (o.links.fields.provider?.length ?? 0) > 0).map((o) => o.id),
    },
    {
      label: 'With a recorded country',
      basis: 'country is a non-blank string',
      ids: opportunities
        .filter((o) => typeof o.frontmatter.country === 'string' && o.frontmatter.country !== '')
        .map((o) => o.id),
    },
  ]
  const total = opportunities.length
  return stages.map((s) => ({
    label: s.label,
    basis: s.basis,
    count: s.ids.length,
    percent: percentOf(s.ids.length, total),
    ids: s.ids,
  }))
}

/**
 * Whether an Application's recorded submission date has passed.
 *
 * Derived from `submission_date` alone rather than from `application_status`, so
 * this answers one question with one rule. The status distribution is a separate
 * chart and is not folded in here, because a record can carry both a status and a
 * future date without either being wrong.
 */
export function applicationSubmission(today: string): SeriesPoint[] {
  const apps = listApplications()
  const ids: Record<'submitted' | 'future' | 'no_date', string[]> = {
    submitted: [],
    future: [],
    no_date: [],
  }
  for (const a of apps) {
    const raw = a.frontmatter.submission_date
    if (!isISODate(raw)) ids.no_date.push(a.id)
    else if (raw < today) ids.submitted.push(a.id)
    else ids.future.push(a.id)
  }
  const rows = new Map(apps.map((a) => [a.id, a]))
  return [
    point('submitted', 'submission_date recorded in the past', ids.submitted, apps.length, false, rows),
    point('future', 'submission_date recorded ahead of today', ids.future, apps.length, false, rows),
    point('no_date', 'No submission_date recorded', ids.no_date, apps.length, true, rows),
  ]
}

/** Organizations that publish at least one opportunity, split by recorded country. */
export function providerCoverage(): SeriesPoint[] {
  const linked = new Set(listOrganizations().filter((o) => opportunitiesForOrganization(o.id).length > 0).map((o) => o.id))
  return groupCounts(listOrganizations(), 'country').map((p) => ({
    ...p,
    ids: p.ids.filter((id) => linked.has(id)),
    count: p.ids.filter((id) => linked.has(id)).length,
  }))
}

/** Organizations linked to at least one opportunity, as an explicit subset. */
export function providersWithOpportunities(): { ids: string[]; count: number } {
  const ids = listOrganizations()
    .filter((o) => opportunitiesForOrganization(o.id).length > 0)
    .map((o) => o.id)
  return { ids, count: ids.length }
}

/* ------------------------------------------------------------------ */
/* Procurement mode                                                    */
/* ------------------------------------------------------------------ */

/**
 * The three Bid axes, returned separately and never merged.
 *
 * Grouping all three together would let a reader assume a single status, which is
 * exactly the confusion the three-axis design exists to prevent.
 */
export function bidAxisSeries(): Record<'eligibility_status' | 'bid_decision' | 'bid_status', SeriesPoint[]> {
  const bids = listBids()
  return {
    eligibility_status: groupCounts(bids, 'eligibility_status'),
    bid_decision: groupCounts(bids, 'bid_decision'),
    bid_status: groupCounts(bids, 'bid_status'),
  }
}

/** Notice distributions across the four controlled fields a dashboard shows. */
export function noticeSeries(): Record<'notice_type' | 'notice_status' | 'procurement_method' | 'lot_structure', SeriesPoint[]> {
  const notices = listNotices()
  return {
    notice_type: groupCounts(notices, 'notice_type'),
    notice_status: groupCounts(notices, 'notice_status'),
    procurement_method: groupCounts(notices, 'procurement_method'),
    lot_structure: groupCounts(notices, 'lot_structure'),
  }
}

/**
 * Contract distributions across the four independent post-award axes.
 *
 * These four axes are separate by design in the schema, so they stay separate here.
 * `contract_value_currency` is free text rather than controlled, so it is grouped as
 * recorded and never summed: the corpus holds INR and USD amounts with no rate
 * between them.
 */
export function contractSeries(): Record<
  'contract_status' | 'acceptance_status' | 'payment_status' | 'performance_security_status' | 'contract_value_currency',
  SeriesPoint[]
> {
  const contracts = listContracts()
  return {
    contract_status: groupCounts(contracts, 'contract_status'),
    acceptance_status: groupCounts(contracts, 'acceptance_status'),
    payment_status: groupCounts(contracts, 'payment_status'),
    performance_security_status: groupCounts(contracts, 'performance_security_status'),
    contract_value_currency: groupCounts(contracts, 'contract_value_currency'),
  }
}

/** True when a frontmatter amount is a usable, non-zero figure. */
function hasAmount(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0
  if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value))
  return false
}

/**
 * Records per currency, with no monetary total.
 *
 * The vault never converts between currencies, so the only safe aggregation is a
 * count of records. `withAmount` counts the records that actually carry a value;
 * the difference between the two is the point, because a total taken over just the
 * records that have an amount would be read as a portfolio value while silently
 * excluding the blanks.
 *
 * The currency field is a parameter because the schema names it differently per
 * type: `contract_value_currency` on Contract, `quoted_currency` on Bid.
 */
export function currencyCoverage(
  recs: RecordRow[],
  amountField: string,
  currencyField: string,
): { currency: string; count: number; withAmount: number; ids: string[] }[] {
  const byCurrency = new Map<string, { ids: string[]; withAmount: number }>()
  for (const r of recs) {
    const cur = r.frontmatter[currencyField]
    const key = typeof cur === 'string' && cur !== '' ? cur : BLANK
    const entry = byCurrency.get(key) ?? { ids: [], withAmount: 0 }
    entry.ids.push(r.id)
    if (hasAmount(r.frontmatter[amountField])) entry.withAmount += 1
    byCurrency.set(key, entry)
  }
  return [...byCurrency.entries()]
    .map(([currency, v]) => ({ currency, count: v.ids.length, withAmount: v.withAmount, ids: v.ids }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

/** Notices with and without at least one bid, as two explicit subsets. */
export function noticeBidCoverage(): {
  withBids: { ids: string[]; count: number }
  withoutBids: { ids: string[]; count: number }
} {
  const withIds = noticesWithBids().map((n) => n.id)
  const withSet = new Set(withIds)
  const withoutIds = listNotices()
    .filter((n) => !withSet.has(n.id))
    .map((n) => n.id)
  return {
    withBids: { ids: withIds, count: withIds.length },
    withoutBids: { ids: withoutIds, count: withoutIds.length },
  }
}

/* ------------------------------------------------------------------ */
/* Company activity                                                     */
/* ------------------------------------------------------------------ */

/**
 * Per-company record counts across all four activity types.
 *
 * A company with no bids shows a zero rather than being omitted. Zero here means
 * "no record links to this company", which is a real statement about the corpus.
 */
export interface CompanyActivity {
  id: string
  name: string
  matches: number
  applications: number
  bids: number
  contracts: number
  fictional: boolean
}

export function companyActivity(): CompanyActivity[] {
  return listCompanies().map((c) => ({
    id: c.id,
    name: titleOf(c),
    matches: matchesForCompany(c.id).length,
    applications: applicationsForCompany(c.id).length,
    bids: bidsForCompany(c.id).length,
    contracts: contractsForCompany(c.id).length,
    fictional: isFictional(c),
  }))
}

/* ------------------------------------------------------------------ */
/* Re-exports                                                          */
/* ------------------------------------------------------------------ */

/** Evidence coverage for Bids, delegated to the existing deterministic function. */
export { evidenceCoverage }

/** Company procurement activity, delegated to the existing function. */
export { companyProcurement }

/** Attention items for a reference date, delegated to the existing function. */
export function attentionFor(today: string): AttentionItem[] {
  return attentionItems(today)
}

/** Fictional/real split across the whole corpus. */
export function provenanceSplit(): { fictional: number; real: number } {
  let fictional = 0
  let real = 0
  for (const key of ALL_COLLECTIONS) {
    for (const r of listRecords(key)) {
      if (isFictional(r)) fictional += 1
      else real += 1
    }
  }
  return { fictional, real }
}

/**
 * Fictional and real as a two-point series, for the provenance ring.
 *
 * Returned as `SeriesPoint`s rather than as bare counts so the ring, its legend, and
 * its accessible name all read the same numbers as everything else on the page. Both
 * states are always returned, including a zero, because a corpus with no fictional
 * records is a meaningful fact rather than an empty category.
 */
export function provenanceSeries(): SeriesPoint[] {
  const fictional: string[] = []
  const real: string[] = []
  for (const key of ALL_COLLECTIONS) {
    for (const r of listRecords(key)) {
      if (isFictional(r)) fictional.push(r.id)
      else real.push(r.id)
    }
  }
  const total = fictional.length + real.length
  // Ids are unique per record type, and several types reuse an id space, so the
  // synthetic keys below are prefixed. They are only ever rendered as labels.
  return [
    {
      value: 'real',
      label: 'Real reference',
      count: real.length,
      percent: percentOf(real.length, total),
      ids: real,
      fictional: 0,
      real: real.length,
      isBlank: false,
    },
    {
      value: 'fictional',
      label: 'Fictional demonstration',
      count: fictional.length,
      percent: percentOf(fictional.length, total),
      ids: fictional,
      fictional: fictional.length,
      real: 0,
      isBlank: false,
    },
  ]
}

/**
 * One step of a workflow as a count of records in a collection.
 *
 * The workflow visuals on the Overview draw every figure from here, so a workflow
 * step shows the same count the corresponding stat card shows, and the numbers are
 * unit-testable against the corpus rather than only visible on the page.
 */
export interface WorkflowStep {
  order: string
  collection: CollectionKey
  count: number
}

/**
 * The two workflows, as counts of the collections each one passes through.
 *
 * Funding runs Find (Opportunities) -> Match (Matches) -> Apply (Applications);
 * Procurement runs Find (Notices) -> Bid (Bids) -> Contract (Contracts). Each
 * step is the whole collection, not a filtered subset: a record can sit at any
 * stage without the others, which is exactly what the Overview note says.
 */
export function workflowFlows(): Record<'funding' | 'procurement', WorkflowStep[]> {
  return {
    funding: [
      { order: 'Find', collection: 'opportunities', count: listOpportunities().length },
      { order: 'Match', collection: 'matches', count: listMatches().length },
      { order: 'Apply', collection: 'applications', count: listApplications().length },
    ],
    procurement: [
      { order: 'Find', collection: 'notices', count: listNotices().length },
      { order: 'Bid', collection: 'bids', count: listBids().length },
      { order: 'Contract', collection: 'contracts', count: listContracts().length },
    ],
  }
}

/**
 * Notices split by whether at least one Bid is linked, as a two-point series.
 *
 * Expressed as a series so the bar list can render both states with their shares and
 * so each state can carry its own drill-down. Both are always returned: "no bid
 * recorded" is a state a Notice can genuinely be in.
 */
export function noticeBidCoverageSeries(): SeriesPoint[] {
  const { withBids, withoutBids } = noticeBidCoverage()
  const total = withBids.count + withoutBids.count
  return [
    {
      value: 'with',
      label: 'At least one bid recorded',
      count: withBids.count,
      percent: percentOf(withBids.count, total),
      ids: withBids.ids,
      fictional: 0,
      real: 0,
      isBlank: false,
    },
    {
      value: 'without',
      label: 'No bid recorded',
      count: withoutBids.count,
      percent: percentOf(withoutBids.count, total),
      ids: withoutBids.ids,
      fictional: 0,
      real: 0,
      isBlank: false,
    },
  ]
}

/** Number of distinct non-blank values a field takes across a set of records. */
export function distinctValues(recs: RecordRow[], fieldName: string): number {
  const set = new Set<string>()
  for (const r of recs) {
    const v = r.frontmatter[fieldName]
    if (typeof v === 'string' && v !== '') set.add(v)
  }
  return set.size
}