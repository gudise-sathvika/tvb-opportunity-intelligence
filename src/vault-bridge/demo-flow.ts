/**
 * Phase V live demonstration — approved candidate → controlled Vault write.
 *
 * Two operator-driven modes; the script itself NEVER writes to the
 * filesystem — every file this demo produces is created either by the
 * controlled writer (through `handleVaultBridge`, the same handler the
 * browser buttons call) or by the operator's own shell commands.
 *
 *   prepare  — ONE live TED retrieval (keyword/since/limit), the ordinary
 *              access gate, and the ordinary candidate pipeline; then it
 *              picks the first finding that can honestly become a READY
 *              notice, approves it through the normal human-review decision,
 *              runs an interim preview (which still has no organization
 *              record, so it is REJECTED — proving approval alone writes
 *              nothing), and prints a single JSON document to stdout:
 *              `{ item, preview, orgSeed }`.
 *
 *   write    — reads that JSON from stdin, previews it (now with the
 *              operator-seeded organization record → READY), performs the
 *              explicit write (SUCCESS), performs it a second time
 *              (ALREADY_EXISTS — byte-identical, never overwritten), and
 *              verifies the stored file equals the previewed Markdown.
 *
 * The target vault is always an isolated directory passed via `--vault`.
 * Progress and instructions go to stderr; stdout carries only machine JSON.
 *
 * Run:
 *   npx tsx src/vault-bridge/demo-flow.ts prepare --vault <dir> > item.json
 *   # operator seeds the organization record printed below into <dir>
 *   npx tsx src/vault-bridge/demo-flow.ts write --vault <dir> < item.json
 */

import fs from 'node:fs'

import { CONTROLLED_VALUES } from '../import/controlled-values'
import { gateDiscovery } from '../automation/discovery-run'
import { createDiscoveryRequest } from '../automation/request'
import { runCandidatePipeline } from '../automation/pipeline'
import type { DiscoveryCandidate } from '../automation/candidate'
import { createTedAdapter } from '../automation/ted-adapter'
import { DEFAULT_SOURCE_REGISTRY, TED_SOURCE_ID } from '../automation/registry'
import { applyReviewDecision, createReviewItem } from '../automation/review-queue'
import { RECORD_DIRS } from '../types/registry'
import { createFetchTransport } from '../live-source/fetch-transport'
import { handleVaultBridge } from './handler'

/** Procedure codes the proposal layer can honestly map to a method. */
const MAPPABLE_PROCEDURE_CODES: readonly string[] = ['cn-standard', 'cn-restricted', 'cn-limited']

/** Windows-hostile filename characters — a buyer name containing one of these
 *  could not be seeded as a record filename, so such a finding is skipped. */
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*]/

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

interface CliOptions {
  readonly mode: 'prepare' | 'write'
  readonly vaultRoot: string | null
  readonly keyword: string
  readonly publishedSince: string
  readonly limit: number
  readonly help: boolean
}

function parseArgs(argv: readonly string[]): CliOptions | string {
  const mode = argv[0]
  if (mode !== 'prepare' && mode !== 'write') {
    return `unknown mode ${JSON.stringify(mode ?? '')} — expected "prepare" or "write"`
  }
  let vaultRoot: string | null = null
  let keyword = 'solar'
  let publishedSince = '20260908'
  let limit = 50
  let help = false
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--vault') {
      vaultRoot = argv[i + 1] ?? null
      i += 1
    } else if (arg === '--keyword') {
      keyword = argv[i + 1] ?? keyword
      i += 1
    } else if (arg === '--since') {
      publishedSince = argv[i + 1] ?? publishedSince
      i += 1
    } else if (arg === '--limit') {
      const parsed = Number.parseInt(argv[i + 1] ?? '', 10)
      if (!Number.isNaN(parsed) && parsed > 0) limit = parsed
      i += 1
    } else {
      return `unknown argument ${JSON.stringify(arg)}`
    }
  }
  if (help) return { mode, vaultRoot, keyword, publishedSince, limit, help }
  if (vaultRoot === null || vaultRoot.trim() === '') {
    return 'missing --vault <directory> — the demo always targets an explicit isolated vault'
  }
  return { mode, vaultRoot, keyword, publishedSince, limit, help }
}

const USAGE = [
  'Phase V live demonstration:',
  '  npx tsx src/vault-bridge/demo-flow.ts prepare --vault <dir> > item.json',
  '    (one live TED request; prints { item, preview, orgSeed } as JSON)',
  '  # seed the organization record into <dir> using the printed path/content',
  '  npx tsx src/vault-bridge/demo-flow.ts write --vault <dir> < item.json',
  '    (preview → explicit write → duplicate write → byte verification)',
].join('\n')

function isSuitable(candidate: DiscoveryCandidate): boolean {
  if (candidate.domain !== 'procurement') return false
  if (
    typeof candidate.sourceRecordId !== 'string' ||
    candidate.sourceRecordId.trim() === '' ||
    typeof candidate.sourceTitle !== 'string' ||
    candidate.sourceTitle.trim() === '' ||
    typeof candidate.sourceUrl !== 'string' ||
    candidate.sourceUrl.trim() === '' ||
    typeof candidate.sourceOrganization !== 'string' ||
    candidate.sourceOrganization.trim() === '' ||
    typeof candidate.sourcePublicationDate !== 'string' ||
    candidate.sourcePublicationDate.trim() === ''
  ) {
    return false
  }
  const normalization = candidate.normalization
  if (normalization === null) return false
  const rawType = normalization.rawType.normalized?.trim().toLowerCase() ?? ''
  if (!MAPPABLE_PROCEDURE_CODES.includes(rawType)) return false
  const country = normalization.country.normalized?.trim() ?? ''
  if (!CONTROLLED_VALUES['country'].includes(country)) return false
  const publicationDate = normalization.publicationDate.normalized?.trim() ?? ''
  if (!ISO_DATE.test(publicationDate)) return false
  const buyer = normalization.organization.normalized ?? ''
  if (buyer.trim() === '' || ILLEGAL_FILENAME_CHARS.test(buyer)) return false
  return true
}

async function runPrepare(options: CliOptions): Promise<number> {
  if (options.vaultRoot === null) return 1
  const requestedAt = new Date().toISOString()
  const request = createDiscoveryRequest({
    runId: 'RUN-TED-PHASE-V-DEMO',
    companyId: 'COM-PHASE-V-DEMO',
    discoveryProfileId: 'DP-PHASE-V-DEMO',
    sourceId: TED_SOURCE_ID,
    domain: 'procurement',
    queryTerms: [options.keyword],
    exclusions: [],
    requestedAt,
    keyword: options.keyword,
    adapterConfig: { publishedSince: options.publishedSince, limit: options.limit },
  })

  console.error('Phase V demo — prepare (one live read-only TED request)')
  console.error(`requestedAt: ${requestedAt}`)
  console.error(`query:       keyword "${options.keyword}", published since ${options.publishedSince}, limit ${options.limit}`)
  console.error(`vault:       ${options.vaultRoot} (must already exist; nothing is created by this script)`)

  const adapter = createTedAdapter({ transport: createFetchTransport() })
  const deps = { registry: DEFAULT_SOURCE_REGISTRY, adapter }

  const gate = gateDiscovery(request, deps)
  if (gate.status === 'BLOCKED') {
    console.error(`GATE: BLOCKED — ${gate.result.blockedReason}`)
    return 1
  }
  console.error('GATE: READY (source access state AVAILABLE)')

  await adapter.retrieve(request)
  const outcome = runCandidatePipeline(request, deps)
  console.error(
    `outcome:     ${outcome.outcome} — received ${outcome.counts.candidatesReceived} · ` +
      `created ${outcome.counts.candidatesCreated} · duplicates ${outcome.counts.duplicates} · blocked ${outcome.counts.blocked}`,
  )
  for (const error of outcome.errors) console.error(`error:   ${error}`)

  const suitable = outcome.candidates.filter(isSuitable)
  if (suitable.length === 0) {
    console.error('no finding in this result set can become a READY notice:')
    for (const candidate of outcome.candidates) {
      const normalization = candidate.normalization
      console.error(
        `  - ${(candidate.sourceRawType ?? 'no type')} · country ${
          normalization?.country.normalized ?? 'unknown'
        } · buyer ${candidate.sourceOrganization ?? 'unknown'}`,
      )
    }
    return 1
  }

  const chosen = suitable[0]
  const interim = createReviewItem(chosen)
  const item = applyReviewDecision(interim, {
    reviewId: interim.reviewId,
    decision: 'APPROVED',
    reviewerId: 'RVW-DEMO',
    decidedAt: new Date().toISOString(),
    evidenceNotes: 'Phase V live demonstration — approved after reading the finding.',
  })
  console.error(`chosen:      ${item.sourceRecordId} — ${item.sourceTitle}`)
  console.error(
    `             buyer ${item.normalization?.organization.normalized ?? 'unknown'} · ` +
      `country ${item.normalization?.country.normalized ?? 'unknown'} · ` +
      `procedure ${item.normalization?.rawType.normalized ?? 'unknown'} · APPROVED by RVW-DEMO`,
  )

  const preview = handleVaultBridge({ kind: 'preview', item }, options.vaultRoot)
  console.error(
    `interim preview (no organization record yet): ${preview.body.status}` +
      (preview.body.errors.length > 0
        ? ` — ${preview.body.errors.map((error) => `${error.code}${error.field === undefined ? '' : `(${error.field})`}`).join(', ')}`
        : ''),
  )
  console.error('approval and preview mutated nothing — only "write" can create a file.')

  const buyer = item.normalization?.organization.normalized ?? ''
  const relativePath = `${RECORD_DIRS['organization']}/ORG-900 — ${buyer}.md`
  const orgSeed = {
    relativePath,
    content: `---\norganization_id: ORG-900\norganization_name: ${buyer}\n---\n\n# ${buyer}\n`,
  }
  console.error('')
  console.error('Next steps (the organization record must exist before the preview is READY):')
  console.error(`  mkdir -p "${options.vaultRoot}/${RECORD_DIRS['organization']}"`)
  console.error(`  cat > "${options.vaultRoot}/${relativePath}" <<'ORGEOF'`)
  process.stderr.write(orgSeed.content)
  console.error('ORGEOF')
  console.error(`  npx tsx src/vault-bridge/demo-flow.ts write --vault "${options.vaultRoot}" < item.json`)

  process.stdout.write(`${JSON.stringify({ item, preview: preview.body, orgSeed }, null, 2)}\n`)
  return 0
}

function runWrite(options: CliOptions): number {
  if (options.vaultRoot === null) return 1
  let payload: unknown
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'))
  } catch (error) {
    console.error(`stdin must carry the JSON from "prepare": ${String(error)}`)
    return 1
  }
  const item = (payload as { item?: unknown }).item
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    console.error('stdin JSON has no "item" object')
    return 1
  }

  console.error('Phase V demo — write (explicit, operator-driven)')
  console.error(`vault:       ${options.vaultRoot}`)

  const preview = handleVaultBridge({ kind: 'preview', item }, options.vaultRoot)
  console.error(`preview:     ${preview.body.status} → ${preview.body.targetPath ?? '(no target)'}`)
  if (preview.body.status !== 'READY') {
    for (const error of preview.body.errors) {
      console.error(`  ${error.code}${error.field === undefined ? '' : ` (${error.field})`}: ${error.message}`)
    }
    process.stdout.write(`${JSON.stringify({ preview: preview.body }, null, 2)}\n`)
    return 2
  }

  const first = handleVaultBridge({ kind: 'write', item }, options.vaultRoot)
  console.error(`first write: ${first.body.status}`)
  if (first.body.status !== 'SUCCESS') {
    for (const error of first.body.errors) console.error(`  ${error.code}: ${error.message}`)
    process.stdout.write(
      `${JSON.stringify({ preview: preview.body, firstWrite: first.body }, null, 2)}\n`,
    )
    return 3
  }

  const second = handleVaultBridge({ kind: 'write', item }, options.vaultRoot)
  console.error(`re-write:    ${second.body.status} (must be ALREADY_EXISTS, file untouched)`)

  const target = first.body.targetPath
  let stored: string | null = null
  try {
    stored = target === null ? null : fs.readFileSync(`${options.vaultRoot}/${target}`, 'utf8')
  } catch (error) {
    console.error(`could not read back the stored record: ${String(error)}`)
  }
  const identical = stored !== null && stored === preview.body.markdown
  console.error(`verification: ${identical ? 'stored file is byte-identical to the previewed Markdown' : 'MISMATCH'}`)

  process.stdout.write(
    `${JSON.stringify(
      {
        preview: { status: preview.body.status, recordType: preview.body.recordType, recordId: preview.body.recordId, targetPath: preview.body.targetPath },
        firstWrite: { status: first.body.status, errors: first.body.errors },
        secondWrite: { status: second.body.status, errors: second.body.errors },
        verification: identical ? 'IDENTICAL' : 'MISMATCH',
      },
      null,
      2,
    )}\n`,
  )

  if (second.body.status !== 'ALREADY_EXISTS') return 4
  return identical ? 0 : 4
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (typeof parsed === 'string') {
    console.error(parsed)
    console.error('')
    console.error(USAGE)
    process.exitCode = 1
    return
  }
  if (parsed.help) {
    console.error(USAGE)
    return
  }
  if (parsed.mode === 'prepare') {
    process.exitCode = await runPrepare(parsed)
  } else {
    process.exitCode = runWrite(parsed)
  }
}

void main().catch((error: unknown) => {
  console.error(`demo failed: ${String(error)}`)
  process.exitCode = 1
})
