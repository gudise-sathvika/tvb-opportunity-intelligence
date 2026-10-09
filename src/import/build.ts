/**
 * Assembles the JSON snapshot from the parsed records.
 *
 * Determinism rules, so identical source files produce byte-identical JSON:
 *   - records sorted by ID
 *   - frontmatter keys emitted in template field order, not insertion order
 *   - relationship arrays sorted
 *   - no timestamp, no hostname, no absolute path
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  COLLECTION_KEY,
  ID_FIELD,
  RECORD_DIRS,
  RECORD_TYPES,
  TITLE_FIELD,
  idPatternFor,
  linkFieldFor,
  typeForId,
} from '../types/registry'
import type {
  Application,
  Bid,
  Company,
  Contract,
  ImportedRecord,
  LinkTarget,
  Match,
  Notice,
  Opportunity,
  Organization,
  ProcurementMatch,
  RecordLinks,
  RecordType,
  Relationships,
  Source,
  UnresolvedLink,
  VaultSnapshot,
} from '../types/records'
import { SCHEMAS, TOTAL_SCHEMA_FIELDS, assertSchemaConsistency } from './schema'
import { checkField, toIsoDate, parseRecordFile } from './parse'
import {
  buildIdIndex,
  buildNoteIndex,
  collectUnresolved,
  extractBodyLinks,
  idFromTarget,
  resolveLinkField,
  resolveLinkListField,
  type IdIndex,
  type NoteIndex,
} from './links'
import { applyLinkRule, checkAmbiguity, classifyByMarkers, type ClassifyInput } from './classify'
import { listContentFiles } from './manifest'
import { VAULT_ROOT } from './paths'

// 1.2.0 adds the Bid collection and its six relationship indexes. Minor bump,
// because the shape grew: existing snapshot consumers reading `records.notices`
// and `relationships.noticeToOrganization` are unaffected, and `bids` plus the
// new keys are additive.
export const SCHEMA_VERSION = '1.2.0'
export const GENERATOR = 'tvb-frontend read-only vault importer (phase 4)'

export interface BuildResult {
  snapshot: VaultSnapshot
  unresolvedLinks: UnresolvedLink[]
  /** Fictional records excluded from the application snapshot. */
  excludedFictionalIds: string[]
  /** Records whose classification should be reviewed by a human. */
  ambiguous: { id: string; note: string }[]
  parseWarnings: string[]
}

/**
 * Every record of every collection, in registry order.
 *
 * The unnarrowed cast matches the one the UI layer already makes at the
 * snapshot boundary: the per-type frontmatter interfaces have no index
 * signature, so a list of "any record" can only be typed generically here.
 */
export function allRecords(s: VaultSnapshot): ImportedRecord[] {
  return RECORD_TYPES.flatMap(
    (t) => s.records[COLLECTION_KEY[t] as keyof typeof s.records] as unknown as ImportedRecord[],
  )
}

/** Re-emit frontmatter in schema field order, converting date values only. */
function orderFrontmatter(type: RecordType, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of SCHEMAS[type]) {
    if (!(spec.name in data)) continue // missing key stays missing
    const value = data[spec.name]
    out[spec.name] = spec.kind === 'date' ? toIsoDate(value, `${type}.${spec.name}`) : value
  }
  return out
}

export function buildSnapshot(vaultRoot: string = VAULT_ROOT): BuildResult {
  const parseWarnings: string[] = []

  // Structural drift is a configuration bug, not a data problem, so it is
  // caught before any file is read.
  assertSchemaConsistency()

  // ---- Pass A: parse every record file ----
  const staged: {
    type: RecordType
    id: string
    sourceFile: string
    sourceSha256: string
    frontmatter: Record<string, unknown>
    body: string
    displayName: string
  }[] = []

  for (const type of RECORD_TYPES) {
    const dir = path.join(vaultRoot, RECORD_DIRS[type])
    // A registered type may legitimately have no vault directory yet (Phase P:
    // Procurement Match is registered and schemed before its first record ever
    // exists, and this phase files none). An empty collection then imports
    // cleanly. Only an unregistered directory is a configuration error.
    if (!fs.existsSync(dir)) continue
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .sort()

    for (const f of files) {
      const abs = path.join(dir, f)
      const sourceFile = `${RECORD_DIRS[type]}/${f}`

      const parsed = parseRecordFile(abs, sourceFile)

      const idField = ID_FIELD[type]
      const id = parsed.data[idField]
      if (typeof id !== 'string' || id === '') {
        throw new Error(`Missing or blank ${idField} in ${sourceFile}`)
      }
      // Shape check: the ID must carry its type's prefix and 3 digits. A prefix
      // belonging to another type is called out separately, because that is a
      // misfiled record rather than a typo.
      if (!idPatternFor(type).test(id)) {
        const other = typeForId(id)
        throw new Error(
          other && other !== type
            ? `Invalid ID in ${sourceFile}: ${id} carries the ${other} prefix but sits in the ${type} directory`
            : `Invalid ID in ${sourceFile}: ${id} does not match ${idPatternFor(type).source}`,
        )
      }

      // Per-field gate: kind, required, and controlled value. Fails the import
      // with record, field, and reason rather than repairing the record.
      for (const spec of SCHEMAS[type]) {
        checkField(spec, parsed.data[spec.name], id)
      }

      const nameField = TITLE_FIELD[type]
      const displayName = typeof parsed.data[nameField] === 'string' ? (parsed.data[nameField] as string) : ''

      staged.push({
        type,
        id,
        sourceFile,
        sourceSha256: parsed.sourceSha256,
        frontmatter: parsed.data,
        body: parsed.body,
        displayName,
      })
    }
  }

  // ---- Pass B: build the resolution index ----
  const index: IdIndex = buildIdIndex(
    staged.map((s) => ({ id: s.id, type: s.type, displayName: s.displayName })),
  )
  // Every note in the vault, so `[[Data Dictionary]]` resolves as a note and
  // is not misreported as a dangling link.
  const notes: NoteIndex = buildNoteIndex(listContentFiles(vaultRoot))

  // ---- Pass C: links ----
  const linksById = new Map<string, RecordLinks>()

  for (const s of staged) {
    const fields: Record<string, LinkTarget[]> = {}
    for (const spec of SCHEMAS[s.type]) {
      if (spec.kind === 'link') {
        const v = s.frontmatter[spec.name]
        fields[spec.name] = resolveLinkField(typeof v === 'string' ? v : '', index, notes)
      } else if (spec.kind === 'linkList') {
        const v = s.frontmatter[spec.name]
        fields[spec.name] = resolveLinkListField(Array.isArray(v) ? (v as string[]) : [], index, notes)
      }
    }
    const body: LinkTarget[] = extractBodyLinks(s.body).map((l) => {
      const byId = idFromTarget(l.target)
      const hit = (byId ? index.get(byId.toLowerCase()) : undefined) ?? index.get(l.target.toLowerCase())
      if (hit) return { target: l.target, raw: l.raw, resolvedId: hit.id, notePath: null, unresolved: false }
      const notePath = notes.get(l.target.trim().toLowerCase()) ?? null
      return { target: l.target, raw: l.raw, resolvedId: null, notePath, unresolved: notePath === null }
    })
    linksById.set(s.id, { fields, body })
  }

  // ---- Pass D: classification (marker pass, then link pass) ----
  const classifyInputs = new Map<string, ClassifyInput>()
  const firstPass = new Map<string, ReturnType<typeof classifyByMarkers>>()

  for (const s of staged) {
    const links = linksById.get(s.id)
    const linkedIds = Object.values(links?.fields ?? {})
      .flat()
      .map((t) => t.resolvedId)
      .filter((x): x is string => x !== null)

    const input: ClassifyInput = {
      id: s.id,
      type: s.type,
      sourceFile: s.sourceFile,
      frontmatter: s.frontmatter,
      body: s.body,
      linkedIds,
    }
    classifyInputs.set(s.id, input)
    firstPass.set(s.id, classifyByMarkers(input))
  }

  const fictionalByMarker = new Set(
    staged.filter((s) => firstPass.get(s.id)?.isFictional).map((s) => s.id),
  )

  const classification = new Map<string, ReturnType<typeof applyLinkRule>>()
  for (const s of staged) {
    const input = classifyInputs.get(s.id) as ClassifyInput
    const decided = applyLinkRule(input, firstPass.get(s.id) as ReturnType<typeof classifyByMarkers>, fictionalByMarker)
    classification.set(s.id, checkAmbiguity(input, decided))
  }

  const excludedFictionalIds = staged
    .filter((record) => classification.get(record.id)?.isFictional === true)
    .map((record) => record.id)
  const excludedFictionalIdSet = new Set(excludedFictionalIds)
  const productionStaged = staged.filter((record) => !excludedFictionalIdSet.has(record.id))

  // ---- Pass E: assemble records ----
  const unresolvedLinks: UnresolvedLink[] = []
  const ambiguous: { id: string; note: string }[] = []

  const make = <T>(s: (typeof staged)[number]): ImportedRecord<T> => {
    const links = linksById.get(s.id) as RecordLinks
    unresolvedLinks.push(...collectUnresolved(s.id, s.type, links))

    const cls = classification.get(s.id) as ReturnType<typeof classifyByMarkers>
    if (cls.ambiguous) ambiguous.push({ id: s.id, note: cls.note })

    return {
      id: s.id,
      type: s.type,
      sourceFile: s.sourceFile,
      sourceSha256: s.sourceSha256,
      frontmatter: orderFrontmatter(s.type, s.frontmatter) as T,
      body: s.body,
      fictional: {
        isFictional: cls.isFictional,
        rules: cls.rules,
        ambiguous: cls.ambiguous,
        note: cls.note,
      },
      links: { fields: links.fields, body: links.body },
    }
  }

  const byType = <T>(type: RecordType): ImportedRecord<T>[] =>
    productionStaged
      .filter((s) => s.type === type)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((s) => make<T>(s))

  const opportunities = byType<Opportunity>('opportunity')
  const companies = byType<Company>('company')
  const matches = byType<Match>('match')
  const applications = byType<Application>('application')
  const organizations = byType<Organization>('organization')
  const sources = byType<Source>('source')

  // ---- Pass F: relationships (ID-keyed) ----
  // Field names come from the registry's approved `links`, not from literals
  // scattered through this function.
  const firstResolved = (id: string, field: string): string | null => {
    const t = linksById.get(id)?.fields[field]?.[0]
    return t ? t.resolvedId : null
  }

  const organizationToOpportunity: Record<string, string[]> = {}
  for (const org of organizations) organizationToOpportunity[org.id] = []
  // Derived from Opportunity.provider, the only frontmatter link on that side.
  const providerField = linkFieldFor('opportunity', 'organization')
  for (const opp of opportunities) {
    const provider = firstResolved(opp.id, providerField)
    if (provider) {
      organizationToOpportunity[provider] = [...(organizationToOpportunity[provider] ?? []), opp.id]
    }
  }
  for (const k of Object.keys(organizationToOpportunity)) {
    organizationToOpportunity[k].sort()
  }

  const sourceOpportunityField = linkFieldFor('source', 'opportunity')
  const sourceToOpportunity: Record<string, string[]> = {}
  for (const src of sources) {
    const target = firstResolved(src.id, sourceOpportunityField)
    sourceToOpportunity[src.id] = target ? [target] : []
  }

  const matchToCompany: Record<string, string> = {}
  const matchToOpportunity: Record<string, string> = {}
  const matchToApplication: Record<string, string | null> = {}
  const matchCompanyField = linkFieldFor('match', 'company')
  const matchOpportunityField = linkFieldFor('match', 'opportunity')
  const matchApplicationField = linkFieldFor('match', 'application')
  for (const m of matches) {
    matchToCompany[m.id] = firstResolved(m.id, matchCompanyField) ?? ''
    matchToOpportunity[m.id] = firstResolved(m.id, matchOpportunityField) ?? ''
    matchToApplication[m.id] = firstResolved(m.id, matchApplicationField)
  }

  const applicationToCompany: Record<string, string> = {}
  const applicationToOpportunity: Record<string, string> = {}
  const applicationToMatch: Record<string, string | null> = {}
  const applicationCompanyField = linkFieldFor('application', 'company')
  const applicationOpportunityField = linkFieldFor('application', 'opportunity')
  const applicationMatchField = linkFieldFor('application', 'match')
  for (const a of applications) {
    applicationToCompany[a.id] = firstResolved(a.id, applicationCompanyField) ?? ''
    applicationToOpportunity[a.id] = firstResolved(a.id, applicationOpportunityField) ?? ''
    applicationToMatch[a.id] = firstResolved(a.id, applicationMatchField)
  }

  const opportunityToSource: Record<string, string[]> = {}
  for (const opp of opportunities) opportunityToSource[opp.id] = []
  for (const src of sources) {
    const target = firstResolved(src.id, sourceOpportunityField)
    if (target) opportunityToSource[target] = [...(opportunityToSource[target] ?? []), src.id]
  }
  for (const k of Object.keys(opportunityToSource)) opportunityToSource[k].sort()

  // ---- Pass F2: procurement relationships ----
  // Notice is demand-side. Its only forward links are to the two EXISTING types
  // Phase 1 says to reuse: Organization (the buyer) and Source (the evidence).
  // There is no Notice -> Opportunity link (Phase 1 decision D12) and no
  // Notice -> Match link (Phase 1 section 7.2 rules Match out of procurement
  // entirely). Field names come from the registry, not from literals.
  const notices = byType<Notice>('notice')
  const noticeEntityField = linkFieldFor('notice', 'organization')
  const noticeSourcesField = linkFieldFor('notice', 'source')

  const noticeToOrganization: Record<string, string> = {}
  for (const n of notices) noticeToOrganization[n.id] = firstResolved(n.id, noticeEntityField) ?? ''

  const noticeToSource: Record<string, string[]> = {}
  for (const n of notices) {
    const targets = linksById.get(n.id)?.fields[noticeSourcesField] ?? []
    noticeToSource[n.id] = targets
      .map((t) => t.resolvedId)
      .filter((id): id is string => typeof id === 'string')
      .sort()
  }

  // ---- Pass F3: Bid relationships ----
  // Bid is the supply side: one company's response to a Notice. Phase 1
  // section 7.2 gives it exactly three forward links, and all three point at
  // types that already existed before Phase 4. Bid introduces no new type to
  // point at, and reuses Company, Notice, and Source unchanged.
  //
  // Cardinality matters here and is not symmetric with the funding types:
  //   Bid.company  N:1  -> exactly one, the lead bidder (D6 defers consortiums)
  //   Bid.notice  N:1  -> exactly one
  //   Bid.evidence_sources N:N
  // The two N:1 edges are single-value indexes, not lists, so a Bid with two
  // companies is not representable even by accident. validate.ts asserts both
  // resolve to a record of the expected type.
  const bids = byType<Bid>('bid')
  const bidCompanyField = linkFieldFor('bid', 'company')
  const bidNoticeField = linkFieldFor('bid', 'notice')
  const bidSourcesField = linkFieldFor('bid', 'source')

  const bidToCompany: Record<string, string> = {}
  const bidToNotice: Record<string, string> = {}
  const bidToSource: Record<string, string[]> = {}
  for (const b of bids) {
    bidToCompany[b.id] = firstResolved(b.id, bidCompanyField) ?? ''
    bidToNotice[b.id] = firstResolved(b.id, bidNoticeField) ?? ''
    const targets = linksById.get(b.id)?.fields[bidSourcesField] ?? []
    bidToSource[b.id] = targets
      .map((t) => t.resolvedId)
      .filter((id): id is string => typeof id === 'string')
      .sort()
  }

  // Reverse indexes. Every Notice and every Company is pre-seeded with an empty
  // list so "this tender attracted no bids from us" is an empty array in the
  // snapshot rather than a missing key, exactly as `organizationToOpportunity`
  // and `opportunityToSource` do it. That is what makes the 1:N cardinality
  // queryable in both directions without a scan.
  const noticeToBid: Record<string, string[]> = {}
  for (const n of notices) noticeToBid[n.id] = []
  for (const b of bids) {
    const noticeId = bidToNotice[b.id]
    if (noticeId) noticeToBid[noticeId] = [...(noticeToBid[noticeId] ?? []), b.id]
  }
  for (const k of Object.keys(noticeToBid)) noticeToBid[k].sort()

  const companyToBid: Record<string, string[]> = {}
  for (const c of companies) companyToBid[c.id] = []
  for (const b of bids) {
    const companyId = bidToCompany[b.id]
    if (companyId) companyToBid[companyId] = [...(companyToBid[companyId] ?? []), b.id]
  }
  for (const k of Object.keys(companyToBid)) companyToBid[k].sort()

  const sourceToBid: Record<string, string[]> = {}
  for (const s of sources) sourceToBid[s.id] = []
  for (const b of bids) {
    for (const sourceId of bidToSource[b.id] ?? []) {
      sourceToBid[sourceId] = [...(sourceToBid[sourceId] ?? []), b.id]
    }
  }
  for (const k of Object.keys(sourceToBid)) sourceToBid[k].sort()

  /* ---- Pass F4: Contract relationships ---- */
  // Contract is the post-award side: the instrument that obligates us to deliver.
  // Phase 1 section 6 gives it exactly three forward links, and all three point
  // at types that already existed. Contract introduces no new type to point at,
  // and reuses Company, Notice, and Bid unchanged.
  //
  // Cardinality, and one asymmetry with every other type in this file:
  //   Contract.notice   N:1   -> exactly one, required
  //   Contract.company  N:1   -> exactly one, required
  //   Contract.bid      N:0..1 -> ZERO OR ONE, and zero is legitimate
  //
  // That last one is the reason `bidToContract` is a LIST and not a single value.
  // Phase 1 section 7.1 corrected Bid -> Contract from 0..1 to 0..N precisely
  // because one award can produce a contract per awarded lot; a single-value
  // index would silently lose every contract after the first. The cost is that
  // `Contract.bid` must tolerate a blank, which is why it is the only optional
  // link in the procurement model and why invariant 3 pairs a blank `bid` with
  // a non-blank `contract_basis`.
  const contracts = byType<Contract>('contract')
  const contractNoticeField = linkFieldFor('contract', 'notice')
  const contractBidField = linkFieldFor('contract', 'bid')
  const contractCompanyField = linkFieldFor('contract', 'company')

  const contractToNotice: Record<string, string> = {}
  const contractToCompany: Record<string, string> = {}
  const contractToBid: Record<string, string> = {}
  for (const ct of contracts) {
    contractToNotice[ct.id] = firstResolved(ct.id, contractNoticeField) ?? ''
    contractToCompany[ct.id] = firstResolved(ct.id, contractCompanyField) ?? ''
    // '' is the honest resolved value for a non-competitive award, and is
    // distinct from 'unresolved'. The field is optional, so a blank here is
    // permitted and is NOT recorded as an unresolved link.
    contractToBid[ct.id] = firstResolved(ct.id, contractBidField) ?? ''
  }

  // Reverse indexes, each pre-seeded with an empty list for every parent so
  // "this bid produced no contract" is an empty array rather than a missing key.
  const bidToContract: Record<string, string[]> = {}
  for (const b of bids) bidToContract[b.id] = []
  for (const ct of contracts) {
    const bidId = contractToBid[ct.id]
    if (bidId) bidToContract[bidId] = [...(bidToContract[bidId] ?? []), ct.id]
  }
  for (const k of Object.keys(bidToContract)) bidToContract[k].sort()

  const noticeToContract: Record<string, string[]> = {}
  for (const n of notices) noticeToContract[n.id] = []
  for (const ct of contracts) {
    const noticeId = contractToNotice[ct.id]
    if (noticeId) noticeToContract[noticeId] = [...(noticeToContract[noticeId] ?? []), ct.id]
  }
  for (const k of Object.keys(noticeToContract)) noticeToContract[k].sort()

  const companyToContract: Record<string, string[]> = {}
  for (const c of companies) companyToContract[c.id] = []
  for (const ct of contracts) {
    const companyId = contractToCompany[ct.id]
    if (companyId) companyToContract[companyId] = [...(companyToContract[companyId] ?? []), ct.id]
  }
  for (const k of Object.keys(companyToContract)) companyToContract[k].sort()

  // Phase P Procurement Match: the procurement counterpart of Match. Each match
  // pairs one Notice with one Company, both required, both single. The two
  // forward indexes are the only relationships (the record carries no
  // Opportunity/Bid/Contract link to point anywhere else).
  const procurementMatches = byType<ProcurementMatch>('procurement_match')
  const pmatchNoticeField = linkFieldFor('procurement_match', 'notice')
  const pmatchCompanyField = linkFieldFor('procurement_match', 'company')

  const procurementMatchToNotice: Record<string, string> = {}
  const procurementMatchToCompany: Record<string, string> = {}
  for (const pm of procurementMatches) {
    procurementMatchToNotice[pm.id] = firstResolved(pm.id, pmatchNoticeField) ?? ''
    procurementMatchToCompany[pm.id] = firstResolved(pm.id, pmatchCompanyField) ?? ''
  }

  const relationships: Relationships = {
    organizationToOpportunity,
    sourceToOpportunity,
    matchToCompany,
    matchToOpportunity,
    matchToApplication,
    applicationToCompany,
    applicationToOpportunity,
    applicationToMatch,
    opportunityToSource,
    noticeToOrganization,
    noticeToSource,
    bidToCompany,
    bidToNotice,
    bidToSource,
    noticeToBid,
    companyToBid,
    sourceToBid,
    contractToNotice,
    contractToCompany,
    contractToBid,
    bidToContract,
    noticeToContract,
    companyToContract,
    procurementMatchToNotice,
    procurementMatchToCompany,
  }

  const sortUnresolved = (u: UnresolvedLink[]): UnresolvedLink[] =>
    [...u].sort((a, b) =>
      (a.fromId + a.origin + a.field).localeCompare(b.fromId + b.origin + b.field),
    )

  const snapshot: VaultSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    source: {
      vaultDirectoryName: path.basename(vaultRoot),
      contentFileCount: listContentFiles(vaultRoot).length,
      recordCount: productionStaged.length,
      totalSchemaFields: TOTAL_SCHEMA_FIELDS,
    },
    // Literal keys: `VaultSnapshot.records` is a concrete interface, so the
    // compiler checks these ten against the generated shape. The registry's
    // COLLECTION_KEY is checked against them at runtime by validate.ts.
    records: {
      opportunities,
      companies,
      matches,
      applications,
      organizations,
      sources,
      notices,
      bids,
      contracts,
      procurement_matches: procurementMatches,
    },
    relationships,
    unresolvedLinks: sortUnresolved(unresolvedLinks),
  }

  return {
    snapshot,
    unresolvedLinks: snapshot.unresolvedLinks,
    excludedFictionalIds,
    ambiguous,
    parseWarnings,
  }
}

/** Deterministic serialisation: stable key order, 2-space indent, trailing newline. */
export function serializeSnapshot(s: VaultSnapshot): string {
  return JSON.stringify(s, null, 2) + '\n'
}
