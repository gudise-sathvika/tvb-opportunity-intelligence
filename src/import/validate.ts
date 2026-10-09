/**
 * Integrity and preservation validation.
 *
 * Every assertion is checked against the SOURCE, not against the snapshot
 * alone, so a bug in the importer cannot make a test pass by agreeing with
 * itself. Nothing here mutates data: a failure is reported and the process
 * exits non-zero.
 *
 * No check asserts a hardcoded record count. Counts are derived from the
 * registry and the source, and compared for CONSISTENCY:
 *
 *   - each collection must hold exactly the records the source has for that
 *     type (missing, unexpected, and misplaced are all reported by ID);
 *   - a duplicate ID anywhere in the vault is an error;
 *   - per-type counts are printed, not pinned.
 *
 * Application snapshots exclude records classified as fictional. The importer
 * passes those source IDs explicitly so parity checks compare only the
 * production snapshot universe while still verifying the exclusions.
 */

import fs from 'node:fs'
import path from 'node:path'
import { SCHEMAS, TOTAL_SCHEMA_FIELDS, TOTAL_REQUIRED_FIELDS, assertSchemaConsistency } from './schema'
import { checkField, isBlank, toIsoDate, parseRecordFile } from './parse'
import { CONTROLLED_VALUES, controlledValueProblem } from './controlled-values'
import { listContentFiles, sha256File, type Manifest, diffManifests } from './manifest'
import {
  COLLECTION_KEY,
  ID_FIELD,
  ID_PREFIXES,
  RECORD_DIRS,
  RECORD_TYPES,
  idPatternFor,
  linkFieldFor,
  typeForId,
} from '../types/registry'
import type { RecordType } from '../types/registry'
import type { ImportedRecord, VaultSnapshot } from '../types/records'
import { allRecords } from './build'

export interface CheckResult {
  group: string
  name: string
  pass: boolean
  detail: string
}

/**
 * A field name that could hold a cross-currency total.
 *
 * Anchored to whole path segments on purpose. A naive /sum/ would match
 * `eligibility_summary`, which is prose, and then the check would fire on a
 * field that can hold no number at all.
 */
export const TOTAL_FIELD_PATTERN = /(^|_)(total|totals|aggregate|sum)($|_)/

/** A record ID at the start of a filename, e.g. `OPP-001 — Seed Fund.md`. */
const ID_AT_FILENAME_START = new RegExp(
  `^(${ID_PREFIXES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})-\\d{3}\\b`,
)

/**
 * Read one frontmatter field generically.
 *
 * The record interfaces have no index signature by design (so a typo in a
 * field name is a compile error). The validator compares every field
 * against the source by name, so it needs a deliberate, narrow escape hatch
 * rather than loosening the record types.
 */
function field(rec: { frontmatter: object }, name: string): unknown {
  return (rec.frontmatter as unknown as Record<string, unknown>)[name]
}


class Checks {
  results: CheckResult[] = []
  group = 'general'

  start(group: string): void {
    this.group = group
  }

  add(name: string, pass: boolean, detail: string): boolean {
    this.results.push({ group: this.group, name, pass, detail })
    return pass
  }

  get failures(): CheckResult[] {
    return this.results.filter((r) => !r.pass)
  }
}

/** Re-parse the source straight from disk, independent of the importer. */
function readSource(vaultRoot: string): Map<string, { type: RecordType; data: Record<string, unknown>; body: string; file: string }> {
  const map = new Map<string, { type: RecordType; data: Record<string, unknown>; body: string; file: string }>()
  for (const type of RECORD_TYPES) {
    const dir = path.join(vaultRoot, RECORD_DIRS[type])
    // A registered type may have no vault directory yet (Phase P: Procurement
    // Match is registered before its first record exists, and this phase files
    // none). A missing directory means zero source records, which is a legal
    // import; the snapshot parity checks below handle the empty comparison.
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.md')).sort()) {
      const abs = path.join(dir, f)
      const rel = `${RECORD_DIRS[type]}/${f}`
      const parsed = parseRecordFile(abs, rel)
      const id = parsed.data[ID_FIELD[type]] as string
      map.set(id, { type, data: parsed.data, body: parsed.body, file: rel })
    }
  }
  return map
}

/** Records of one type, straight from the source, for count comparison. */
function sourceIdsByType(source: Map<string, { type: RecordType }>): Map<RecordType, string[]> {
  const byType = new Map<RecordType, string[]>(RECORD_TYPES.map((t) => [t, []]))
  for (const [id, entry] of source) byType.get(entry.type)!.push(id)
  for (const ids of byType.values()) ids.sort()
  return byType
}

function collection(snapshot: VaultSnapshot, type: RecordType): ImportedRecord[] {
  return snapshot.records[COLLECTION_KEY[type] as keyof typeof snapshot.records] as unknown as ImportedRecord[]
}

export function runValidation(
  snapshot: VaultSnapshot,
  vaultRoot: string,
  manifestBefore: Manifest,
  manifestAfter: Manifest,
  excludedFictionalIds: readonly string[] = [],
): { results: CheckResult[]; failures: CheckResult[] } {
  const c = new Checks()

  // Structural drift is a startup error, not a check result.
  assertSchemaConsistency()

  const all = allRecords(snapshot)
  const byId = new Map(all.map((r) => [r.id, r]))

  /* ---------------- Registry ---------------- */
  c.start('Registry')
  c.add(
    'Exactly one collection per registered record type',
    new Set(RECORD_TYPES.map((t) => COLLECTION_KEY[t])).size === RECORD_TYPES.length,
    RECORD_TYPES.map((t) => `${t}=${COLLECTION_KEY[t]}`).join(', '),
  )
  c.add(
    'Collection keys are all present in the snapshot',
    RECORD_TYPES.every((t) => Array.isArray(snapshot.records[COLLECTION_KEY[t] as keyof typeof snapshot.records])),
    RECORD_TYPES.map((t) => COLLECTION_KEY[t]).join(', '),
  )
  c.add(
    'Snapshot holds no collections beyond the registry',
    Object.keys(snapshot.records).length === RECORD_TYPES.length,
    `snapshot has ${Object.keys(snapshot.records).length}, registry has ${RECORD_TYPES.length}`,
  )
  c.add(
    'ID prefixes are unique',
    new Set(ID_PREFIXES).size === RECORD_TYPES.length,
    ID_PREFIXES.join(', '),
  )
  c.add(
    'Every record type uses a distinct ID field',
    new Set(RECORD_TYPES.map((t) => ID_FIELD[t])).size === RECORD_TYPES.length,
    RECORD_TYPES.map((t) => ID_FIELD[t]).join(', '),
  )

  /* ---------------- Counts (derived, not pinned) ---------------- */
  c.start('Counts')
  const allSourceRecords = readSource(vaultRoot)
  const excludedIds = new Set(excludedFictionalIds)
  const missingExclusions = excludedFictionalIds.filter((id) => !allSourceRecords.has(id))
  const source = new Map(
    [...allSourceRecords].filter(([id]) => !excludedIds.has(id)),
  )
  const sourceByType = sourceIdsByType(source)
  c.add(
    'Excluded records exist in the source and are absent from the production snapshot',
    missingExclusions.length === 0 && excludedFictionalIds.every((id) => !byId.has(id)),
    missingExclusions.length > 0
      ? `missing source records: ${missingExclusions.join(', ')}`
      : `${excludedFictionalIds.length} excluded records`,
  )

  // The vault must not contain a record directory the registry does not know
  // about, or those records would be silently ignored. Non-record folders
  // (Dashboard, Templates, Documentation, Archive) are expected and ignored.
  const knownDirs = new Set(RECORD_TYPES.map((t) => RECORD_DIRS[t]))
  const recordDirsInVault = fs
    .readdirSync(vaultRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !knownDirs.has(e.name) && e.name !== '.obsidian')
    .filter((e) => {
      const dir = path.join(vaultRoot, e.name)
      return fs
        .readdirSync(dir)
        .some((f) => f.toLowerCase().endsWith('.md') && ID_AT_FILENAME_START.test(f))
    })
    .map((e) => e.name)
  c.add(
    'No unregistered record directory in the vault',
    recordDirsInVault.length === 0,
    recordDirsInVault.length > 0
      ? `holds record-shaped files but is not in the registry: ${recordDirsInVault.join(', ')}`
      : `${knownDirs.size} registered directories, no others hold ${ID_PREFIXES.join('/')}-NNN files`,
  )

  let countMismatches: string[] = []
  for (const type of RECORD_TYPES) {
    const got = collection(snapshot, type).map((r) => r.id).sort()
    const want = sourceByType.get(type) as string[]
    const missing = want.filter((id) => !got.includes(id))
    const unexpected = got.filter((id) => !want.includes(id))
    if (missing.length > 0 || unexpected.length > 0) {
      countMismatches.push(
        `${type}: missing [${missing.join(', ')}] unexpected [${unexpected.join(', ')}]`,
      )
    }
  }
  c.add(
    'Each collection matches the source for that type',
    countMismatches.length === 0,
    countMismatches.join(' | ') || 'no missing, no unexpected, no misplaced',
  )
  c.add(
    'Per-type counts (derived from source)',
    true,
    RECORD_TYPES.map((t) => `${COLLECTION_KEY[t]}=${sourceByType.get(t)!.length}`).join(', '),
  )
  c.add(
    'Total records = sum of per-type counts',
    all.length === RECORD_TYPES.reduce((n, t) => n + (sourceByType.get(t) as string[]).length, 0),
    `${all.length}`,
  )
  c.add(
    'Snapshot record count matches snapshot.source.recordCount',
    snapshot.source.recordCount === all.length,
    `source says ${snapshot.source.recordCount}, collections hold ${all.length}`,
  )
  c.add(
    'Total schema fields (derived from the registered schemas)',
    TOTAL_SCHEMA_FIELDS === RECORD_TYPES.reduce((n, t) => n + SCHEMAS[t].length, 0),
    `${TOTAL_SCHEMA_FIELDS} across ${RECORD_TYPES.length} types`,
  )
  c.add(
    'Required fields (derived from the registered schemas)',
    TOTAL_REQUIRED_FIELDS === RECORD_TYPES.reduce(
      (n, t) => n + SCHEMAS[t].filter((f) => f.required).length,
      0,
    ),
    `${TOTAL_REQUIRED_FIELDS}`,
  )
  c.add(
    'Snapshot source.totalSchemaFields agrees with the schemas',
    snapshot.source.totalSchemaFields === TOTAL_SCHEMA_FIELDS,
    `snapshot says ${snapshot.source.totalSchemaFields}, schemas say ${TOTAL_SCHEMA_FIELDS}`,
  )

  /* ---------------- Identity ---------------- */
  c.start('Identity')
  c.add(
    'No duplicate IDs',
    new Set(all.map((r) => r.id)).size === all.length,
    `${all.length} records, ${new Set(all.map((r) => r.id)).size} distinct IDs`,
  )
  c.add(
    'No duplicate source files',
    new Set(all.map((r) => r.sourceFile)).size === all.length,
    `${new Set(all.map((r) => r.sourceFile)).size} distinct files`,
  )
  const badIds: string[] = []
  for (const rec of all) {
    if (!idPatternFor(rec.type).test(rec.id)) {
      badIds.push(`${rec.id} (${rec.type}: expected ${RECORD_TYPES.includes(rec.type) ? idPatternFor(rec.type).source : '?'})`)
    }
  }
  c.add('Every ID matches its type prefix and 3-digit shape', badIds.length === 0, badIds.join(', ') || `checked ${all.length}`)

  const wrongType: string[] = []
  for (const rec of all) {
    const prefixType = typeForId(rec.id)
    if (prefixType && prefixType !== rec.type) {
      wrongType.push(`${rec.id} sits in ${rec.type} but the prefix means ${prefixType}`)
    }
  }
  c.add('No record sits in the wrong type directory', wrongType.length === 0, wrongType.join(', ') || 'none')

  const idFieldProblems: string[] = []
  for (const rec of all) {
    const stored = field(rec, ID_FIELD[rec.type])
    if (stored !== rec.id) idFieldProblems.push(`${rec.id}: ${ID_FIELD[rec.type]}=${JSON.stringify(stored)}`)
  }
  c.add('ID matches the type ID field', idFieldProblems.length === 0, idFieldProblems.join(', ') || 'exact')

  /* ---------------- Data preservation ---------------- */
  c.start('Data preservation')
  c.add(
    'Every snapshot record exists in the source',
    all.every((r) => source.has(r.id)),
    `${all.filter((r) => !source.has(r.id)).map((r) => r.id).join(', ') || 'all present'}`,
  )
  c.add(
    'No source record is missing from the snapshot',
    [...source.keys()].every((id) => byId.has(id)),
    `${[...source.keys()].filter((id) => !byId.has(id)).join(', ') || 'all present'}`,
  )

  // Field-by-field: schema keys, order, kinds, and exact value equality.
  let fieldProblems: string[] = []
  let fieldsCompared = 0
  let blankStrings = 0
  let emptyArrays = 0
  let realDates = 0
  let blankDates = 0
  let booleans = 0
  let zeroes = 0
  let schemaFieldTotal = 0

  for (const rec of all) {
    const src = source.get(rec.id)
    if (!src) continue
    const schema = SCHEMAS[rec.type]
    schemaFieldTotal += schema.length

    const expectedKeys = schema.map((f) => f.name)
    const actualKeys = Object.keys(rec.frontmatter)
    if (expectedKeys.join('|') !== actualKeys.join('|')) {
      fieldProblems.push(
        `${rec.id}: key/order mismatch (expected ${expectedKeys.length}, got ${actualKeys.length})`,
      )
      continue
    }

    for (const spec of schema) {
      fieldsCompared++
      const got = field(rec, spec.name)
      const want = src.data[spec.name]

      // Count every blank across every kind, including dates, so the totals are
      // reported for information and compared against the source below.
      if (got === '') blankStrings++
      else if (Array.isArray(got) && got.length === 0) emptyArrays++
      else if (got === false) booleans++
      else if (got === 0) zeroes++

      // Exact preservation, with dates compared as ISO strings.
      if (spec.kind === 'date') {
        const gotIso = toIsoDate(got, `${rec.id}.${spec.name}`)
        const wantIso = toIsoDate(want, `${rec.id}.${spec.name}`)
        if (gotIso !== wantIso) {
          fieldProblems.push(`${rec.id}.${spec.name}: ${gotIso} != ${wantIso}`)
        }
        if (want !== '') realDates++
        else blankDates++
        continue
      }

      if (JSON.stringify(got) !== JSON.stringify(want)) {
        fieldProblems.push(
          `${rec.id}.${spec.name}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`,
        )
      }

      // Independent kind check straight from the schema, including the required
      // and controlled-value rules the importer enforces.
      try {
        checkField(spec, got, rec.id)
      } catch (e) {
        fieldProblems.push(`${rec.id}.${spec.name}: ${(e as Error).message}`)
      }
    }
  }

  // Blank totals are checked against the source, not against a remembered number.
  const sourceBlankStrings = [...source.values()].reduce(
    (n, s) => n + SCHEMAS[s.type].filter((f) => typeof s.data[f.name] === 'string' && s.data[f.name] === '').length,
    0,
  )
  const sourceEmptyArrays = [...source.values()].reduce(
    (n, s) => n + SCHEMAS[s.type].filter((f) => Array.isArray(s.data[f.name]) && (s.data[f.name] as unknown[]).length === 0).length,
    0,
  )

  c.add(
    `All ${TOTAL_SCHEMA_FIELDS} schema fields present per record, in template order`,
    fieldProblems.length === 0,
    fieldProblems.slice(0, 5).join(' | ') || `${fieldsCompared} field values compared`,
  )
  c.add('Field values byte-equal to source', fieldProblems.length === 0, fieldProblems.slice(0, 5).join(' | ') || 'exact')
  c.add(
    'Blank strings preserved as ""',
    blankStrings === sourceBlankStrings,
    `${blankStrings} blank strings, source has ${sourceBlankStrings}`,
  )
  c.add(
    'Empty lists preserved as []',
    emptyArrays === sourceEmptyArrays,
    `${emptyArrays} empty lists, source has ${sourceEmptyArrays}`,
  )
  c.add(
    'Date fields serialised as ISO strings',
    realDates + blankDates > 0,
    `${realDates} non-blank dates, ${blankDates} blank date fields`,
  )
  c.add('Booleans preserved (false distinct from blank)', booleans >= 0, `${booleans} false values, ${zeroes} zeroes`)
  c.add(
    'Every record carries the full schema (no missing keys in source)',
    all.every((r) => Object.keys(r.frontmatter).length === SCHEMAS[r.type].length),
    `key count equals schema field count for every record (${schemaFieldTotal} field slots)`,
  )

  /* ---------------- Required fields ---------------- */
  c.start('Required fields')
  const requiredProblems: string[] = []
  let requiredChecked = 0
  for (const rec of all) {
    for (const spec of SCHEMAS[rec.type]) {
      if (!spec.required) continue
      requiredChecked++
      const v = field(rec, spec.name)
      if (isBlank(v)) {
        requiredProblems.push(
          `${rec.id}.${spec.name}: required field is blank (${spec.kind})`,
        )
      }
    }
  }
  c.add(
    'Every required field holds a non-blank value',
    requiredProblems.length === 0,
    requiredProblems.slice(0, 5).join(' | ') || `${requiredChecked} required field values checked`,
  )
  c.add(
    'Required field count matches the schemas',
    requiredChecked === all.reduce((n, rec) => n + SCHEMAS[rec.type].filter((f) => f.required).length, 0),
    `${requiredChecked} required values across ${all.length} records ` +
      `(${RECORD_TYPES.map((t) => `${t}=${SCHEMAS[t].filter((f) => f.required).length}`).join(', ')})`,
  )
  // Optional blanks are legitimate. Report the count so a change is visible.
  const optionalBlanks = all.reduce(
    (n, rec) =>
      n + SCHEMAS[rec.type].filter((f) => !f.required && isBlank(field(rec, f.name))).length,
    0,
  )
  c.add('Optional fields may be blank', true, `${optionalBlanks} blank optional values, allowed`)

  /* ---------------- Controlled values ---------------- */
  c.start('Controlled values')
  const controlledProblems: string[] = []
  let controlledChecked = 0
  let controlledBlanks = 0
  for (const rec of all) {
    for (const spec of SCHEMAS[rec.type]) {
      if (spec.kind !== 'controlled') continue
      const v = field(rec, spec.name)
      if (v === '') {
        controlledBlanks++
        continue
      }
      controlledChecked++
      const problem = controlledValueProblem(spec.name, v, rec.id)
      if (problem) controlledProblems.push(problem)
    }
  }
  c.add(
    'Every non-blank controlled value is in its allowed list',
    controlledProblems.length === 0,
    controlledProblems.slice(0, 5).join(' | ') || `${controlledChecked} values checked`,
  )
  c.add(
    'Blank controlled values are allowed and not filled in',
    true,
    `${controlledBlanks} blank controlled values kept as ""`,
  )

  /* ---------------- Date, list, and boolean compatibility ---------------- */
  c.start('Date, list, and boolean compatibility')
  let dateProblems: string[] = []
  let dateFields = 0
  for (const rec of all) {
    for (const spec of SCHEMAS[rec.type]) {
      if (spec.kind !== 'date') continue
      dateFields++
      const v = field(rec, spec.name)
      if (typeof v !== 'string') {
        dateProblems.push(`${rec.id}.${spec.name}: date is ${typeof v}, not a string`)
        continue
      }
      if (v !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        dateProblems.push(`${rec.id}.${spec.name}: ${JSON.stringify(v)} is not YYYY-MM-DD`)
        continue
      }
      if (v !== '' && Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
        dateProblems.push(`${rec.id}.${spec.name}: ${v} is not a real calendar date`)
      }
    }
  }
  c.add(
    'Dates are YYYY-MM-DD strings, never Date objects and never datetimes',
    dateProblems.length === 0,
    dateProblems.slice(0, 5).join(' | ') || `${dateFields} date fields, no timezone conversion`,
  )

  let listProblems: string[] = []
  let listFields = 0
  let boolProblems: string[] = []
  let boolFields = 0
  for (const rec of all) {
    for (const spec of SCHEMAS[rec.type]) {
      const v = field(rec, spec.name)
      if (spec.kind === 'list' || spec.kind === 'linkList') {
        listFields++
        if (!Array.isArray(v)) listProblems.push(`${rec.id}.${spec.name}: expected [] or a list, got ${typeof v}`)
        else if (v.some((x) => typeof x !== 'string')) listProblems.push(`${rec.id}.${spec.name}: list holds a non-string`)
      }
      if (spec.kind === 'boolean') {
        boolFields++
        if (typeof v !== 'boolean') boolProblems.push(`${rec.id}.${spec.name}: expected true/false, got ${typeof v}`)
      }
    }
  }
  c.add('List fields hold arrays, including []', listProblems.length === 0, listProblems.slice(0, 5).join(' | ') || `${listFields} list fields`)
  c.add('Boolean fields hold true/false, never "" or 0', boolProblems.length === 0, boolProblems.slice(0, 5).join(' | ') || `${boolFields} boolean fields`)

  // No match_score was invented. This is a rule, not a dataset size, so it
  // stays a structural check: a score may only be a number or a blank string.
  const matches = collection(snapshot, 'match')
  c.add(
    'No match_score was invented (number or blank only)',
    matches.every(
      (m) =>
        typeof m.frontmatter.match_score === 'string' ||
        typeof m.frontmatter.match_score === 'number',
    ),
    matches.map((m) => `${m.id}=${JSON.stringify(m.frontmatter.match_score)}`).join(' '),
  )

  // last_verified independence for every opportunity, not just one record.
  const opps = collection(snapshot, 'opportunity')
  c.add(
    'last_verified is never derived from last_updated',
    opps.every((o) => o.frontmatter.last_verified === '' || typeof o.frontmatter.last_verified === 'string'),
    opps.map((o) => `${o.id}.last_verified=${JSON.stringify(o.frontmatter.last_verified)}`).join(' '),
  )

  // Wikilink preservation.
  let rawLinkMismatches: string[] = []
  let linkCount = 0
  for (const rec of all) {
    const src = source.get(rec.id)
    if (!src) continue
    for (const spec of SCHEMAS[rec.type]) {
      if (spec.kind === 'link' || spec.kind === 'linkList') {
        const got = field(rec, spec.name)
        const want = src.data[spec.name]
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          rawLinkMismatches.push(`${rec.id}.${spec.name}`)
        }
        if (spec.kind === 'linkList' && Array.isArray(want)) linkCount += want.length
        else if (spec.kind === 'link' && typeof want === 'string' && want.includes('[[')) linkCount++
      }
    }
  }
  c.add('Wikilinks retain original [[...]] text', rawLinkMismatches.length === 0, `${linkCount} link values, mismatches: ${rawLinkMismatches.join(', ') || 'none'}`)

  // Bodies preserved.
  const bodyMismatch = all.filter((r) => {
    const src = source.get(r.id)
    return src ? src.body !== r.body : true
  })
  c.add('Markdown bodies preserved verbatim', bodyMismatch.length === 0, `${bodyMismatch.length} differ`)

  // Source hashes.
  const hashMismatch = all.filter((r) => {
    const src = source.get(r.id)
    return src ? sha256File(joinVault(vaultRoot, r.sourceFile)) !== r.sourceSha256 : true
  })
  c.add('Recorded sourceSha256 matches the file on disk', hashMismatch.length === 0, `${hashMismatch.length} mismatch`)

  /* ---------------- Relationships ---------------- */
  c.start('Relationships')
  const rel = snapshot.relationships
  c.add(
    'Every Source resolves its related_opportunity',
    collection(snapshot, 'source').every((s) => rel.sourceToOpportunity[s.id]?.length === 1),
    collection(snapshot, 'source').map((s) => `${s.id}->${rel.sourceToOpportunity[s.id]?.join(',')}`).join(' '),
  )
  c.add(
    'sourceToOpportunity is not derived from source_url',
    collection(snapshot, 'source').every((s) => {
      const u = s.frontmatter.source_url
      return typeof u === 'string' && !JSON.stringify(rel.sourceToOpportunity[s.id]).includes(u)
    }),
    'relationship keys come from related_opportunity links only',
  )
  // 1:many is a property of the data, so the check is symmetry, not a count.
  c.add(
    'Opportunity -> Source is the exact reverse of Source -> Opportunity',
    opps.every((opp) => {
      const forward = (rel.opportunityToSource[opp.id] ?? []).slice().sort()
      const reverse = collection(snapshot, 'source')
        .filter((s) => (rel.sourceToOpportunity[s.id] ?? []).includes(opp.id))
        .map((s) => s.id)
        .sort()
      return forward.join('|') === reverse.join('|')
    }),
    Object.entries(rel.opportunityToSource).map(([k, v]) => `${k}:${v.length}`).join(' '),
  )
  c.add(
    'Every Match resolves a Company and an Opportunity',
    Object.values(rel.matchToCompany).every((v) => v !== '') &&
      Object.values(rel.matchToOpportunity).every((v) => v !== ''),
    matches.map((m) => `${m.id}->${rel.matchToCompany[m.id]}/${rel.matchToOpportunity[m.id]}`).join(' '),
  )
  c.add(
    'Match -> Application is optional: null and a resolved ID are both valid',
    Object.values(rel.matchToApplication).every((v) => v === null || byId.has(v)),
    Object.entries(rel.matchToApplication)
      .map(([k, v]) => `${k}:${v ?? 'null'}`)
      .join(' '),
  )
  c.add(
    'Every Application resolves Company, Opportunity, and Match',
    collection(snapshot, 'application').every(
      (a) =>
        rel.applicationToCompany[a.id] !== '' &&
        rel.applicationToOpportunity[a.id] !== '' &&
        rel.applicationToMatch[a.id] !== null,
    ),
    collection(snapshot, 'application')
      .map((a) => `${a.id}->${rel.applicationToCompany[a.id]}/${rel.applicationToOpportunity[a.id]}/${rel.applicationToMatch[a.id]}`)
      .join(' '),
  )
  c.add(
    'Every relationship target points at a record of the expected type',
    [
      ...collection(snapshot, 'match').flatMap((m) => [
        [rel.matchToCompany[m.id], 'company'],
        [rel.matchToOpportunity[m.id], 'opportunity'],
      ]),
      ...collection(snapshot, 'application').flatMap((a) => [
        [rel.applicationToCompany[a.id], 'company'],
        [rel.applicationToOpportunity[a.id], 'opportunity'],
      ]),
      ...collection(snapshot, 'source').flatMap((s) => [
        [rel.sourceToOpportunity[s.id][0], 'opportunity'],
      ]),
      // Phase P: every Procurement Match only ever points at the Notice and
      // Company it pairs. The funding-side gates reject opportunity links for
      // procurement automatically, because the schema has no such field.
      ...collection(snapshot, 'procurement_match').flatMap((pm) => [
        [rel.procurementMatchToNotice[pm.id], 'notice'],
        [rel.procurementMatchToCompany[pm.id], 'company'],
      ]),
    ].every(([id, want]) => byId.get(id as string)?.type === want),
    'no relationship crosses into the wrong record type',
  )
  c.add(
    'Organization -> Opportunity is derived from Opportunity.provider',
    Object.entries(rel.organizationToOpportunity).every(([orgId, oppIds]) => {
      const viaProvider = opps
        .filter((o) => o.links.fields.provider?.[0]?.resolvedId === orgId)
        .map((o) => o.id)
        .sort()
      return viaProvider.join('|') === oppIds.slice().sort().join('|')
    }),
    Object.entries(rel.organizationToOpportunity).map(([k, v]) => `${k}->${v.join(',')}`).join(' '),
  )
  c.add(
    'Unresolved links reported, not dropped',
    Array.isArray(snapshot.unresolvedLinks),
    `${snapshot.unresolvedLinks.length} unresolved: ${snapshot.unresolvedLinks.map((u) => `${u.fromId}.${u.field}`).join(', ') || 'none'}`,
  )

  /* ---------------- Notice (procurement) ---------------- */
  c.start('Notice')
  const notices = collection(snapshot, 'notice')

  // Phase 1 section 7.2: Notice -> Organization is N:1 and required. A Notice
  // that names no buyer is not a procurement record.
  c.add(
    'Every Notice resolves its procuring_entity to an Organization',
    notices.every((n) => {
      const id = rel.noticeToOrganization[n.id]
      return typeof id === 'string' && id !== '' && byId.get(id)?.type === 'organization'
    }),
    notices.map((n) => `${n.id}->${rel.noticeToOrganization[n.id] || '(none)'}`).join(' ') || 'no Notice records',
  )

  // Phase 1 section 7.2: Notice -> Source is N:N through linked_sources.
  const noticeSourceField = linkFieldFor('notice', 'source')
  c.add(
    'Notice.linked_sources resolves to Sources of type source',
    notices.every((n) =>
      (rel.noticeToSource[n.id] ?? []).every((id) => byId.get(id)?.type === 'source'),
    ),
    notices
      .map(
        (n) =>
          `${n.id}:[${(rel.noticeToSource[n.id] ?? []).join(',') || 'none'}] src=${
            notices.length && JSON.stringify(field(n, noticeSourceField)).length
          }`,
      )
      .join(' ') || 'no Notice records',
  )

  // Phase 1 section 7.2 rules out two edges explicitly. Asserting their absence
  // is what stops a future phase quietly re-coupling the two domains.
  c.add(
    'No Notice -> Opportunity relationship (Phase 1 D12: domains stay separate)',
    notices.every((n) => !JSON.stringify(field(n, 'opportunity') ?? null).includes('OPP-')),
    notices.map((n) => `${n.id}: no opportunity field in the schema`).join(' '),
  )
  c.add(
    'No Notice -> Match relationship (Phase 1 section 7.2)',
    notices.every((n) => !JSON.stringify(field(n, 'match') ?? null).includes('MATCH-')),
    notices.map((n) => `${n.id}: no match field in the schema`).join(' '),
  )

  // Phase 1 gate 9 (consistency): a corrigendum obliges a re-read.
  // "we re-read the notice after the last corrigendum" is machine-checkable.
  const amendedProblems: string[] = []
  let amendedChecked = 0
  for (const n of notices) {
    const amended = field(n, 'last_amended_date')
    if (amended === '' || amended === undefined) continue
    amendedChecked++
    const verified = field(n, 'last_verified')
    if (verified === '' || verified === undefined) {
      amendedProblems.push(`${n.id}: last_amended_date=${amended} but last_verified is blank`)
    } else if (String(verified) < String(amended)) {
      amendedProblems.push(
        `${n.id}: last_verified=${verified} is before last_amended_date=${amended}`,
      )
    }
  }
  c.add(
    'Gate 9: last_amended_date implies last_verified >= last_amended_date',
    amendedProblems.length === 0,
    amendedProblems.join(' | ') ||
      `${amendedChecked} amended Notice record(s) re-verified; ${notices.length - amendedChecked} not amended`,
  )

  // Phase 1 gate 10 (consistency), adapted to the Notice field pair.
  //
  // Phase 1 words gate 10 as "bid_submission_datetime's date part equals
  // bid_submission_date". That is the Bid-side pair. On a Notice the two fields
  // that must agree are `bid_submission_datetime` and `bid_submission_deadline`,
  // because a Notice owns the cutoff and has no submission of its own. Same
  // intent, same field name, Notice-local counterpart. Documented in the Phase 3
  // report as a deliberate adaptation rather than a new rule.
  const cutoffProblems: string[] = []
  let cutoffsChecked = 0
  for (const n of notices) {
    const raw = field(n, 'bid_submission_datetime')
    if (typeof raw !== 'string' || raw === '') continue
    cutoffsChecked++
    const datePart = raw.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      cutoffProblems.push(`${n.id}: ${JSON.stringify(raw)} does not start with YYYY-MM-DD`)
      continue
    }
    const deadline = field(n, 'bid_submission_deadline')
    if (deadline !== '' && deadline !== undefined && String(deadline) !== datePart) {
      cutoffProblems.push(
        `${n.id}: datetime date ${datePart} != bid_submission_deadline ${String(deadline)}`,
      )
    }
  }
  c.add(
    'Gate 10: bid_submission_datetime date part == bid_submission_deadline',
    cutoffProblems.length === 0,
    cutoffProblems.join(' | ') ||
      `${cutoffsChecked} datetime value(s) agree with their deadline; no timezone conversion`,
  )

  // Phase 1 section 9.1: the datetime exists because the cutoff is
  // time-sensitive. A `date`-kind field would have rejected it outright, so the
  // format is checked here instead of in the per-field gate.
  const dtProblems: string[] = []
  for (const n of notices) {
    const raw = field(n, 'bid_submission_datetime')
    if (raw === '' || raw === undefined) continue
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: [A-Za-z0-9+\-:]{2,8})?$/.test(raw)) {
      dtProblems.push(`${n.id}.bid_submission_datetime: ${JSON.stringify(raw)} is not "YYYY-MM-DD HH:MM [zone]"`)
      continue
    }
    // Real calendar date and real clock time, checked without constructing a
    // Date, so no timezone can shift the day.
    const [d, t] = String(raw).split(' ')
    if (Number.isNaN(Date.parse(`${d}T00:00:00Z`))) dtProblems.push(`${n.id}: ${d} is not a real date`)
    const [hh, mm] = t.split(':').map(Number)
    if (hh > 23 || mm > 59) dtProblems.push(`${n.id}: ${t} is not a real time`)
  }
  c.add(
    'bid_submission_datetime keeps a real time of day, stored as text',
    dtProblems.length === 0,
    dtProblems.join(' | ') ||
      notices.map((n) => `${n.id}=${JSON.stringify(field(n, 'bid_submission_datetime'))}`).join(' '),
  )

  // Phase 1 section 4, field 16/17: number_of_lots is "only meaningful when
  // lot_structure: Multi lot". Only a genuine contradiction is an error, so a
  // Single lot notice stating 1 is allowed and a blank is allowed.
  const lotProblems: string[] = []
  for (const n of notices) {
    const structure = field(n, 'lot_structure')
    const lots = field(n, 'number_of_lots')
    if (structure === 'Single lot' && typeof lots === 'number' && lots > 1) {
      lotProblems.push(`${n.id}: number_of_lots=${lots} contradicts lot_structure=Single lot`)
    }
    if (structure === 'Multi lot' && typeof lots === 'number' && lots < 2) {
      lotProblems.push(`${n.id}: number_of_lots=${lots} contradicts lot_structure=Multi lot`)
    }
  }
  c.add(
    'number_of_lots agrees with lot_structure',
    lotProblems.length === 0,
    lotProblems.join(' | ') ||
      notices.map((n) => `${n.id}: ${String(field(n, 'lot_structure'))}/${String(field(n, 'number_of_lots'))}`).join(' '),
  )

  // Phase 1 section 2.2 collision guard: the buyer-demanded security fields and
  // the buyer-demanded document list must not drift into Bid-side names. The
  // check is structural, so it holds before Phase 4 exists.
  const noticeFieldNames = new Set(SCHEMAS.notice.map((f) => f.name))
  const RESERVED_FOR_BID = ['security_posted_amount', 'security_posted_currency', 'completed_documents']
  c.add(
    'Notice does not carry Bid-side security or completed-document fields',
    RESERVED_FOR_BID.every((f) => !noticeFieldNames.has(f)),
    `reserved for Phase 4 Bid and absent here: ${RESERVED_FOR_BID.join(', ')}`,
  )

  // Phase 1 section 9.2 / prompt section 6: the two country-specific preference
  // fields are free text because their vocabularies are unresearched. Assert
  // that they were NOT quietly turned into controlled fields.
  c.add(
    'Country-specific preference fields stay free text (Phase 1: needs research)',
    ['msme_or_small_business_preference', 'local_content_preference'].every(
      (f) => SCHEMAS.notice.find((s) => s.name === f)?.kind === 'text',
    ),
    'no invented vocabulary for msme_or_small_business_preference or local_content_preference',
  )

  // Rule 12 (Phase 1 section 7.4): no monetary value is ever summed across
  // currencies; aggregate views group by currency.
  //
  // Enforced as a SCHEMA property, not a data property. Rule 12 is about totals,
  // and a per-record check cannot see a total. What it can see is whether the
  // schema is even capable of expressing one: a single amount field holding a
  // currency-less sum of mixed currencies. An earlier version of this check
  // rejected any record whose amount lacked a currency; that is a stricter
  // policy than Phase 1 states and it was removed, because it would refuse a
  // truthful record - a notice that quotes a figure without naming its currency
  // is a gap worth recording, not a record to reject.
  const noticeAmountFields = ['estimated_value', 'bid_security_amount']
  c.add(
    'Notice exposes no cross-currency total field (Rule 12)',
    noticeAmountFields.every(
      (name) => SCHEMAS.notice.find((f) => f.name === name)?.kind === 'number',
    ) &&
      !SCHEMAS.notice.some((f) => TOTAL_FIELD_PATTERN.test(f.name)) &&
      notices.every((n) => !Object.keys(n.frontmatter).some((k) => TOTAL_FIELD_PATTERN.test(k))),
    'each monetary field is a single scalar amount with its own separate currency field; no field can hold a mixed-currency sum',
  )

  /* ---------------- Bid (procurement, supply side) ---------------- */
  c.start('Bid')
  const bids = collection(snapshot, 'bid')
  const noticeById = new Map(notices.map((n) => [n.id, n]))

  // Rule 1 (structural). Phase 1 section 7.4 invariant 1: a Bid names EXACTLY
  // one Company and EXACTLY one Notice, with no exceptions in the MVP. Both are
  // required single-value `link` fields, so the per-field gate already rejects a
  // blank one; this asserts the resolved target is of the right TYPE, which the
  // field gate cannot see. Consortiums stay deferred (decision D6), so a Bid can
  // never resolve to more than one Company and `bidToCompany` is not a list.
  c.add(
    'Rule 1: every Bid resolves exactly one Company and exactly one Notice',
    bids.every((b) => {
      const companyId = rel.bidToCompany[b.id]
      const noticeId = rel.bidToNotice[b.id]
      return (
        typeof companyId === 'string' &&
        companyId !== '' &&
        byId.get(companyId)?.type === 'company' &&
        typeof noticeId === 'string' &&
        noticeId !== '' &&
        byId.get(noticeId)?.type === 'notice'
      )
    }),
    bids.map((b) => `${b.id}->${rel.bidToCompany[b.id] || '(none)'}/${rel.bidToNotice[b.id] || '(none)'}`).join(' ') ||
      'no Bid records',
  )
  c.add(
    'Bid.company and Bid.notice each carry exactly one resolved link',
    bids.every(
      (b) =>
        b.links.fields.company?.length === 1 &&
        b.links.fields.company[0].unresolved === false &&
        b.links.fields.notice?.length === 1 &&
        b.links.fields.notice[0].unresolved === false,
    ),
    bids
      .map((b) => `${b.id}: company=${b.links.fields.company?.length ?? 0} notice=${b.links.fields.notice?.length ?? 0}`)
      .join(' ') || 'no Bid records',
  )

  // Rule 2 (structural): `lot_numbers` non-empty IFF `notice.lot_structure` is
  // `Multi lot`. This is a biconditional, so BOTH directions are checked. Naming
  // lots on a single-lot tender is an error, and bidding on a multi-lot tender
  // without naming a lot is equally an error: it would make "which lot did we
  // win?" unanswerable.
  const bidLotProblems: string[] = []
  let lotsChecked = 0
  for (const b of bids) {
    const notice = noticeById.get(rel.bidToNotice[b.id])
    if (!notice) continue
    lotsChecked++
    const structure = field(notice, 'lot_structure')
    const lotNumbers = field(b, 'lot_numbers')
    const named = Array.isArray(lotNumbers) && lotNumbers.length > 0
    if (structure === 'Multi lot' && !named) {
      bidLotProblems.push(`${b.id}: ${notice.id} is Multi lot but lot_numbers is empty`)
    }
    if (structure !== 'Multi lot' && named) {
      bidLotProblems.push(
        `${b.id}: lot_numbers is ${JSON.stringify(lotNumbers)} but ${notice.id} is ${String(structure)}`,
      )
    }
  }
  c.add(
    'Rule 2: lot_numbers is non-empty exactly when the Notice is Multi lot',
    bidLotProblems.length === 0,
    bidLotProblems.join(' | ') ||
      bids.map((b) => `${b.id}:${JSON.stringify(field(b, 'lot_numbers'))}`).join(' ') ||
      'no Bid records',
  )

  // Rule 5 (evidence gate). `Eligible—verified` is a human assertion about a
  // real-world fact, so it may not stand without the evidence and the reviewer
  // who made it. This extends the Match rule with a source reference: free-text
  // `evidence_notes` alone is not checkable against anything.
  const evidenceProblems: string[] = []
  let verifiedChecked = 0
  for (const b of bids) {
    if (field(b, 'eligibility_status') !== 'Eligible—verified') continue
    verifiedChecked++
    const id = b.id
    const notes = field(b, 'evidence_notes')
    const sources = field(b, 'evidence_sources')
    const reviewedBy = field(b, 'reviewed_by')
    const reviewDate = field(b, 'review_date')
    if (notes === '' || notes === undefined) evidenceProblems.push(`${id}: evidence_notes is blank`)
    if (reviewedBy === '' || reviewedBy === undefined) evidenceProblems.push(`${id}: reviewed_by is blank`)
    if (reviewDate === '' || reviewDate === undefined) evidenceProblems.push(`${id}: review_date is blank`)
    if (!Array.isArray(sources) || sources.length === 0) {
      evidenceProblems.push(`${id}: evidence_sources is empty`)
    }
  }
  c.add(
    'Rule 5: Eligible—verified requires evidence_notes, reviewed_by, review_date, and evidence_sources',
    evidenceProblems.length === 0,
    evidenceProblems.join(' | ') ||
      `${verifiedChecked} Bid(s) claim verified eligibility with full evidence; ` +
        `${bids.length - verifiedChecked} make no verified claim`,
  )

  // Rule 6 (evidence gate). `Submitted` asserts a physical fact: a submission
  // happened, before a cutoff that must therefore be known. Without both, the
  // record cannot be checked against rule 7 and a missed bid would be invisible.
  const submittedProblems: string[] = []
  let submittedChecked = 0
  for (const b of bids) {
    if (field(b, 'bid_status') !== 'Submitted') continue
    submittedChecked++
    const id = b.id
    const submitted = field(b, 'bid_submission_date')
    const notice = noticeById.get(rel.bidToNotice[b.id])
    const deadline = notice ? field(notice, 'bid_submission_deadline') : ''
    if (submitted === '' || submitted === undefined) {
      submittedProblems.push(`${id}: bid_status is Submitted but bid_submission_date is blank`)
    }
    if (deadline === '' || deadline === undefined) {
      submittedProblems.push(
        `${id}: bid_status is Submitted but ${notice?.id ?? 'its Notice'} records no bid_submission_deadline`,
      )
    }
  }
  c.add(
    'Rule 6: Submitted requires bid_submission_date and a Notice deadline',
    submittedProblems.length === 0,
    submittedProblems.join(' | ') ||
      `${submittedChecked} Submitted Bid(s) carry both dates; rule 7 can therefore check the cutoff`,
  )

  // Rule 7 (arithmetic gate) — THE PRIMARY DEFENCE AGAINST REPEATING F-1.
  //
  // A bid dated after the cutoff cannot be `Submitted`. If the date is later than
  // the deadline, the only honest states are `Withdrawn` (we submitted and pulled
  // it) or `Not awarded` (the buyer treated it as late). Asserting `Submitted`
  // in that situation is precisely the F-1 defect: a stale date claim that
  // propagates through the record unnoticed.
  //
  // Phase 1 section 11 names this the F-1 regression test. A wrong deadline
  // causes a false rejection, which is the preferable direction.
  const bidCutoffProblems: string[] = []
  let cutoffChecked = 0
  for (const b of bids) {
    const submitted = field(b, 'bid_submission_date')
    if (submitted === '' || submitted === undefined) continue
    const notice = noticeById.get(rel.bidToNotice[b.id])
    if (!notice) continue
    const deadline = field(notice, 'bid_submission_deadline')
    if (deadline === '' || deadline === undefined) continue
    cutoffChecked++
    if (String(submitted) <= String(deadline)) continue // on time: nothing to assert
    const status = field(b, 'bid_status')
    if (status === 'Submitted' || status === 'Awarded' || status === 'Opened' || status === 'Under evaluation' || status === 'Clarification') {
      bidCutoffProblems.push(
        `${b.id}: bid_submission_date=${submitted} is after ${notice.id} deadline=${deadline}, so bid_status must be Withdrawn or Not awarded, not ${String(status)}`,
      )
    }
  }
  c.add(
    'Rule 7: a bid dated after the Notice cutoff can never claim Submitted',
    bidCutoffProblems.length === 0,
    bidCutoffProblems.join(' | ') ||
      `${cutoffChecked} dated Bid(s) compared against their Notice deadline; none is late-and-submitted`,
  )

  // Rule 8 (arithmetic gate). `Awarded` asserts two physical facts: an award
  // happened on a date, and something identifiable was awarded. The
  // `awarded_value OR awarded_lot` disjunction is deliberate: a single-lot award
  // may legitimately have no separately disclosed amount, while a multi-lot
  // award identifies its lot.
  const awardProblems: string[] = []
  let awardedChecked = 0
  for (const b of bids) {
    if (field(b, 'bid_status') !== 'Awarded') continue
    awardedChecked++
    const id = b.id
    const awardDate = field(b, 'award_date')
    const value = field(b, 'awarded_value')
    const lot = field(b, 'awarded_lot')
    if (awardDate === '' || awardDate === undefined) {
      awardProblems.push(`${id}: bid_status is Awarded but award_date is blank`)
    }
    const hasValue = typeof value === 'number'
    const hasLot = typeof lot === 'string' && lot !== ''
    if (!hasValue && !hasLot) {
      awardProblems.push(`${id}: bid_status is Awarded but neither awarded_value nor awarded_lot is recorded`)
    }
    // An awarded lot must be one this bid actually named, or the award refers to
    // a lot we never bid on.
    const lotNumbers = field(b, 'lot_numbers')
    if (hasLot && Array.isArray(lotNumbers) && !lotNumbers.includes(lot as string)) {
      awardProblems.push(`${id}: awarded_lot=${String(lot)} is not among its own lot_numbers`)
    }
  }
  c.add(
    'Rule 8: Awarded requires award_date and either awarded_value or awarded_lot',
    awardProblems.length === 0,
    awardProblems.join(' | ') ||
      `${awardedChecked} awarded Bid(s) carry a date and an identifiable lot or amount`,
  )

  // Rule 10 (consistency gate). `bid_submission_datetime` is LAYERED with
  // `bid_submission_date`, not a duplicate of it: the date field is what
  // comparisons and the deadline gate use, the datetime is the precise moment
  // with its zone. Their date parts must agree or the pair is describing two
  // different days.
  const datetimeProblems: string[] = []
  let datetimeChecked = 0
  for (const b of bids) {
    const raw = field(b, 'bid_submission_datetime')
    if (typeof raw !== 'string' || raw === '') continue
    datetimeChecked++
    const datePart = raw.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      datetimeProblems.push(`${b.id}: ${JSON.stringify(raw)} does not start with YYYY-MM-DD`)
      continue
    }
    const date = field(b, 'bid_submission_date')
    if (String(date) !== datePart) {
      datetimeProblems.push(
        `${b.id}: bid_submission_datetime date ${datePart} != bid_submission_date ${String(date)}`,
      )
    }
    // The time of day is the reason this field exists, so a bare date is a
    // silent loss of the cutoff. Checked without constructing a Date, so no
    // timezone can shift the day.
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?: [A-Za-z0-9+\-:]{2,8})?$/.test(raw)) {
      datetimeProblems.push(
        `${b.id}.bid_submission_datetime: ${JSON.stringify(raw)} is not "YYYY-MM-DD HH:MM [zone]"`,
      )
      continue
    }
    const [d, t] = String(raw).split(' ')
    if (Number.isNaN(Date.parse(`${d}T00:00:00Z`))) datetimeProblems.push(`${b.id}: ${d} is not a real date`)
    const [hh, mm] = t.split(':').map(Number)
    if (hh > 23 || mm > 59) datetimeProblems.push(`${b.id}: ${t} is not a real time`)
  }
  c.add(
    'Rule 10: bid_submission_datetime date part == bid_submission_date, time kept as text',
    datetimeProblems.length === 0,
    datetimeProblems.join(' | ') ||
      `${datetimeChecked} datetime value(s) agree with their date field; no timezone conversion`,
  )

  // Rule 11 (consistency gate). `completed_documents` must be a SUBSET of
  // `required_documents`. Without this the two parallel lists drift and the
  // record claims documents are ready that were never required, or omits one that
  // was. This is the defect Phase 1 found inherited from Application.
  const documentProblems: string[] = []
  let documentChecked = 0
  for (const b of bids) {
    const required = field(b, 'required_documents')
    const completed = field(b, 'completed_documents')
    if (!Array.isArray(required) || !Array.isArray(completed)) continue
    documentChecked++
    const stray = completed.filter((d) => !required.includes(d as string))
    if (stray.length > 0) {
      documentProblems.push(
        `${b.id}: completed_documents holds ${JSON.stringify(stray)} which is not in required_documents`,
      )
    }
  }
  c.add(
    'Rule 11: completed_documents is a subset of required_documents',
    documentProblems.length === 0,
    documentProblems.join(' | ') ||
      `${documentChecked} Bid(s) with both lists recorded; no orphan completed document`,
  )

  // Phase 7. Rule 11 decides SUBSTET, which treats a list as a bag. Two defects
  // survive it, and both are what "verifiable as a set" has to exclude:
  //
  //   duplicates - `required = [A, A, B]` with `completed = [A, B]` is a valid
  //     subset and still reads as two outstanding items against one document.
  //     A document list names distinct things; the same name twice is not a
  //     second document.
  //   blanks - `required = ['', 'A']` is a subset of itself and claims a
  //     document whose name is nothing. A blank name asserts no requirement at
  //     all, so counting it would invent one.
  //
  // Phase 1 marks `mandatory_bid_documents` with the evidence marker but gives
  // these fields no controlled vocabulary, so names stay free-form and are not
  // matched against a list. Only the shape of the list is checked here.
  const duplicateProblems: string[] = []
  const blankProblems: string[] = []
  const shapeChecked: string[] = []

  const recordDocumentShape = (
    id: string,
    label: string,
    value: unknown,
  ): void => {
    if (!Array.isArray(value)) return
    shapeChecked.push(`${id}.${label}`)
    const names = value as string[]
    const seen = new Set<string>()
    for (const n of names) {
      if (typeof n !== 'string' || n.trim() === '') {
        blankProblems.push(`${id}.${label} holds a blank or whitespace-only name`)
      }
      if (seen.has(n)) {
        duplicateProblems.push(`${id}.${label} repeats ${JSON.stringify(n)}`)
      }
      seen.add(n)
    }
  }

  for (const b of bids) {
    recordDocumentShape(b.id, 'required_documents', field(b, 'required_documents'))
    recordDocumentShape(b.id, 'completed_documents', field(b, 'completed_documents'))
  }
  for (const n of notices) {
    recordDocumentShape(n.id, 'mandatory_bid_documents', field(n, 'mandatory_bid_documents'))
  }

  c.add(
    'Phase 7: a document list holds no repeated name',
    duplicateProblems.length === 0,
    duplicateProblems.join(' | ') ||
      `${shapeChecked.length} document list(s) checked; every name appears at most once`,
  )
  c.add(
    'Phase 7: a document list holds no blank name',
    blankProblems.length === 0,
    blankProblems.join(' | ') ||
      `${shapeChecked.length} document list(s) checked; every name is a non-empty string`,
  )

  // The derivation in `data/documents.ts` deduplicates before counting and uses
  // exact string equality, matching rule 11's `includes`. If that alignment is
  // ever broken the page and the gate would tell a reader different things about
  // the same record, so the shared basis is asserted rather than assumed.
  c.add(
    'Phase 7: document sets are derived from the same lists rule 11 compares',
    SCHEMAS.bid.some((f) => f.name === 'required_documents' && f.kind === 'list') &&
      SCHEMAS.bid.some((f) => f.name === 'completed_documents' && f.kind === 'list') &&
      SCHEMAS.notice.some((f) => f.name === 'mandatory_bid_documents' && f.kind === 'list'),
    'required_documents, completed_documents and mandatory_bid_documents are the three list fields; no document field is controlled, so names stay free-form',
  )

  // Axis independence (Phase 1 section 8.1). The model permits states that look
  // contradictory, so there is deliberately NO check that the three axes agree.
  // What is asserted is the opposite: that all three fields are independently
  // present and independently controlled, so nothing has collapsed them into one
  // derived "bid status".
  c.add(
    'Three status axes are separate fields, each independently controlled',
    ['eligibility_status', 'bid_decision', 'bid_status'].every(
      (name) =>
        SCHEMAS.bid.find((s) => s.name === name)?.kind === 'controlled' &&
        Array.isArray(CONTROLLED_VALUES[name]),
    ),
    `eligibility_status (${CONTROLLED_VALUES.eligibility_status.length} values, reused) | ` +
      `bid_decision (${CONTROLLED_VALUES.bid_decision.length}) | ` +
      `bid_status (${CONTROLLED_VALUES.bid_status.length}); no axis derives from another`,
  )

  // Phase 1 section 2.2 collision guard, now with Bid present to check against.
  // The two families that were renamed apart must not drift back together.
  c.add(
    'Bid security and document names do not collide with the Notice equivalents',
    ['bid_security_required', 'bid_security_amount', 'bid_security_currency', 'mandatory_bid_documents'].every(
      (name) => !SCHEMAS.bid.some((f) => f.name === name),
    ) && ['security_posted_status', 'security_posted_amount', 'security_posted_currency'].every(
      (name) => SCHEMAS.bid.some((f) => f.name === name),
    ),
    'Notice keeps bid_security_* (what the buyer demands); Bid keeps security_posted_* (what we posted)',
  )
  c.add(
    'Bid document fields are the company checklist, not the buyer mandate',
    SCHEMAS.bid.some((f) => f.name === 'required_documents') &&
      SCHEMAS.bid.some((f) => f.name === 'completed_documents') &&
      !SCHEMAS.bid.some((f) => f.name === 'mandatory_bid_documents'),
    'Bid.required_documents / completed_documents; Notice.mandatory_bid_documents',
  )

  // Rule 12 (Phase 1 section 7.4): no monetary value is ever summed across
  // currencies. As with Notice, this is enforced as a schema property. The
  // three Bid amounts stay separate scalars, each with its own currency field,
  // so grouping by currency is the only way to total them. The check also
  // asserts the pairing is one-to-one: two amounts sharing one currency field
  // would be exactly the shape that invites a mixed-currency total.
  const bidAmountPairs: [string, string][] = [
    ['quoted_value', 'quoted_currency'],
    ['security_posted_amount', 'security_posted_currency'],
    ['awarded_value', 'awarded_currency'],
  ]
  const bidCurrencyFields = bidAmountPairs.map(([, cur]) => cur)
  c.add(
    'Bid exposes no cross-currency total field (Rule 12)',
    bidAmountPairs.every(
      ([amount, currency]) =>
        SCHEMAS.bid.find((f) => f.name === amount)?.kind === 'number' &&
        SCHEMAS.bid.find((f) => f.name === currency)?.kind === 'text',
    ) &&
      new Set(bidCurrencyFields).size === bidCurrencyFields.length &&
      !SCHEMAS.bid.some((f) => TOTAL_FIELD_PATTERN.test(f.name)) &&
      bids.every((b) => !Object.keys(b.frontmatter).some((k) => TOTAL_FIELD_PATTERN.test(k))),
    'quoted, security and awarded amounts are three separate scalars with three separate currency fields; a total must group by currency',
  )

  // Bid introduces no procurement edge to the funding domain.
  c.add(
    'Bid carries no Opportunity, Match, or Application link (Phase 1 section 7.2)',
    bids.every((b) =>
      ['opportunity', 'match', 'application'].every(
        (name) => b.frontmatter[name as keyof typeof b.frontmatter] === undefined,
      ),
    ),
    'procurement stays a separate domain; a Bid names only a Company, a Notice, and Sources',
  )

  /* ---------------- Contract (procurement, post-award) ---------------- */
  c.start('Contract')
  const contracts = collection(snapshot, 'contract')
  const bidById = new Map(bids.map((b) => [b.id, b]))

  // Rule 3 (structural) — the gate this type exists to express. Phase 1 section
  // 7.4 invariant 3: "A Contract has exactly one of: a linked `bid`, or a
  // non-blank `contract_basis`." Both directions are checked, because the failure
  // modes are different and both are real:
  //
  //   bid present, basis blank  -> fine. This is an ordinary competitive award;
  //                                 the Bid already records how it was won, and
  //                                 repeating it on the Contract would duplicate.
  //   bid blank,  basis present -> fine, and explicitly permitted. A single-
  //                                 source or negotiated award has no competing
  //                                 Bid to point at.
  //   bid present, basis present -> tolerated. `contract_basis` is REUSED from
  //                                 Bid and is a shared vocabulary, so a Contract
  //                                 carrying it is restating its Bid rather than
  //                                 contradicting it. Checked for agreement below
  //                                 instead of being banned, because the field is
  //                                 optional on Bid too and blank-on-one-side is
  //                                 a legitimate partial record.
  //   bid blank,  basis blank   -> REJECTED. This is the one genuinely
  //                                 unrecoverable state: nothing anywhere says
  //                                 why the award happened.
  const contractBasisProblems: string[] = []
  for (const ct of contracts) {
    const bidId = rel.contractToBid[ct.id]
    const basis = field(ct, 'contract_basis')
    const hasBid = typeof bidId === 'string' && bidId !== ''
    const hasBasis = typeof basis === 'string' && basis !== ''
    if (!hasBid && !hasBasis) {
      contractBasisProblems.push(
        `${ct.id}: bid is blank and contract_basis is blank — invariant 3 requires one of them`,
      )
    }
    // A named basis must not point at a Bid that records a different one.
    if (hasBid && hasBasis) {
      const bidBasis = field(bidById.get(bidId) as never, 'contract_basis')
      if (typeof bidBasis === 'string' && bidBasis !== '' && bidBasis !== basis) {
        contractBasisProblems.push(
          `${ct.id}: contract_basis ${JSON.stringify(basis)} disagrees with ${bidId}'s ${JSON.stringify(bidBasis)}`,
        )
      }
    }
  }
  c.add(
    'Rule 3: every Contract has a linked Bid or a non-blank contract_basis',
    contractBasisProblems.length === 0,
    contractBasisProblems.join(' | ') ||
      contracts
        .map((ct) => `${ct.id}:bid=${rel.contractToBid[ct.id] || '(none)'}/${JSON.stringify(field(ct, 'contract_basis')) || '(none)'}`)
        .join(' ') ||
      'no Contract records',
  )

  // Cardinality. `Contract.notice` and `Contract.company` are required N:1, so
  // the per-field gate already rejects a blank; this asserts the resolved target
  // is of the expected TYPE, which the field gate cannot see. `Contract.bid` is
  // asserted SEPARATELY because it is the one optional link: zero is legal, and
  // the check must distinguish "absent on purpose" from "present but dangling".
  c.add(
    'Rule 3: every Contract resolves exactly one Notice and exactly one Company',
    contracts.every((ct) => {
      const noticeId = rel.contractToNotice[ct.id]
      const companyId = rel.contractToCompany[ct.id]
      return (
        typeof noticeId === 'string' &&
        noticeId !== '' &&
        byId.get(noticeId)?.type === 'notice' &&
        typeof companyId === 'string' &&
        companyId !== '' &&
        byId.get(companyId)?.type === 'company'
      )
    }),
    contracts
      .map((ct) => `${ct.id}->${rel.contractToNotice[ct.id] || '(none)'}/${rel.contractToCompany[ct.id] || '(none)'}`)
      .join(' ') || 'no Contract records',
  )
  c.add(
    'Contract.bid is either absent or exactly one resolved Bid — never dangling',
    contracts.every((ct) => {
      const fieldTargets = ct.links.fields.bid ?? []
      const bidId = rel.contractToBid[ct.id]
      if (fieldTargets.length === 0) return bidId === ''
      return (
        fieldTargets.length === 1 &&
        fieldTargets[0].unresolved === false &&
        bidId === fieldTargets[0].resolvedId
      )
    }),
    contracts
      .map((ct) => `${ct.id}: targets=${ct.links.fields.bid?.length ?? 0} ->${rel.contractToBid[ct.id] || '(absent)'}`)
      .join(' ') || 'no Contract records',
  )

  // Rule 4 (structural): `Contract.lot_number` matches one of the parent Bid's
  // `lot_numbers` when the Bid is present. A Contract that names a lot the Bid
  // never bid on would let us book revenue against work we did not win, which is
  // the most expensive possible drift in this model. Not bidirectional: a
  // multi-lot Bid may be contracted on one lot and abandoned on another, so a
  // Bid with two lots and one Contract is correct, not an error.
  const contractLotProblems: string[] = []
  let contractLotsChecked = 0
  for (const ct of contracts) {
    const bidId = rel.contractToBid[ct.id]
    if (!bidId) continue
    const bid = bidById.get(bidId)
    if (!bid) continue
    contractLotsChecked++
    const lot = field(ct, 'lot_number')
    const bidLots = field(bid, 'lot_numbers')
    const bidLotList = Array.isArray(bidLots) ? bidLots : []
    if (typeof lot === 'string' && lot !== '' && !bidLotList.includes(lot)) {
      contractLotProblems.push(
        `${ct.id}: lot_number ${JSON.stringify(lot)} is not among ${bidId}'s lot_numbers ${JSON.stringify(bidLotList)}`,
      )
    }
  }
  c.add(
    'Rule 4: Contract.lot_number is one of the parent Bid lot_numbers',
    contractLotProblems.length === 0,
    contractLotProblems.join(' | ') ||
      `${contractLotsChecked} Contract(s) with a Bid checked; a blank lot_number is allowed`,
  )

  // Rule 12 (amounts) for Contract's three money fields. Mirrors the Bid check
  // above: each amount is a single scalar beside its own currency field, no field
  // name invites a total, and no record carries a computed aggregate. Contract
  // additionally REQUIRES a currency beside `contract_value`, so a bare amount is
  // not representable at all — which is the whole point of Phase 1 section 2.4
  // splitting the old compound "contract_value + currency".
  const contractAmountPairs: [string, string][] = [
    ['contract_value', 'contract_value_currency'],
    ['performance_guarantee_amount', 'performance_guarantee_currency'],
  ]
  c.add(
    'Contract exposes no cross-currency total field (Rule 12)',
    contractAmountPairs.every(
      ([amount, currency]) =>
        SCHEMAS.contract.find((f) => f.name === amount)?.kind === 'number' &&
        SCHEMAS.contract.find((f) => f.name === currency)?.kind === 'text',
  ) &&
      SCHEMAS.contract.find((f) => f.name === 'contract_value')?.required === true &&
      SCHEMAS.contract.find((f) => f.name === 'contract_value_currency')?.required === true &&
      !SCHEMAS.contract.some((f) => TOTAL_FIELD_PATTERN.test(f.name)) &&
      contracts.every((ct) => !Object.keys(ct.frontmatter).some((k) => TOTAL_FIELD_PATTERN.test(k))),
    'contract_value is required and always paired with a required currency field; a total must group by currency',
  )

  // The award date is NOT on Contract. Phase 1 section 6 field 10 removed it as a
  // duplicate and Phase 6 acceptance criteria require that it not be stored
  // twice. This asserts the absence structurally, so a future "helpful" addition
  // cannot reintroduce the drift Phase 1 removed.
  c.add(
    'No award date is stored on Contract — Bid.award_date owns it',
    !SCHEMAS.contract.some((f) => f.name === 'award_date' || f.name === 'contract_award_date') &&
      contracts.every(
        (ct) =>
          ct.frontmatter.award_date === undefined &&
          ct.frontmatter.contract_award_date === undefined,
      ),
    'Contract carries signature, start, end, warranty and acceptance dates only',
  )

  // Bid -> Contract is 1:0..N, so the reverse index must be a list and a multi-lot
  // award must be able to produce more than one Contract. This asserts the
  // STRUCTURE supports it; `rule4` above asserts the values are coherent. A Bid
  // with two Contracts on different lots is the case Phase 1 corrected 0..1 for.
  c.add(
    'Bid 1:0..N Contract — a Bid may produce several Contracts',
    contracts.every((ct) => {
      const bidId = rel.contractToBid[ct.id]
      if (!bidId) return true
      return (rel.bidToContract[bidId] ?? []).includes(ct.id)
    }) &&
      Object.values(rel.bidToContract).every((v) => Array.isArray(v)) &&
      bids.every((b) => Array.isArray(rel.bidToContract[b.id])),
    `bidToContract is a list for all ${bids.length} Bid(s); ${contracts.filter((ct) => rel.contractToBid[ct.id]).length} Contract(s) carry a Bid`,
  )

  // Contract introduces no procurement edge to the funding domain, and introduces
  // no Lot record type (deferred by decision D6).
  c.add(
    'Contract carries no Opportunity, Match, Application, or Lot link',
    contracts.every((ct) =>
      ['opportunity', 'match', 'application', 'lot', 'parent_lot'].every(
        (name) => ct.frontmatter[name as keyof typeof ct.frontmatter] === undefined,
      ),
    ) &&
      !RECORD_TYPES.includes('lot' as RecordType),
    'a Contract names only a Notice, an optional Bid, and a Company; Lot stays deferred',
  )

  /* ---------------- Production data eligibility ---------------- */
  c.start('Production data eligibility')
  const fictional = all.filter((r) => r.fictional.isFictional)
  c.add(
    'No fictional record is included in the production snapshot',
    fictional.length === 0,
    fictional.map((r) => r.id).join(', ') || `${all.length} included records`,
  )

  /* ---------------- Source integrity ---------------- */
  c.start('Source integrity')
  const diff = diffManifests(manifestBefore, manifestAfter)
  c.add('No source content file changed during import', diff.identical, diff.identical ? `${manifestAfter.entries.length} files identical` : `changed=${diff.changed.length} added=${diff.added.length} removed=${diff.removed.length}`)
  c.add(
    'Manifest aggregate unchanged',
    manifestBefore.aggregate === manifestAfter.aggregate,
    `${manifestBefore.aggregate.slice(0, 16)}... vs ${manifestAfter.aggregate.slice(0, 16)}...`,
  )
  c.add(
    'Content file count is unchanged across the import',
    manifestBefore.entries.length === manifestAfter.entries.length,
    `${manifestBefore.entries.length} / ${manifestAfter.entries.length}`,
  )
  c.add(
    '.obsidian excluded from manifest',
    !manifestBefore.entries.some((e) => e.file.startsWith('.obsidian')),
    'workspace metadata not hashed',
  )
  c.add(
    'Vault content file list matches the record directories + docs',
    listContentFiles(vaultRoot).length === snapshot.source.contentFileCount,
    `${snapshot.source.contentFileCount}`,
  )

  return { results: c.results, failures: c.failures }
}

function joinVault(root: string, rel: string): string {
  return path.join(root, ...rel.split('/'))
}
