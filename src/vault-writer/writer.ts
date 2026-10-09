/**
 * Phase T — the controlled Vault writer.
 *
 * ONE boundary: this module is the only place in `src/` that writes Markdown
 * records into a Vault. Everything upstream — discovery, classification,
 * matching, review, and the five dry-run proposal engines — stays pure and
 * filesystem-free (enforced by `boundary.test.ts` and the existing Phase B/C
 * boundary scans).
 *
 * The contract:
 *
 * - Input is a VALIDATED APPROVED proposal: record type, record ID, a payload
 *   that is field-for-field compatible with the registered schema, and a dated
 *   human approval envelope. Anything else is REJECTED before any I/O.
 * - Supported record types only: opportunity, notice, match, procurement_match,
 *   bid — the five types the completed workflows already propose. No new types.
 * - Relationships are validated against the records that already exist in the
 *   target vault. A link that does not resolve means REJECTED — a link is
 *   never fabricated and a missing related record is never created.
 * - Never overwrites. An existing target file that is byte-identical returns
 *   ALREADY_EXISTS (a no-op); different content returns CONFLICT. An exclusive
 *   create (`flag: 'wx'`) enforces the rule at the filesystem level too.
 * - Atomic single-record writes only. Validation or serialization failure
 *   means zero files written; there is no bulk API to partially apply.
 * - No clock, no network, no randomness: the same request renders the same
 *   bytes, so previews, repeats, and idempotent retries stay stable.
 * - Rendering follows the existing conventions the import pipeline reads:
 *   schema-ordered YAML frontmatter (`lineWidth: 0`), an H1 taken from the
 *   record's registered title field, and the standard Data Dictionary footer.
 *
 * The vault root is a PARAMETER. Tests pass a `mkdtemp` directory; nothing
 * here names or knows a production vault path.
 */

import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { controlledValueProblem } from '../import/controlled-values'
import { SCHEMAS } from '../import/schema'
import type { FieldKind, FieldSpec } from '../import/schema'
import {
  ID_FIELD,
  RECORD_DIRS,
  RECORD_REGISTRY,
  RECORD_TYPES,
  TITLE_FIELD,
  TYPE_LABEL,
  idFromTarget,
  idPatternFor,
  typeForId,
} from '../types/registry'
import type { RecordType } from '../types/registry'

/** The five record types the completed workflows already propose. */
export const WRITABLE_RECORD_TYPES = [
  'opportunity',
  'notice',
  'match',
  'procurement_match',
  'bid',
] as const
export type WritableRecordType = (typeof WRITABLE_RECORD_TYPES)[number]

export type VaultWriteStatus = 'CREATED' | 'ALREADY_EXISTS' | 'CONFLICT' | 'REJECTED'
export type VaultPreviewStatus = 'READY' | 'REJECTED'

/** The dated human decision that makes a proposal eligible to be written. */
export interface VaultWriteApproval {
  readonly decisionId: string
  readonly approvedBy: string
  readonly decidedAt: string
}

/** One approved proposal, ready for the writer boundary. */
export interface VaultWriteRequest {
  readonly recordType: string
  readonly recordId: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly approval?: VaultWriteApproval | null
}

export interface VaultWriteError {
  readonly code: string
  readonly field?: string
  readonly message: string
}

/** The audit result of a write attempt. No new vault record type is required. */
export interface VaultWriteResult {
  readonly status: VaultWriteStatus
  readonly recordType: WritableRecordType | null
  readonly recordId: string | null
  /** Vault-relative path with forward slashes, or null when never resolved. */
  readonly targetPath: string | null
  /** The exact Markdown that was (or would have been) written. */
  readonly markdown: string | null
  readonly errors: readonly VaultWriteError[]
}

/** Dry-run result: the exact payload, without touching the filesystem. */
export interface VaultPreviewResult {
  readonly status: VaultPreviewStatus
  readonly recordType: WritableRecordType | null
  readonly recordId: string | null
  readonly targetPath: string | null
  readonly markdown: string | null
  readonly errors: readonly VaultWriteError[]
}

export interface VaultTarget {
  /** Directory that holds (or will hold) the record folders. */
  readonly vaultRoot: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const APPROVAL_DATE_RE = /^\d{4}-\d{2}-\d{2}/
const FILE_UNSAFE_RE = /[\\/:*?"<>|]/g
const WIKILINK_RE = /^\[\[([\s\S]+)\]\]$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBlank(value: unknown, kind: FieldKind): boolean {
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'string') return value === ''
  if (kind === 'boolean') return false
  return false
}

interface VaultIndex {
  readonly ids: ReadonlyMap<RecordType, ReadonlySet<string>>
  readonly fileById: ReadonlyMap<string, string>
}

/**
 * The record IDs that already exist in a vault, discovered from the registered
 * record folders and the filenames themselves (the ID always starts the file).
 */
function buildVaultIndex(vaultRoot: string): VaultIndex {
  const ids = new Map<RecordType, Set<string>>()
  const fileById = new Map<string, string>()
  for (const type of RECORD_TYPES) {
    const dirAbs = path.join(vaultRoot, RECORD_DIRS[type])
    if (!fs.existsSync(dirAbs)) continue
    const found = new Set<string>()
    for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const id = idFromTarget(entry.name.slice(0, -'.md'.length))
      if (!id || typeForId(id) !== type) continue
      found.add(id)
      if (!fileById.has(id)) fileById.set(id, `${RECORD_DIRS[type]}/${entry.name}`)
    }
    ids.set(type, found)
  }
  return { ids, fileById }
}

interface Prepared {
  readonly errors: readonly VaultWriteError[]
  readonly recordType: WritableRecordType | null
  readonly recordId: string | null
  readonly targetPath: string | null
  readonly markdown: string | null
  readonly index: VaultIndex | null
}

function rejected(
  errors: readonly VaultWriteError[],
  recordType: WritableRecordType | null = null,
  recordId: string | null = null,
  targetPath: string | null = null,
): Prepared {
  return { errors, recordType, recordId, targetPath, markdown: null, index: null }
}

/**
 * Validate a proposal and render its Markdown. Reads the target vault for
 * relationship and duplicate checks; writes nothing, ever.
 */
function prepare(request: unknown, vaultRoot: string): Prepared {
  const errors: VaultWriteError[] = []
  const fail = (code: string, message: string, field?: string): void => {
    errors.push(field === undefined ? { code, message } : { code, field, message })
  }

  if (!isPlainObject(request)) {
    fail('malformed_request', 'the write request must be an object')
    return rejected(errors)
  }

  const rawType = request.recordType
  if (typeof rawType !== 'string' || !(WRITABLE_RECORD_TYPES as readonly string[]).includes(rawType)) {
    fail(
      'unsupported_record_type',
      `the writer supports only: ${WRITABLE_RECORD_TYPES.join(', ')}. Got: ${String(rawType)}`,
    )
    return rejected(errors)
  }
  const recordType = rawType as WritableRecordType

  const recordId = typeof request.recordId === 'string' ? request.recordId : ''
  if (!idPatternFor(recordType).test(recordId)) {
    fail(
      'invalid_record_id',
      `${recordId || '(empty)'} is not a valid ${RECORD_REGISTRY[recordType].idPrefix}-### identifier`,
      ID_FIELD[recordType],
    )
    return rejected(errors, recordType)
  }

  const payload = request.payload
  if (!isPlainObject(payload)) {
    fail('malformed_payload', 'payload must be an object of frontmatter fields')
    return rejected(errors, recordType, recordId)
  }

  // Only APPROVED proposals with a dated human decision are writable.
  const approval = request.approval
  const approved =
    isPlainObject(approval) &&
    typeof approval.decisionId === 'string' &&
    approval.decisionId.trim() !== '' &&
    typeof approval.approvedBy === 'string' &&
    approval.approvedBy.trim() !== '' &&
    typeof approval.decidedAt === 'string' &&
    APPROVAL_DATE_RE.test(approval.decidedAt)
  if (!approved) {
    fail('not_approved', 'only an APPROVED proposal with a dated human approval may be written')
  }

  const idField = ID_FIELD[recordType]
  if (payload[idField] !== recordId) {
    fail('id_field_mismatch', `payload.${idField} must equal the record ID ${recordId}`, idField)
  }

  const schema: readonly FieldSpec[] = SCHEMAS[recordType]
  const schemaNames = new Set(schema.map((spec) => spec.name))
  for (const key of Object.keys(payload)) {
    if (!schemaNames.has(key)) {
      fail(
        'unknown_field',
        `field "${key}" is not part of the ${recordType} schema; provenance must use schema-supported fields`,
        key,
      )
    }
  }

  for (const spec of schema) {
    const value = payload[spec.name]
    if (value === undefined) {
      if (spec.required) {
        fail('missing_required_field', `required field "${spec.name}" is missing`, spec.name)
      }
      continue
    }

    let kindOk = true
    switch (spec.kind) {
      case 'text':
      case 'link':
      case 'controlled':
      case 'date':
        if (typeof value !== 'string') {
          kindOk = false
          fail('invalid_field_value', `${spec.name} expects a string ${spec.kind} value`, spec.name)
        } else if (spec.kind === 'date' && value !== '' && !DATE_RE.test(value)) {
          kindOk = false
          fail('invalid_field_value', `${spec.name} must be a YYYY-MM-DD date`, spec.name)
        }
        break
      case 'list':
      case 'linkList':
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
          kindOk = false
          fail('invalid_field_value', `${spec.name} expects a list of strings`, spec.name)
        }
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          kindOk = false
          fail('invalid_field_value', `${spec.name} expects a finite number`, spec.name)
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          kindOk = false
          fail('invalid_field_value', `${spec.name} expects a boolean`, spec.name)
        }
        break
    }
    if (!kindOk) continue

    if (spec.required && isBlank(value, spec.kind)) {
      fail('missing_required_field', `required field "${spec.name}" is blank`, spec.name)
      continue
    }

    if (spec.kind === 'controlled') {
      const problem = controlledValueProblem(spec.name, value, recordType)
      if (problem) fail('invalid_controlled_value', problem, spec.name)
    }
  }

  // Relationships: every link must resolve to a record that already exists.
  if (typeof vaultRoot !== 'string' || vaultRoot === '' || !fs.existsSync(vaultRoot)) {
    fail('vault_root_missing', `vault root is not a readable directory: ${String(vaultRoot)}`)
    return rejected(errors, recordType, recordId)
  }
  let index: VaultIndex
  try {
    index = buildVaultIndex(vaultRoot)
  } catch (error) {
    fail('vault_unreadable', `could not read the target vault: ${String(error)}`)
    return rejected(errors, recordType, recordId)
  }

  const registryLinks = new Map<string, RecordType>()
  for (const link of RECORD_REGISTRY[recordType].links) registryLinks.set(link.field, link.pointsTo)

  for (const spec of schema) {
    if (spec.kind !== 'link' && spec.kind !== 'linkList') continue
    const value = payload[spec.name]
    if (value === undefined || isBlank(value, spec.kind)) continue
    const entries = Array.isArray(value) ? value : [value]
    const declared = registryLinks.get(spec.name) ?? null
    for (const entry of entries) {
      const wikilink = WIKILINK_RE.exec(String(entry))
      if (!wikilink) {
        fail('invalid_relationship', `${spec.name} must be a "[[ID — Name]]" wikilink`, spec.name)
        continue
      }
      const targetId = idFromTarget(wikilink[1])
      const targetType = targetId ? typeForId(targetId) : null
      if (!targetId || !targetType) {
        fail('invalid_relationship', `${spec.name} names no known record ID`, spec.name)
        continue
      }
      if (declared && targetType !== declared) {
        fail(
          'invalid_relationship',
          `${spec.name} must point at a ${declared}; ${targetId} is a ${targetType}`,
          spec.name,
        )
        continue
      }
      if (!index.ids.get(targetType)?.has(targetId)) {
        fail(
          'unresolved_relationship',
          `${spec.name} points at ${targetId}, which does not exist in the target vault`,
          spec.name,
        )
      }
    }
  }

  if (errors.length > 0) return rejected(errors, recordType, recordId)

  const rawTitle = payload[TITLE_FIELD[recordType]]
  const title = typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle : recordId

  let markdown: string
  try {
    const ordered: Record<string, unknown> = {}
    for (const spec of schema) {
      if (payload[spec.name] !== undefined) ordered[spec.name] = payload[spec.name]
    }
    const yaml = YAML.stringify(ordered, { lineWidth: 0 })
    const label = TYPE_LABEL[recordType]
    markdown =
      '---\n' +
      yaml +
      '---\n' +
      `\n# ${title}\n` +
      `\n${label} record written from an approved proposal. ` +
      'Provenance and evidence are recorded in the frontmatter fields above.\n' +
      '\n---\n' +
      '\n*Field definitions and controlled values: [[Data Dictionary]]*\n'
  } catch (error) {
    fail('serialization_failed', `could not render the record: ${String(error)}`)
    return rejected(errors, recordType, recordId)
  }

  return {
    errors: [],
    recordType,
    recordId,
    targetPath: `${RECORD_DIRS[recordType]}/${fileNameFor(recordId, title)}`,
    markdown,
    index,
  }
}

/** `OPP-700 — Name.md`; types whose title IS the ID keep a bare filename. */
function fileNameFor(recordId: string, title: string): string {
  if (title === recordId) return `${recordId}.md`
  const clean = title
    .replace(FILE_UNSAFE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim()
  return clean === '' ? `${recordId}.md` : `${recordId} — ${clean}.md`
}

function toResult(
  status: VaultWriteStatus,
  prepared: Prepared,
  errors: readonly VaultWriteError[],
): VaultWriteResult {
  return {
    status,
    recordType: prepared.recordType,
    recordId: prepared.recordId,
    targetPath: prepared.targetPath,
    markdown: prepared.markdown,
    errors,
  }
}

/**
 * Dry-run: validate and render the exact Markdown payload without writing
 * anything — no file, no directory, no manifest.
 */
export function previewVaultWrite(request: unknown, target: VaultTarget): VaultPreviewResult {
  const prepared = prepare(request, target.vaultRoot)
  const status: VaultPreviewStatus = prepared.errors.length === 0 ? 'READY' : 'REJECTED'
  return {
    status,
    recordType: prepared.recordType,
    recordId: prepared.recordId,
    targetPath: prepared.targetPath,
    markdown: prepared.markdown,
    errors: prepared.errors,
  }
}

/**
 * The single controlled write. Creates at most one file, never overwrites, and
 * leaves the vault untouched when anything goes wrong.
 */
export function writeVaultRecord(request: unknown, target: VaultTarget): VaultWriteResult {
  const prepared = prepare(request, target.vaultRoot)
  if (prepared.errors.length > 0 || prepared.markdown === null || prepared.targetPath === null) {
    return toResult('REJECTED', prepared, prepared.errors)
  }

  const targetAbs = path.join(target.vaultRoot, prepared.targetPath)

  if (fs.existsSync(targetAbs)) {
    let existing: string
    try {
      existing = fs.readFileSync(targetAbs, 'utf8')
    } catch (error) {
      return toResult('REJECTED', prepared, [
        { code: 'read_failed', message: `could not read the existing record: ${String(error)}` },
      ])
    }
    if (existing === prepared.markdown) {
      return toResult('ALREADY_EXISTS', prepared, [])
    }
    return toResult('CONFLICT', prepared, [
      {
        code: 'content_mismatch',
        message: `${prepared.targetPath} already exists with different content; existing records are never overwritten`,
      },
    ])
  }

  const sameIdElsewhere = prepared.index?.fileById.get(prepared.recordId ?? '')
  if (sameIdElsewhere && sameIdElsewhere !== prepared.targetPath) {
    return toResult('CONFLICT', prepared, [
      {
        code: 'duplicate_record_id',
        message: `${prepared.recordId} already exists at ${sameIdElsewhere}; refusing to write a second file for it`,
      },
    ])
  }

  const dirAbs = path.join(target.vaultRoot, RECORD_DIRS[prepared.recordType as WritableRecordType])
  let createdDir = false
  try {
    if (!fs.existsSync(dirAbs)) {
      fs.mkdirSync(dirAbs, { recursive: true })
      createdDir = true
    }
  } catch (error) {
    return toResult('REJECTED', prepared, [
      { code: 'write_failed', message: `could not prepare the record folder: ${String(error)}` },
    ])
  }

  try {
    fs.writeFileSync(targetAbs, prepared.markdown, { encoding: 'utf8', flag: 'wx' })
    return toResult('CREATED', prepared, [])
  } catch (error) {
    const code = (error as { code?: string }).code
    if (createdDir) {
      try {
        fs.rmdirSync(dirAbs)
      } catch {
        // The folder is no longer empty or no longer ours; leave it alone.
      }
    }
    if (code === 'EEXIST') {
      return toResult('CONFLICT', prepared, [
        { code: 'content_mismatch', message: `${prepared.targetPath} was created concurrently; refusing to overwrite` },
      ])
    }
    return toResult('REJECTED', prepared, [
      { code: 'write_failed', message: `could not create the record: ${String(error)}` },
    ])
  }
}
