/**
 * Frontmatter and body parsing.
 *
 * The vault is opened read-only. Nothing is written back.
 *
 * Two parser decisions matter for data fidelity:
 *
 * 1. Frontmatter is split with `gray-matter`, but the YAML is parsed by the
 *    `yaml` package rather than js-yaml. Under the `yaml` package's default
 *    core schema an unquoted `2026-09-28` stays a STRING, so a date can never
 *    be reinterpreted as a UTC instant and shifted across a day boundary.
 *    `toIsoDate` below still handles a real Date defensively, using
 *    `.isoformat()` semantics with an explicit no-shift guard.
 *
 * 2. Values are passed through untouched. `""` stays `""`, `[]` stays `[]`,
 *    `false` stays `false`, `0` stays `0`, and wikilinks keep their original
 *    `[[...]]` text. Nothing is trimmed, defaulted, or normalised.
 */

import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import YAML from 'yaml'
import { sha256File } from './manifest'
import type { FieldSpec } from './schema'
import { controlledValueProblem } from './controlled-values'
import type { Frontmatter } from '../types/records'

/** gray-matter engine using the `yaml` package. */
const engine = {
  parse: (str: string): object => YAML.parse(str) as object,
  stringify: (data: object): string => YAML.stringify(data),
}

export interface ParsedFile {
  /** Vault-relative path, forward slashes. */
  sourceFile: string
  sourcePath: string
  sourceSha256: string
  data: Frontmatter
  body: string
}

export class ParseError extends Error {}

/**
 * Serialise a date value to an ISO `YYYY-MM-DD` string.
 *
 * If the parser produced a real `Date`, `.isoformat()` semantics are used. A
 * naive `toISOString()` can shift the calendar day for a local-midnight date
 * under a negative UTC offset, so the components are checked first and a
 * mismatch is an error rather than a silent correction.
 */
export function toIsoDate(value: unknown, context: string): string {
  if (value instanceof Date) {
    const iso = value.toISOString().slice(0, 10)
    const back = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(
      value.getUTCDate(),
    ).padStart(2, '0')}`
    if (iso !== back) {
      throw new ParseError(
        `Date would shift when serialised (${context}): got ${iso}, expected ${back}`,
      )
    }
    return back
  }
  if (typeof value === 'string') {
    if (value === '') return value
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ParseError(`Unexpected date format (${context}): ${JSON.stringify(value)}`)
    }
    // Shape is right; confirm it is a real calendar date. Pure UTC arithmetic on
    // the components, so the stored value is never converted or shifted.
    const [y, m, d] = value.split('-').map(Number)
    const probe = new Date(Date.UTC(y, m - 1, d))
    if (
      probe.getUTCFullYear() !== y ||
      probe.getUTCMonth() !== m - 1 ||
      probe.getUTCDate() !== d
    ) {
      throw new ParseError(`Not a real calendar date (${context}): ${JSON.stringify(value)}`)
    }
    return value
  }
  throw new ParseError(`Unexpected date value (${context}): ${JSON.stringify(value)}`)
}

/** Validate a parsed value against its schema kind. Throws rather than repairs. */
export function checkValue(spec: FieldSpec, value: unknown, context: string): void {
  const where = `${context} field ${spec.name} (${spec.kind})`
  switch (spec.kind) {
    case 'text':
    case 'controlled':
    case 'link':
      if (typeof value !== 'string') {
        throw new ParseError(`Expected text in ${where}, got ${typeof value}`)
      }
      break
    case 'linkList':
    case 'list':
      if (!Array.isArray(value)) {
        throw new ParseError(`Expected list in ${where}, got ${typeof value}`)
      }
      for (const item of value) {
        if (typeof item !== 'string') {
          throw new ParseError(`Expected text list item in ${where}, got ${typeof item}`)
        }
      }
      break
    case 'date':
      toIsoDate(value, where)
      break
    case 'number':
      // A blank numeric is a deliberate empty string in this vault, not null
      // and not 0. Both `""` and a real number are accepted; nothing else.
      if (value !== '' && typeof value !== 'number') {
        throw new ParseError(
          `Expected number or blank string in ${where}, got ${JSON.stringify(value)}`,
        )
      }
      break
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new ParseError(`Expected boolean in ${where}, got ${typeof value}`)
      }
      break
  }
}

/**
 * Whether a value counts as blank.
 *
 * The three blank states the vault distinguishes stay distinct: `""` for a
 * blankable scalar, `[]` for a list with no entries, and a real boolean. A
 * boolean is never blank, so `false` is a recorded value and `0` is a number.
 * An absent key counts as blank, which is what makes a required field
 * genuinely required.
 */
export function isBlank(value: unknown): boolean {
  if (value === undefined) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'string') return value === ''
  return false
}

/**
 * Enforce the required flag and the controlled-value list for one field.
 *
 * Throws rather than repairs, and the message always names the record, the
 * field, and the reason. A blank required field is an error; a blank optional
 * field is always fine. A non-blank controlled value outside its list is an
 * error; a blank controlled value is always fine, and is never filled in.
 */
export function checkConstraints(spec: FieldSpec, value: unknown, context: string): void {
  if (spec.required && isBlank(value)) {
    throw new ParseError(
      `${context}.${spec.name}: required field is blank. ` +
        `Record the value or the field must be declared optional in the Data Dictionary.`,
    )
  }

  if (spec.kind === 'controlled') {
    const problem = controlledValueProblem(spec.name, value, context)
    if (problem) throw new ParseError(problem)
  }
}

/** Required, then controlled, then kind. The importer's per-field gate. */
export function checkField(spec: FieldSpec, value: unknown, context: string): void {
  // Required-ness first, so a missing or blank field is reported as such rather
  // than as a type error on an absent value.
  checkConstraints(spec, value, context)
  checkValue(spec, value, context)
}

/** Read and parse one Markdown record. Read-only. */
export function parseRecordFile(absPath: string, sourceFile: string): ParsedFile {
  const raw = fs.readFileSync(absPath, 'utf8')
  const parsed = matter(raw, { engines: { yaml: engine } })

  if (parsed.data === null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    throw new ParseError(`Frontmatter is missing or not a mapping: ${sourceFile}`)
  }

  return {
    sourceFile,
    sourcePath: absPath,
    sourceSha256: sha256File(absPath),
    data: parsed.data as Frontmatter,
    // Body preserved verbatim; only the single separator newline is dropped.
    body: parsed.content.replace(/^\r?\n/, ''),
  }
}

export { path }
