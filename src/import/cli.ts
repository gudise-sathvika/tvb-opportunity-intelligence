/**
 * Importer CLI. Run with `npm run import:data`.
 *
 * Sequence:
 *   1. manifest of source content (BEFORE)
 *   2. recoverable snapshot of source content, outside the vault
 *   3. read-only parse and build of the snapshot JSON
 *   4. validation against the SOURCE
 *   5. manifest of source content (AFTER) and compare
 *   6. write the generated JSON only if every check passed
 *
 * The vault is opened read-only throughout. Nothing is written into it.
 * If any check fails, nothing is written and the exit code is non-zero.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  GENERATED_DIR,
  MANIFEST_AFTER,
  MANIFEST_BEFORE,
  MANIFEST_DIR,
  PROJECT_ROOT,
  SNAPSHOT_DIR,
  SNAPSHOT_JSON,
  VAULT_ROOT,
} from './paths'
import { buildManifest, diffManifests, serializeManifest } from './manifest'
import { createSnapshot } from './snapshot'
import { buildSnapshot, serializeSnapshot, allRecords } from './build'
import { runValidation } from './validate'
import { TOTAL_SCHEMA_FIELDS } from './schema'

const BOLD = '[1m'
const DIM = '[2m'
const RED = '[31m'
const GREEN = '[32m'
const RESET = '[0m'

function heading(text: string): void {
  console.log(`\n${BOLD}${text}${RESET}`)
}

function main(): number {
  console.log(`${BOLD}TVB vault importer (read-only)${RESET}`)
  console.log(`${DIM}source vault : ${VAULT_ROOT}${RESET}`)
  console.log(`${DIM}project root : ${PROJECT_ROOT}${RESET}`)

  if (!VAULT_ROOT) {
    console.error(`${RED}FATAL: no source vault configured.${RESET}`)
    console.error(`${DIM}Set TVB_SOURCE_VAULT in ${path.join(PROJECT_ROOT, '.env')} (see .env.example).${RESET}`)
    return 2
  }

  if (!fs.existsSync(VAULT_ROOT)) {
    console.error(`${RED}FATAL: source vault not found: ${VAULT_ROOT}${RESET}`)
    return 2
  }

  /* 1. BEFORE manifest */
  heading('1. Source manifest (before)')
  const manifestBefore = buildManifest(VAULT_ROOT)
  fs.mkdirSync(MANIFEST_DIR, { recursive: true })
  fs.writeFileSync(MANIFEST_BEFORE, serializeManifest(manifestBefore))
  console.log(`  files      : ${manifestBefore.entries.length}`)
  console.log(`  aggregate  : ${manifestBefore.aggregate}`)
  console.log(`  written    : ${MANIFEST_BEFORE}`)

  /* 2. Snapshot */
  heading('2. Recoverable snapshot (outside the vault)')
  const snap = createSnapshot(VAULT_ROOT, SNAPSHOT_DIR)
  console.log(`  location   : ${snap.snapshotDir}`)
  console.log(`  files      : ${snap.fileCount}`)
  console.log(`  .obsidian  : excluded`)
  console.log(`  mismatched : ${snap.mismatched.length === 0 ? 'none (byte-identical)' : snap.mismatched.join(', ')}`)
  if (snap.mismatched.length > 0) {
    console.error(`${RED}FATAL: snapshot copy mismatch; stopping.${RESET}`)
    return 2
  }

  /* 3. Build */
  heading('3. Import')
  let built
  try {
    built = buildSnapshot(VAULT_ROOT)
  } catch (e) {
    console.error(`${RED}FATAL: import failed: ${(e as Error).message}${RESET}`)
    return 2
  }
  const snapData = built.snapshot
  const all = allRecords(snapData)
  console.log(`  records    : ${all.length} (${TOTAL_SCHEMA_FIELDS} schema fields)`)
  console.log(`  excluded   : ${built.excludedFictionalIds.length} records not eligible for the production snapshot`)
  console.log(`  unresolved : ${built.unresolvedLinks.length}`)

  /* 4 + 5. Validate, then AFTER manifest */
  heading('4. Validation')
  const manifestAfter = buildManifest(VAULT_ROOT)
  fs.writeFileSync(MANIFEST_AFTER, serializeManifest(manifestAfter))
  const diff = diffManifests(manifestBefore, manifestAfter)
  console.log(`  after aggregate : ${manifestAfter.aggregate}`)
  console.log(`  source changed  : ${diff.identical ? 'NO (identical)' : 'YES'}`)

  const { results, failures } = runValidation(
    snapData,
    VAULT_ROOT,
    manifestBefore,
    manifestAfter,
    built.excludedFictionalIds,
  )

  let lastGroup = ''
  for (const r of results) {
    if (r.group !== lastGroup) {
      lastGroup = r.group
      console.log(`\n  ${BOLD}${lastGroup}${RESET}`)
    }
    const tag = r.pass ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`
    console.log(`    ${tag}  ${r.name}`)
    if (!r.pass) console.log(`          ${RED}${r.detail}${RESET}`)
  }

  heading('5. Result')
  console.log(`  checks    : ${results.length - failures.length}/${results.length} passed`)

  if (failures.length > 0) {
    console.log(`\n${RED}${failures.length} check(s) failed. Generated JSON was NOT written.${RESET}`)
    for (const f of failures) console.log(`  - [${f.group}] ${f.name}: ${f.detail}`)
    return 1
  }

  /* 6. Write output */
  fs.mkdirSync(GENERATED_DIR, { recursive: true })
  fs.writeFileSync(SNAPSHOT_JSON, serializeSnapshot(snapData), 'utf8')
  const size = fs.statSync(SNAPSHOT_JSON).size
  console.log(`  ${GREEN}All checks passed.${RESET}`)
  console.log(`  output    : ${SNAPSHOT_JSON}`)
  console.log(`  size      : ${(size / 1024).toFixed(1)} KB`)

  if (built.ambiguous.length > 0) {
    console.log(`\n  ${BOLD}Ambiguous classifications to review:${RESET}`)
    for (const a of built.ambiguous) console.log(`    ${a.id}: ${a.note}`)
  }
  if (built.unresolvedLinks.length > 0) {
    console.log(`\n  ${BOLD}Unresolved links (preserved, not dropped):${RESET}`)
    for (const u of built.unresolvedLinks) {
      console.log(`    ${u.fromId} ${u.origin}.${u.field} -> ${u.raw}`)
    }
  } else {
    console.log(`\n  Unresolved links: none`)
  }

  return 0
}

process.exit(main())
