/**
 * Recoverable snapshot of the vault's content files.
 *
 * Copies only content (no `.obsidian`) into a Git-ignored directory inside the
 * frontend project, so a restore is possible without touching the vault. The
 * vault itself is opened read-only and is never written to.
 */

import fs from 'node:fs'
import path from 'node:path'
import { SNAPSHOT_DIR, VAULT_ROOT } from './paths'
import { listContentFiles, sha256File } from './manifest'

export interface SnapshotResult {
  snapshotDir: string
  fileCount: number
  /** Files whose copied bytes differ from the source. Should always be empty. */
  mismatched: string[]
}

export function createSnapshot(
  sourceRoot: string = VAULT_ROOT,
  snapshotDir: string = SNAPSHOT_DIR,
): SnapshotResult {
  fs.rmSync(snapshotDir, { recursive: true, force: true })
  fs.mkdirSync(snapshotDir, { recursive: true })

  const files = listContentFiles(sourceRoot)
  const mismatched: string[] = []

  for (const rel of files) {
    const src = path.join(sourceRoot, rel)
    const dest = path.join(snapshotDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
    if (sha256File(src) !== sha256File(dest)) mismatched.push(rel)
  }

  return { snapshotDir, fileCount: files.length, mismatched }
}
