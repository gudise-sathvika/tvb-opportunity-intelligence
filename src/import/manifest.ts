/**
 * SHA-256 manifest of the vault's content files.
 *
 * Used to prove the source did not change during extraction. `.obsidian`
 * workspace metadata is excluded because Obsidian rewrites it while open and
 * it carries no record data.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { EXCLUDED_DIR, VAULT_ROOT } from './paths'

export interface ManifestEntry {
  /** Vault-relative path with forward slashes, e.g. `01 - Opportunities/OPP-001 — ....md`. */
  file: string
  sha256: string
}

export interface Manifest {
  root: string
  entries: ManifestEntry[]
  /** SHA-256 over the sorted `hash  path` listing. */
  aggregate: string
}

/** Recursively list content files, excluding `.obsidian`. Sorted for determinism. */
export function listContentFiles(root: string): string[] {
  const out: string[] = []

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === EXCLUDED_DIR) continue
        walk(path.join(dir, entry.name))
      } else if (entry.isFile()) {
        out.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'))
      }
    }
  }

  walk(root)
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

export function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function buildManifest(root: string = VAULT_ROOT): Manifest {
  const entries: ManifestEntry[] = listContentFiles(root).map((rel) => ({
    file: rel,
    sha256: sha256File(path.join(root, rel)),
  }))

  const listing = entries.map((e) => `${e.sha256}  ${e.file}`).join('\n')
  return {
    root,
    entries,
    aggregate: createHash('sha256').update(listing).digest('hex'),
  }
}

export function serializeManifest(m: Manifest): string {
  return m.entries.map((e) => `${e.sha256}  ${e.file}`).join('\n') + '\n'
}

export interface ManifestDiff {
  identical: boolean
  added: string[]
  removed: string[]
  changed: { file: string; before: string; after: string }[]
}

export function diffManifests(before: Manifest, after: Manifest): ManifestDiff {
  const b = new Map(before.entries.map((e) => [e.file, e.sha256]))
  const a = new Map(after.entries.map((e) => [e.file, e.sha256]))

  const added: string[] = []
  const removed: string[] = []
  const changed: ManifestDiff['changed'] = []

  for (const [file, hash] of a) {
    if (!b.has(file)) added.push(file)
    else if (b.get(file) !== hash) {
      changed.push({ file, before: b.get(file) as string, after: hash })
    }
  }
  for (const file of b.keys()) {
    if (!a.has(file)) removed.push(file)
  }

  const byName = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
  added.sort(byName)
  removed.sort(byName)
  changed.sort((x, y) => byName(x.file, y.file))

  return {
    identical: added.length === 0 && removed.length === 0 && changed.length === 0,
    added,
    removed,
    changed,
  }
}
