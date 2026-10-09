/**
 * The single authoritative record-type registry.
 *
 * Everything that varies per record type lives here exactly once: the ID field
 * and prefix, the snapshot collection key, the route segment, the vault
 * directory, the singular/plural labels, the display-name field, and the
 * name fields that authored markers may appear in.
 *
 * The rest of the codebase DERIVES its maps from this file rather than
 * restating them. Adding a record type is a one-place change, and a map that
 * silently drifts out of step is a compile error instead of a runtime surprise.
 *
 * `RecordType` itself is defined here, not in `types/records.ts`, because both
 * the importer and the UI need it and neither should own it. `types/records.ts`
 * re-exports it, so existing imports keep working.
 *
 * Scope: the six funding record types plus the three procurement types, Notice,
 * Bid, and Contract, plus the procurement-side Procurement Match (Phase P
 * founder decision: procurement requires automation equivalent to funding, as a
 * separate type — the funding Match is untouched).
 *
 * The Phase 2 scope guard ("six approved types only, no procurement records")
 * was correct while Notice did not exist. It was replaced deliberately in
 * Phase 3, again in Phase 4, and again in Phase 6, never weakened: Contract is
 * now present, and Lot is still absent, so
 * `src/import/schema-validation.test.ts` fails if Lot appears.
 */

export type RecordType =
  | 'opportunity'
  | 'company'
  | 'match'
  | 'application'
  | 'organization'
  | 'source'
  | 'notice'
  | 'bid'
  | 'contract'
  | 'procurement_match'

export interface RecordTypeConfig {
  /** Frontmatter field holding the record ID, e.g. `opportunity_id`. */
  readonly idField: string
  /** ID prefix, e.g. `OPP`. IDs are `<prefix>-<3 digits>`. */
  readonly idPrefix: string
  /** Key under `snapshot.records`, e.g. `opportunities`. */
  readonly collectionKey: string
  /** Route segment, e.g. `/opportunities`. */
  readonly collectionPath: string
  /** Vault directory name, read-only, e.g. `01 - Opportunities`. */
  readonly recordDir: string
  /** Singular human label, e.g. `Opportunity`. */
  readonly label: string
  /** Plural human label, e.g. `Opportunities`. */
  readonly pluralLabel: string
  /** Field used as the record's display title. */
  readonly titleField: string
  /**
   * Fields whose text counts as an AUTHORED name marker for fictional-record
   * classification. Deliberately narrow: free text in any other field is never
   * a marker. Empty for types that have no name field (Match, Application).
   */
  readonly nameFields: readonly string[]
  /**
   * Approved relationship link fields on this type, and the record type each
   * one points at. This is the wiring behind the derived relationship indexes.
   * A field that points at no single type is not listed here; the reverse
   * indexes (Source -> Opportunity, Organization -> Opportunity) are built by
   * reversing a forward link.
   */
  readonly links: readonly { readonly field: string; readonly pointsTo: RecordType }[]
  /** Sidebar description, shown on the collection page. */
  readonly description: string
}

export const RECORD_REGISTRY: Record<RecordType, RecordTypeConfig> = {
  opportunity: {
    idField: 'opportunity_id',
    idPrefix: 'OPP',
    collectionKey: 'opportunities',
    collectionPath: 'opportunities',
    recordDir: '01 - Opportunities',
    label: 'Opportunity',
    pluralLabel: 'Opportunities',
    titleField: 'opportunity_name',
    nameFields: ['opportunity_name'],
    links: [{ field: 'provider', pointsTo: 'organization' }],
    description: 'Government and institutional funding programmes.',
  },
  company: {
    idField: 'company_id',
    idPrefix: 'COMP',
    collectionKey: 'companies',
    collectionPath: 'companies',
    recordDir: '02 - Companies',
    label: 'Company',
    pluralLabel: 'Companies',
    titleField: 'company_name',
    nameFields: ['company_name'],
    links: [],
    description: 'Company profiles that opportunities are matched against.',
  },
  match: {
    idField: 'match_id',
    idPrefix: 'MATCH',
    collectionKey: 'matches',
    collectionPath: 'matches',
    recordDir: '03 - Matches',
    label: 'Match',
    pluralLabel: 'Matches',
    titleField: 'match_id',
    nameFields: [],
    links: [
      { field: 'company', pointsTo: 'company' },
      { field: 'opportunity', pointsTo: 'opportunity' },
      { field: 'linked_application', pointsTo: 'application' },
    ],
    description: 'Opportunity-to-company match assessments.',
  },
  application: {
    idField: 'application_id',
    idPrefix: 'APP',
    collectionKey: 'applications',
    collectionPath: 'applications',
    recordDir: '04 - Applications',
    label: 'Application',
    pluralLabel: 'Applications',
    titleField: 'application_id',
    nameFields: [],
    links: [
      { field: 'company', pointsTo: 'company' },
      { field: 'opportunity', pointsTo: 'opportunity' },
      { field: 'match', pointsTo: 'match' },
    ],
    description: 'Application records and their current status.',
  },
  organization: {
    idField: 'organization_id',
    idPrefix: 'ORG',
    collectionKey: 'organizations',
    collectionPath: 'organizations',
    recordDir: '05 - Organizations',
    label: 'Organization',
    pluralLabel: 'Organizations',
    titleField: 'organization_name',
    nameFields: ['organization_name'],
    links: [],
    description: 'Government bodies, institutions, and agencies, with roles derived from record links.',
  },
  source: {
    idField: 'source_id',
    idPrefix: 'SRC',
    collectionKey: 'sources',
    collectionPath: 'sources',
    recordDir: '06 - Sources',
    label: 'Source',
    pluralLabel: 'Sources',
    titleField: 'source_name',
    nameFields: ['source_name'],
    links: [{ field: 'related_opportunity', pointsTo: 'opportunity' }],
    description: 'Source = provenance/evidence origin for the linked opportunity (not an independent verification claim).',
  },
  notice: {
    idField: 'notice_id',
    idPrefix: 'RFB',
    collectionKey: 'notices',
    collectionPath: 'notices',
    recordDir: '09 - Notices',
    label: 'Notice',
    pluralLabel: 'Notices',
    titleField: 'notice_name',
    nameFields: ['notice_name'],
    links: [
      { field: 'procuring_entity', pointsTo: 'organization' },
      { field: 'linked_sources', pointsTo: 'source' },
    ],
    description:
      'Buyer procurement notices: what a buyer has published to invite bids. Not a funding opportunity.',
  },
  bid: {
    idField: 'bid_id',
    idPrefix: 'BID',
    collectionKey: 'bids',
    collectionPath: 'bids',
    // Phase 1 section 11 proposed `08 - Bids`. `08` is already
    // `08 - Documentation`, so the next free number is used instead. This repeats
    // the choice Phase 3 made: Phase 11 proposed `07 - Notices`, `07` was
    // `07 - Templates`, and Notice went to `09 - Notices`.
    recordDir: '10 - Bids',
    label: 'Bid',
    pluralLabel: 'Bids',
    // Bid has no name field, exactly as Match and Application do not. The ID is
    // the display title and no name text exists to scan for a fictional marker,
    // so a Bid is classified by filename marker, body banner, or a link to a
    // fictional record.
    titleField: 'bid_id',
    nameFields: [],
    links: [
      { field: 'company', pointsTo: 'company' },
      { field: 'notice', pointsTo: 'notice' },
      { field: 'evidence_sources', pointsTo: 'source' },
    ],
    description:
      "One company's pursuit decision and submission against a Notice: whether we may bid, whether we chose to, and where the bid stands.",
  },
  contract: {
    idField: 'contract_id',
    idPrefix: 'CON',
    collectionKey: 'contracts',
    collectionPath: 'contracts',
    // Phase 1 section 11 proposed `09 - Contracts`, but `09` went to
    // `09 - Notices` in Phase 3 and `10` to `10 - Bids` in Phase 4. This is the
    // third repeat of one documented deviation, not a third exception: the
    // procurement folders are numbered in lifecycle order, and the next free
    // number after Bids is used. See `RECORD_TYPES` for why ordering is fixed.
    recordDir: '11 - Contracts',
    label: 'Contract',
    pluralLabel: 'Contracts',
    // `contract_number` is the display title, not `contract_title`. Phase 1
    // section 6 marks `contract_number` required and `contract_title` optional,
    // so the title field must be one that every Contract actually has: a record
    // with no `contract_title` still has a reference worth listing and linking.
    // Match and Application set the same precedent with their ID fields.
    titleField: 'contract_number',
    // Empty, exactly as Bid's is. `contract_title` is optional, so it cannot be
    // an authored-name guarantee, and the ID plus `contract_number` are the
    // stable handles. A Contract is classified by filename marker, body banner,
    // or a link to a fictional record instead.
    nameFields: [],
    links: [
      { field: 'notice', pointsTo: 'notice' },
      { field: 'bid', pointsTo: 'bid' },
      { field: 'company', pointsTo: 'company' },
    ],
    description:
      'Post-award instruments: what we are contractually obliged to deliver, for how much, and where delivery, acceptance, and payment stand.',
  },
  procurement_match: {
    idField: 'procurement_match_id',
    idPrefix: 'PMATCH',
    collectionKey: 'procurement_matches',
    collectionPath: 'procurement-matches',
    // No vault directory exists yet: no Procurement Match record has ever been
    // filed, and this phase creates none. The directory name is reserved here
    // so the convention is fixed before the first record arrives.
    recordDir: '12 - Procurement Matches',
    label: 'Procurement Match',
    pluralLabel: 'Procurement Matches',
    // Like Match, Bid, and Application, the ID is the display title: there is
    // no name field to scan, so classification follows links and filename.
    titleField: 'procurement_match_id',
    nameFields: [],
    links: [
      { field: 'notice', pointsTo: 'notice' },
      { field: 'company', pointsTo: 'company' },
    ],
    description:
      'Notice-to-company match assessments for procurement: the counterpart of Match on the funding side, with no link to Opportunity.',
  },
}

/**
 * Registry order. This is the order used for import, validation, and every
 * derived list, so output is deterministic without a separate sort.
 *
 * The three procurement types are LAST on purpose. They are not funding types,
 * so they must not be interleaved with the six funding collections: sidebar
 * order, dashboard order, and derived lists all keep the funding platform intact
 * and procurement reads as one clearly separated addition.
 *
 * Within procurement the order is the lifecycle: a Notice attracts Bids, and an
 * award on a Bid produces a Contract. Each parent is imported before its child,
 * so `noticeToBid`, `bidToContract`, and `noticeToContract` all have a
 * population to attach to when they are built. Contract closes the lifecycle
 * order because it is the only procurement type that can legally point at a
 * blank `bid`: a non-competitive award has no Bid to resolve.
 *
 * Procurement Match closes the procurement list, after Contract, so every
 * existing index is stable. It references only earlier types (Notice, Company),
 * so import order stays parent-before-child throughout.
 */
export const RECORD_TYPES: readonly RecordType[] = [
  'opportunity',
  'company',
  'match',
  'application',
  'organization',
  'source',
  'notice',
  'bid',
  'contract',
  'procurement_match',
]

/** Type guard for a value coming from data rather than from code. */
export const isRecordType = (value: unknown): value is RecordType =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(RECORD_REGISTRY, value)

/** Build a `Record<RecordType, V>` by projecting every type through `f`. */
function keyed<V>(f: (type: RecordType, config: RecordTypeConfig) => V): Record<RecordType, V> {
  const out = {} as Record<RecordType, V>
  for (const type of RECORD_TYPES) out[type] = f(type, RECORD_REGISTRY[type])
  return out
}

/** Record type -> ID field. Replaces the hand-written `ID_FIELD` table. */
export const ID_FIELD: Record<RecordType, string> = keyed((_, c) => c.idField)

/** Record type -> vault directory. Replaces the hand-written `RECORD_DIRS`. */
export const RECORD_DIRS: Record<RecordType, string> = keyed((_, c) => c.recordDir)

/** Record type -> snapshot collection key, e.g. `opportunity` -> `opportunities`. */
export const COLLECTION_KEY: Record<RecordType, string> = keyed((_, c) => c.collectionKey)

/** Record type -> route segment. */
export const COLLECTION_PATH: Record<RecordType, string> = keyed((_, c) => c.collectionPath)

/** Record type -> singular label. */
export const TYPE_LABEL: Record<RecordType, string> = keyed((_, c) => c.label)

/** Record type -> plural label. Declared, not pluralised by a suffix rule. */
export const TYPE_PLURAL_LABEL: Record<RecordType, string> = keyed((_, c) => c.pluralLabel)

/** Record type -> display-name field. */
export const TITLE_FIELD: Record<RecordType, string> = keyed((_, c) => c.titleField)

/** Record type -> authored name-marker fields. */
export const NAME_FIELDS: Record<RecordType, readonly string[]> = keyed((_, c) => c.nameFields)

/** Snapshot collection keys in registry order. */
export const COLLECTION_KEYS: readonly string[] = RECORD_TYPES.map((t) => COLLECTION_KEY[t])

/** The collection key a record type is stored under. */
export const collectionKeyOf = (type: RecordType): string => COLLECTION_KEY[type]

/**
 * The approved link field on `type` that points at `pointsTo`.
 *
 * Throws rather than returning a guess, so a relationship index can never be
 * wired to a field that the registry does not sanction.
 */
export function linkFieldFor(type: RecordType, pointsTo: RecordType): string {
  const found = RECORD_REGISTRY[type].links.find((l) => l.pointsTo === pointsTo)
  if (!found) {
    throw new Error(
      `No approved link on "${type}" points at "${pointsTo}". ` +
        `Known: ${RECORD_REGISTRY[type].links.map((l) => `${l.field}->${l.pointsTo}`).join(', ') || '(none)'}`,
    )
  }
  return found.field
}

/** All distinct ID prefixes, sorted longest-first so `APP` cannot shadow a longer prefix. */
export const ID_PREFIXES: readonly string[] = [
  ...new Set(RECORD_TYPES.map((t) => RECORD_REGISTRY[t].idPrefix)),
].sort((a, b) => b.length - a.length || a.localeCompare(b))

/** The expected ID shape for one type, e.g. `/^OPP-\d{3}$/`. */
export function idPatternFor(type: RecordType): RegExp {
  return new RegExp(`^${RECORD_REGISTRY[type].idPrefix}-\\d{3}$`)
}

/**
 * Any known record ID at the start of a link target.
 *
 * Built from the registry, so adding a type updates link resolution too. The
 * alternation is sorted longest-first and each alternative is escaped, because
 * the prefixes are literal text, not a pattern.
 */
const ID_AT_START = new RegExp(`^(${ID_PREFIXES.map(escapeRe).join('|')})-\\d{3}\\b`)

/** A record ID at the start of a string, e.g. `OPP-001` in `OPP-001 — Seed Fund`. */
export function idFromTarget(target: string): string | null {
  const m = ID_AT_START.exec(target)
  return m ? m[0] : null
}

/** The record type an ID belongs to, derived from the registry prefix. */
export function typeForId(id: string): RecordType | null {
  const dash = id.indexOf('-')
  if (dash < 0) return null
  const prefix = id.slice(0, dash)
  return RECORD_TYPES.find((t) => RECORD_REGISTRY[t].idPrefix === prefix) ?? null
}

/** Escape a literal for embedding in a regular expression. */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
