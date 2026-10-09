/**
 * Read-only data access layer over the generated snapshot.
 *
 * Every function here is a pure read. Nothing mutates the snapshot, and no
 * value is ever invented, defaulted, or normalised. Blank strings, empty
 * lists, and `false` reach the UI exactly as the vault stored them.
 *
 * Relationship resolution REUSES the `relationships` indexes the importer
 * already built from `related_opportunity` and the approved link fields. No
 * second relationship algorithm lives in the UI, so the two cannot disagree.
 * Nothing is resolved by matching names or URLs.
 *
 * Every exported function returns `RecordRow`: the typed envelope with
 * frontmatter left unnarrowed. The one cast to that shape happens at the
 * snapshot boundary below, so the rest of the app needs no casts.
 */

import snapshotJson from './generated/opportunity-data.json'
import type { RecordRow, Relationships, VaultSnapshot } from '../types/records'
import type { RecordType } from '../types/registry'
import { COLLECTION_KEY, COLLECTION_PATH as COLLECTION_PATH_BY_TYPE, RECORD_TYPES, TITLE_FIELD, typeForId } from '../types/registry'

/** The imported snapshot, cast to the type the importer guarantees. */
export let snapshot = snapshotJson as unknown as VaultSnapshot
export let relationships: Relationships = snapshot.relationships

/* ------------------------------------------------------------------ */
/* Collections (derived from the registry)                             */
/* ------------------------------------------------------------------ */

export type CollectionKey =
  | 'opportunities'
  | 'companies'
  | 'matches'
  | 'applications'
  | 'organizations'
  | 'sources'
  | 'notices'
  | 'bids'
  | 'contracts'
  | 'procurement_matches'

/** Collection keys in registry order. */
export const COLLECTION_KEYS: CollectionKey[] = RECORD_TYPES.map((t) => COLLECTION_KEY[t] as CollectionKey)

/**
 * Route path segment for each collection, e.g. `opportunities`.
 * Keyed by collection key because that is how the UI looks it up.
 */
export const COLLECTION_PATH: Record<CollectionKey, string> = Object.fromEntries(
  RECORD_TYPES.map((t) => [COLLECTION_KEY[t], COLLECTION_PATH_BY_TYPE[t]]),
) as Record<CollectionKey, string>

/** Record type -> collection key, from the registry. */
export const COLLECTION_OF: Record<RecordType, CollectionKey> = Object.fromEntries(
  RECORD_TYPES.map((t) => [t, COLLECTION_KEY[t]]),
) as Record<RecordType, CollectionKey>

/** The only place the snapshot is narrowed to the UI row type. */
const rows = (key: CollectionKey): RecordRow[] =>
  snapshot.records[key] as unknown as RecordRow[]

/** List records of one collection, in the snapshot's stored order (ID sorted). */
export function listRecords(key: CollectionKey): RecordRow[] {
  return rows(key)
}

export const listOpportunities = (): RecordRow[] => rows('opportunities')
export const listCompanies = (): RecordRow[] => rows('companies')
export const listMatches = (): RecordRow[] => rows('matches')
export const listApplications = (): RecordRow[] => rows('applications')
export const listOrganizations = (): RecordRow[] => rows('organizations')
export const listSources = (): RecordRow[] => rows('sources')
export const listNotices = (): RecordRow[] => rows('notices')
export const listBids = (): RecordRow[] => rows('bids')
export const listContracts = (): RecordRow[] => rows('contracts')
export const listProcurementMatches = (): RecordRow[] => rows('procurement_matches')

/* ------------------------------------------------------------------ */
/* Lookup                                                               */
/* ------------------------------------------------------------------ */

/** Flattened ID -> record index across every registered collection. */
let byId: Map<string, RecordRow> = new Map(
  COLLECTION_KEYS.flatMap((k) => rows(k)).map((r) => [r.id, r]),
)

export let sourceInfo = snapshot.source
export let unresolvedLinks = snapshot.unresolvedLinks

/** Replaces the read layer with an isolated test fixture. */
export function installTestSnapshot(testSnapshot: VaultSnapshot): void {
  snapshot = testSnapshot
  relationships = testSnapshot.relationships
  byId = new Map(
    COLLECTION_KEYS.flatMap(
      (key) => testSnapshot.records[key] as unknown as RecordRow[],
    ).map((row) => [row.id, row] as const),
  )
  sourceInfo = testSnapshot.source
  unresolvedLinks = testSnapshot.unresolvedLinks
}

/** Look up any record by ID. Returns undefined for an unknown ID. */
export function getRecord(id: string | undefined): RecordRow | undefined {
  if (!id) return undefined
  return byId.get(id)
}

/**
 * Which collection a record belongs to, or undefined if the ID is unknown.
 *
 * The record's own `type` decides, and the registry decides which collection
 * that type lives in. An ID whose prefix disagrees with the record's type is
 * reported as unknown rather than guessing, which keeps a misfiled record from
 * appearing under two collections at once.
 */
export function collectionOf(id: string): CollectionKey | undefined {
  const rec = byId.get(id)
  if (!rec) return undefined
  const fromType = COLLECTION_OF[rec.type]
  if (!fromType) return undefined
  const prefixType = typeForId(id)
  if (prefixType && prefixType !== rec.type) return undefined
  return fromType
}

/** Route path for a record ID, e.g. `/matches/MATCH-002`. */
export function pathForRecord(id: string): string | null {
  const key = collectionOf(id)
  return key ? `/${COLLECTION_PATH[key]}/${id}` : null
}

/* ------------------------------------------------------------------ */
/* Field access                                                         */
/* ------------------------------------------------------------------ */

/** Read one frontmatter field. Blank (`''`) and absent (`undefined`) differ. */
export function field(rec: RecordRow, name: string): unknown {
  return (rec.frontmatter as Record<string, unknown>)[name]
}

/** Read a field as text, or `undefined` when absent. Blank stays `''`. */
export function textField(rec: RecordRow, name: string): string | undefined {
  const v = field(rec, name)
  return typeof v === 'string' ? v : undefined
}

/** Read a field as a list. An empty list stays `[]`. */
export function listField(rec: RecordRow, name: string): string[] | undefined {
  const v = field(rec, name)
  return Array.isArray(v) ? (v as string[]) : undefined
}

/* ------------------------------------------------------------------ */
/* Display helpers (presentation only; never change stored values)     */
/* ------------------------------------------------------------------ */

/** The human title for a record, taken from that type's name field in the registry. */
export function titleOf(rec: RecordRow): string {
  return textField(rec, TITLE_FIELD[rec.type] ?? '') ?? rec.id
}

/**
 * Strip the `[[` `]]` wrapper and any `|alias` or `#heading` for display.
 * The original string is never mutated; this only derives a label.
 */
export function linkLabel(raw: string): string {
  const inner = raw.replace(/^\[\[/, '').replace(/\]\]$/, '')
  return inner.split('|')[0].split('#')[0].trim()
}

export const isFictional = (rec: RecordRow): boolean => rec.fictional.isFictional

/* ------------------------------------------------------------------ */
/* Relationships (reusing the importer's indexes)                      */
/* ------------------------------------------------------------------ */

/** Opportunity -> Organization that issued it (from the provider link). */
export function providerFor(opportunityId: string): RecordRow | undefined {
  const rec = getRecord(opportunityId)
  if (!rec) return undefined
  const target = rec.links.fields.provider?.[0]
  return target?.resolvedId ? getRecord(target.resolvedId) : undefined
}

/** Drop undefined entries left by a lookup that found no record. */
const defined = (recs: (RecordRow | undefined)[]): RecordRow[] =>
  recs.filter((r): r is RecordRow => r !== undefined)

/** Organization -> Opportunities it provides, from the importer's index. */
export function opportunitiesForOrganization(orgId: string): RecordRow[] {
  return defined((relationships.organizationToOpportunity[orgId] ?? []).map(getRecord))
}

/** Source -> its related Opportunity, from `related_opportunity`. */
export function opportunityForSource(sourceId: string): RecordRow | undefined {
  const id = relationships.sourceToOpportunity[sourceId]?.[0]
  return id ? getRecord(id) : undefined
}

/** Opportunity -> Sources that support it. */
export function sourcesForOpportunity(opportunityId: string): RecordRow[] {
  return defined((relationships.opportunityToSource[opportunityId] ?? []).map(getRecord))
}

/** Opportunity -> Matches referencing it, via the importer's match index. */
export function matchesForOpportunity(opportunityId: string): RecordRow[] {
  return defined(
    Object.entries(relationships.matchToOpportunity)
      .filter(([, oppId]) => oppId === opportunityId)
      .map(([matchId]) => getRecord(matchId)),
  )
}

/** Opportunity -> Applications referencing it. */
export function applicationsForOpportunity(opportunityId: string): RecordRow[] {
  return defined(
    Object.entries(relationships.applicationToOpportunity)
      .filter(([, oppId]) => oppId === opportunityId)
      .map(([appId]) => getRecord(appId)),
  )
}

/** Company -> Matches referencing it. */
export function matchesForCompany(companyId: string): RecordRow[] {
  return defined(
    Object.entries(relationships.matchToCompany)
      .filter(([, cid]) => cid === companyId)
      .map(([matchId]) => getRecord(matchId)),
  )
}

/** Company -> Applications referencing it. */
export function applicationsForCompany(companyId: string): RecordRow[] {
  return defined(
    Object.entries(relationships.applicationToCompany)
      .filter(([, cid]) => cid === companyId)
      .map(([appId]) => getRecord(appId)),
  )
}

/** Match -> its Company and Opportunity, plus the optional Application. */
export function companyForMatch(matchId: string): RecordRow | undefined {
  const id = relationships.matchToCompany[matchId]
  return id ? getRecord(id) : undefined
}

export function opportunityForMatch(matchId: string): RecordRow | undefined {
  const id = relationships.matchToOpportunity[matchId]
  return id ? getRecord(id) : undefined
}

/** The optional Application a Match produced, or undefined when not recorded. */
export function applicationForMatch(matchId: string): RecordRow | undefined {
  const id = relationships.matchToApplication[matchId]
  return id ? getRecord(id) : undefined
}

/** Application -> Company, Opportunity, and optional Match. */
export function companyForApplication(appId: string): RecordRow | undefined {
  const id = relationships.applicationToCompany[appId]
  return id ? getRecord(id) : undefined
}

export function opportunityForApplication(appId: string): RecordRow | undefined {
  const id = relationships.applicationToOpportunity[appId]
  return id ? getRecord(id) : undefined
}

export function matchForApplication(appId: string): RecordRow | undefined {
  const id = relationships.applicationToMatch[appId]
  return id ? getRecord(id) : undefined
}

/* ------------------------------------------------------------------ */
/* Notice relationships (procurement)                                  */
/* ------------------------------------------------------------------ */

/**
 * Notice -> Organization that issued it (the buyer).
 *
 * From the importer's `noticeToOrganization` index, which is built from
 * `Notice.procuring_entity`. Phase 1 section 7.2: N:1 and required. Organization
 * is reused unchanged; no procurement field was added to Organization.
 */
export function procuringEntityForNotice(noticeId: string): RecordRow | undefined {
  const id = relationships.noticeToOrganization[noticeId]
  return id ? getRecord(id) : undefined
}

/**
 * Notice -> Sources evidencing it, from `Notice.linked_sources`.
 *
 * Phase 1 section 7.2: N:N. Corrigenda are Source records appended here, which
 * is why this can hold more than one entry (Phase 1 section 7.3).
 */
export function sourcesForNotice(noticeId: string): RecordRow[] {
  return defined((relationships.noticeToSource[noticeId] ?? []).map(getRecord))
}

/**
 * Organization -> Notices it issued as buyer.
 *
 * Derived by reversing `noticeToOrganization`, exactly as
 * `opportunitiesForOrganization` reverses `organizationToOpportunity`. No second
 * relationship algorithm, so the two cannot disagree.
 */
export function noticesForOrganization(orgId: string): RecordRow[] {
  return defined(
    Object.entries(relationships.noticeToOrganization)
      .filter(([, noticeOrgId]) => noticeOrgId === orgId)
      .map(([noticeId]) => getRecord(noticeId)),
  )
}

/**
 * Source -> Notices it evidences, from `Notice.linked_sources`.
 *
 * The reverse of `sourcesForNotice`, derived from the same index so the two
 * directions cannot disagree. Phase 3 ships with every `linked_sources` empty,
 * so this currently returns nothing; it is wired because the reverse direction
 * is part of the relationship, not an optional extra.
 */
export function noticesForSource(sourceId: string): RecordRow[] {
  return listNotices().filter((n) =>
    (relationships.noticeToSource[n.id] ?? []).includes(sourceId),
  )
}

/**
 * Notice -> the Bids pursuing it.
 *
 * Phase 1 section 7.1: a Notice attracts MANY Bids, 1:N, and this is the
 * confirmed requirement that distinguishes procurement from funding — Match and
 * Application are one-per-pairing, a tender has many bidders. Without this index
 * the module cannot answer "how many of us bid?" or "what is our win rate with
 * this buyer?".
 *
 * Read from the importer's `noticeToBid` index rather than by filtering, so the
 * cardinality is answered from a built index instead of a scan, and so the
 * importer and the UI cannot disagree about it. A Notice with no bids is
 * pre-seeded with an empty array, so this returns `[]` rather than nothing.
 */
export function bidsForNotice(noticeId: string): RecordRow[] {
  return defined((relationships.noticeToBid[noticeId] ?? []).map(getRecord))
}

/**
 * Bid -> the single Company that submitted it.
 *
 * Phase 1 section 7.2: N:1, required. Consortiums are deferred (decision D6), so
 * this is a single record and never a list.
 */
export function companyForBid(bidId: string): RecordRow | undefined {
  const id = relationships.bidToCompany[bidId]
  return id ? getRecord(id) : undefined
}

/**
 * Bid -> the single Notice it pursues.
 *
 * Phase 1 section 7.2: N:1, required.
 */
export function noticeForBid(bidId: string): RecordRow | undefined {
  const id = relationships.bidToNotice[bidId]
  return id ? getRecord(id) : undefined
}

/**
 * Bid -> Sources evidencing its eligibility assessment.
 *
 * Phase 1 section 7.2: N:N. Distinct from `sourcesForNotice`: a Notice's sources
 * are the evidence for the solicitation itself (including corrigenda), while a
 * Bid's are the evidence a human relied on to conclude this company is eligible.
 * Different claims, different evidence.
 */
export function sourcesForBid(bidId: string): RecordRow[] {
  return defined((relationships.bidToSource[bidId] ?? []).map(getRecord))
}

/**
 * Company -> the Bids it has submitted.
 *
 * Phase 1 section 7.1: 1:N, the pipeline view of one company's procurement
 * history. Derived from the importer's `companyToBid` index, the same way
 * `applicationsForCompany` derives from `applicationToCompany`, so there is one
 * relationship algorithm rather than two.
 */
export function bidsForCompany(companyId: string): RecordRow[] {
  return defined((relationships.companyToBid[companyId] ?? []).map(getRecord))
}

/**
 * Companies that actually have at least one Bid, for use as filter options.
 *
 * Offers every company rather than only those with bids, because "a company with
 * no bids" is a legitimate question a reader may want to ask of the company list
 * — but the Bid page uses this so its Company filter does not offer a choice
 * that would return nothing.
 */
export function companiesWithBids(): RecordRow[] {
  return listCompanies().filter((c) => (relationships.companyToBid[c.id] ?? []).length > 0)
}

/** Notices that actually have at least one Bid, for use as filter options. */
export function noticesWithBidRecords(): RecordRow[] {
  return listNotices().filter((n) => (relationships.noticeToBid[n.id] ?? []).length > 0)
}

/**
 * Source -> the Bids citing it as eligibility evidence.
 *
 * The reverse of `sourcesForBid`, from the importer's `sourceToBid` index, so the
 * two directions cannot disagree.
 */
export function bidsForSource(sourceId: string): RecordRow[] {
  return defined((relationships.sourceToBid[sourceId] ?? []).map(getRecord))
}

/* ------------------------------------------------------------------ */
/* Contract relationships (Phase 1 section 6 and 7)                    */
/* ------------------------------------------------------------------ */

/**
 * Notice -> the Contracts generated from it.
 *
 * Phase 1 section 7: NOTICE 1:N CONTRACT, "generates". One solicitation can
 * produce several instruments — separate lots, or repeated call-offs under a
 * framework — so this is a list even for a single-lot notice.
 */
export function contractsForNotice(noticeId: string): RecordRow[] {
  return defined((relationships.noticeToContract[noticeId] ?? []).map(getRecord))
}

/**
 * Bid -> the Contracts it produced.
 *
 * Phase 1 section 7.1 corrected this from 0..1 to **1:0..N**, and this is the
 * selector that correction exists for. One award covering several lots produces
 * one contract per lot, all pointing at the same bid; a one-to-one index would
 * have had to drop every contract after the first.
 *
 * A Bid that has not yet been contracted returns `[]`, because the importer
 * pre-seeds the index rather than omitting the key.
 */
export function contractsForBid(bidId: string): RecordRow[] {
  return defined((relationships.bidToContract[bidId] ?? []).map(getRecord))
}

/**
 * Company -> the Contracts awarded to it.
 *
 * Phase 1 section 7.2: N:1 on the forward link, so this is the reverse 1:N. It
 * answers "what is this company actually under contract to deliver?", which is
 * the question the post-award module exists to answer and which no combination
 * of the Bid selectors could answer: a single-source contract has no Bid at all,
 * so it is invisible from the pipeline view.
 */
export function contractsForCompany(companyId: string): RecordRow[] {
  return defined((relationships.companyToContract[companyId] ?? []).map(getRecord))
}

/**
 * Contract -> the single Notice it arose from.
 *
 * Phase 1 section 6 field 2: N:1, required. Required even for a non-competitive
 * award, so this never returns undefined for a valid record.
 */
export function noticeForContract(contractId: string): RecordRow | undefined {
  const id = relationships.contractToNotice[contractId]
  return id ? getRecord(id) : undefined
}

/**
 * Contract -> the single Company it was awarded to. Phase 1 section 7.2: N:1.
 */
export function companyForContract(contractId: string): RecordRow | undefined {
  const id = relationships.contractToCompany[contractId]
  return id ? getRecord(id) : undefined
}

/**
 * Contract -> the Bid it came from, or `undefined` when there was no bid.
 *
 * Phase 1 section 7.2: N:0..1. This is the ONLY relationship in the model where
 * "no parent" is a legitimate resolved state rather than missing data, so
 * `undefined` here is meaningful and callers must handle it: a single-source or
 * negotiated award has no Bid to point at, and `contract_basis` records why.
 * A caller that treats undefined as an error will report every non-competitive
 * award as broken.
 */
export function bidForContract(contractId: string): RecordRow | undefined {
  const id = relationships.contractToBid[contractId]
  return id ? getRecord(id) : undefined
}

/**
 * Contracts that have no Bid behind them.
 *
 * Not a filter the UI needs yet, but the population matters for the count in the
 * Phase 6 report and for any future "uncompetitive awards" review: it is the set
 * whose `contract_basis` is load-bearing rather than redundant.
 */
export function contractsWithoutBid(): RecordRow[] {
  return listContracts().filter((c) => !relationships.contractToBid[c.id])
}

/** Companies that hold at least one Contract, for use as filter options. */
export function companiesWithContracts(): RecordRow[] {
  return listCompanies().filter((c) => (relationships.companyToContract[c.id] ?? []).length > 0)
}

/** Notices that generated at least one Contract, for use as filter options. */
export function noticesWithContracts(): RecordRow[] {
  return listNotices().filter((n) => (relationships.noticeToContract[n.id] ?? []).length > 0)
}

/* ------------------------------------------------------------------ */
/* Grouping for the dashboard (counts derived from the snapshot)       */
/* ------------------------------------------------------------------ */

export interface Count {
  label: string
  count: number
}

/**
 * Count records by an existing controlled field.
 * Values are taken verbatim; nothing is normalised or re-bucketed.
 */
export function countBy(recs: RecordRow[], name: string): Count[] {
  const map = new Map<string, number>()
  for (const r of recs) {
    const v = textField(r, name)
    if (v === undefined) continue
    map.set(v, (map.get(v) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** Split a collection into fictional and real, using the importer's decision. */
export function splitFictional(recs: RecordRow[]): {
  fictional: RecordRow[]
  real: RecordRow[]
} {
  return {
    fictional: recs.filter(isFictional),
    real: recs.filter((r) => !isFictional(r)),
  }
}

/** Total fictional / real across all collections. */
export function totalSplit(): { fictional: number; real: number } {
  const all = COLLECTION_KEYS.flatMap((k) => rows(k))
  return {
    fictional: all.filter(isFictional).length,
    real: all.filter((r) => !isFictional(r)).length,
  }
}

/** Snapshot provenance, shown so the data's origin stays visible. */
