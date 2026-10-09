/**
 * Filesystem locations for the importer.
 *
 * Hard safety rule: the source vault path is used for READING ONLY. Every
 * path the importer writes to is under the frontend project root.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Frontend project root: the directory that contains `package.json`. */
export const PROJECT_ROOT = path.resolve(here, '..', '..')

/**
 * Load `TVB_SOURCE_VAULT` from a local, untracked `.env` when present. No
 * machine-specific absolute path is hardcoded in shared configuration; each
 * environment supplies its own vault location.
 */
const ENV_FILE = path.join(PROJECT_ROOT, '.env')
if (fs.existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE)
  } catch {
    /* a malformed local .env must not crash the importer; VAULT_ROOT stays unset */
  }
}

/**
 * Source vault. READ-ONLY. Never written to.
 *
 * Configured entirely through the environment (see `.env.example`). When unset
 * it is the empty string, and the importer fails with an actionable message
 * instead of guessing a location. The clean-checkout bootstrap never reads this
 * value — it seeds the snapshot from a committed fixture instead.
 */
export const VAULT_ROOT = process.env.TVB_SOURCE_VAULT?.trim() ?? ''

/** Recoverable local snapshot of vault content. Git-ignored. Wiped each run. */
export const SNAPSHOT_DIR = path.join(PROJECT_ROOT, '.vault-snapshot')

/**
 * SHA-256 manifests. Kept in a SEPARATE directory from the snapshot, because
 * the snapshot directory is deleted and recreated on every run and would
 * otherwise destroy the before-manifest. Git-ignored.
 */
export const MANIFEST_DIR = path.join(PROJECT_ROOT, '.import-manifests')

export const MANIFEST_BEFORE = path.join(MANIFEST_DIR, 'manifest-before.txt')
export const MANIFEST_AFTER = path.join(MANIFEST_DIR, 'manifest-after.txt')

/** Generated JSON snapshot. Git-ignored. */
export const GENERATED_DIR = path.join(PROJECT_ROOT, 'src', 'data', 'generated')
export const SNAPSHOT_JSON = path.join(GENERATED_DIR, 'opportunity-data.json')

/** `.obsidian` is workspace metadata and is excluded from snapshot and manifest. */
export const EXCLUDED_DIR = '.obsidian'
