/**
 * Wikilink extraction and resolution.
 *
 * Two rules, deliberately:
 *
 * 1. The ORIGINAL `[[...]]` string is always preserved on the record, so no
 *    information is lost. Resolution is additive metadata, never a rewrite.
 *
 * 2. Resolution is exact. A target is resolved by matching the record ID
 *    prefix, or an exact display-name match. A near match is NOT resolved and
 *    is reported as unresolved rather than guessed at.
 */

import type { LinkTarget, RecordLinks, UnresolvedLink } from '../types/records'
import type { RecordType } from '../types/registry'
import { idFromTarget } from '../types/registry'

/** Matches `[[...]]`, allowing `|` alias and `#heading` suffixes. */
const WIKILINK = /\[\[([^\]]+)\]\]/g

export interface RawLink {
  raw: string
  target: string
}

/** Extract every `[[...]]` from a string, preserving order and original text. */
export function extractLinks(value: string): RawLink[] {
  const out: RawLink[] = []
  for (const m of value.matchAll(WIKILINK)) {
    // Strip an alias (`page|alias`) for matching; `raw` keeps the full text.
    const target = m[1].split('|')[0].split('#')[0].trim()
    out.push({ raw: m[0], target })
  }
  return out
}

export function extractBodyLinks(body: string): RawLink[] {
  return extractLinks(body)
}

/**
 * `OPP-001 — Startup India Seed Fund Scheme — SISFS` -> `OPP-001`.
 *
 * The pattern comes from the registry, so a new record type is picked up here
 * without editing this file. Re-exported for the existing call sites.
 */
export { idFromTarget }

export type IdIndex = Map<string, { id: string; type: RecordType; displayName: string }>

/**
 * Note-name index for links that point at a non-record note, such as
 * `[[Data Dictionary]]`.
 *
 * These are resolved so that "unresolved" means genuinely dangling rather than
 * "points at a real note that is not one of the seven record types". Note links
 * are never used as a relationship key; only record IDs are.
 */
export type NoteIndex = Map<string, string>

/** Build the record lookup index from every record's ID and display name. */
export function buildIdIndex(records: { id: string; type: RecordType; displayName: string }[]): IdIndex {
  const index: IdIndex = new Map()
  for (const r of records) {
    index.set(r.id.toLowerCase(), r)
    if (r.displayName) {
      const key = r.displayName.trim().toLowerCase()
      // First record wins on an exact display-name collision; never overwrite.
      if (!index.has(key)) index.set(key, r)
    }
  }
  return index
}

/** Build a name -> vault-relative-path index of every note in the vault. */
export function buildNoteIndex(notes: string[]): NoteIndex {
  const index: NoteIndex = new Map()
  for (const rel of notes) {
    if (!rel.toLowerCase().endsWith('.md')) continue
    const base = rel.slice(rel.lastIndexOf('/') + 1)
    const name = base.slice(0, base.length - 3)
    const key = name.trim().toLowerCase()
    if (!index.has(key)) index.set(key, rel)
  }
  return index
}

/**
 * Resolve a link to a record, falling back to a non-record note.
 * `notePath` is set only when the link points at a documentation note.
 */
export interface ResolvedNonRecord {
  notePath: string | null
}

function resolveNote(target: string, notes: NoteIndex): string | null {
  return notes.get(target.trim().toLowerCase()) ?? null
}

function resolveOne(link: RawLink, index: IdIndex, notes: NoteIndex): LinkTarget {
  const byId = idFromTarget(link.target)
  let hit = byId ? index.get(byId.toLowerCase()) : undefined
  if (!hit) hit = index.get(link.target.toLowerCase())

  if (hit) {
    return { target: link.target, raw: link.raw, resolvedId: hit.id, notePath: null, unresolved: false }
  }

  // Not a record. It may still be a real documentation note.
  const notePath = resolveNote(link.target, notes)
  return {
    target: link.target,
    raw: link.raw,
    resolvedId: null,
    notePath,
    unresolved: notePath === null,
  }
}

/** Resolve a scalar link field (`""` means no link). */
export function resolveLinkField(value: string, index: IdIndex, notes: NoteIndex): LinkTarget[] {
  if (value === '') return []
  return extractLinks(value).map((l) => resolveOne(l, index, notes))
}

/** Resolve a list-of-links field. An empty list stays an empty list. */
export function resolveLinkListField(value: string[], index: IdIndex, notes: NoteIndex): LinkTarget[] {
  if (value.length === 0) return []
  return value.flatMap((entry) => extractLinks(entry).map((l) => resolveOne(l, index, notes)))
}

/** Collect unresolved links for reporting, keeping them rather than dropping. */
export function collectUnresolved(
  id: string,
  type: RecordType,
  links: RecordLinks,
): UnresolvedLink[] {
  const out: UnresolvedLink[] = []
  for (const [field, targets] of Object.entries(links.fields)) {
    for (const t of targets) {
      if (t.unresolved) {
        out.push({ fromId: id, fromType: type, origin: 'frontmatter', field, raw: t.raw, target: t.target })
      }
    }
  }
  for (const t of links.body) {
    if (t.unresolved) {
      out.push({ fromId: id, fromType: type, origin: 'body', field: '<body>', raw: t.raw, target: t.target })
    }
  }
  return out
}
