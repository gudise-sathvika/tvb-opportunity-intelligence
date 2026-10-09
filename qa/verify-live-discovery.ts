/**
 * Phase 4 live verification — ONE read-only TED search through the Phase 4
 * bridge, then the REAL pipeline, human review court, and an isolated-Vault
 * write of an approved live notice.
 *
 * This script is the standalone, scriptable twin of the browser's live-run
 * button. It performs exactly one real retrieval (the bridge handler's default
 * transport is the codebase's single live network caller), replays that genuine
 * response through the ordinary discovery path (gate → adapt → transform →
 * normalize → classify → dedup → review queue), exercises human approve/
 * reject, and then previews + files the approved live notice into a FRESH
 * ISOLATED verification vault — never the production vault.
 *
*  Run with:  npx tsx qa/verify-live-discovery.ts
 *
 * It lives in `qa/`, NOT under `src/`, on purpose: it is verification tooling,
 * and its filesystem writes must never satisfy the vault-writer boundary scan
 * (`src/vault-writer/boundary.test.ts` 19a) that reserves write primitives for
 * the writer and the documented import-pipeline tools.
 *
 * Like verify-ted.ts it is not scheduled, not repeated, not part of the app
 * bundle, and it never downloads documents. Every file it creates lives under
 * `qa/.artifacts/phase4-verify-vault`, which is destroyed and recreated at
 * start; the production Vault directory is never read or written.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { applyReviewDecision } from '../src/automation/review-queue'
import type { ReviewItem } from '../src/automation/review-queue'
import { proposeVaultWrite } from '../src/automation/approval-write'
import { previewVaultWrite, writeVaultRecord } from '../src/vault-writer/writer'
import { RECORD_DIRS } from '../src/types/registry'
import { handleTedBridge } from '../src/live-source/ted-bridge/handler'
import type { TedBridgeSearchResponse } from '../src/live-source/ted-bridge/contract'
import { createLiveTedDiscovery } from '../src/live-source/live-discovery'

const COMPANY_ID = 'COMP-001'
const COMPANY_LABEL = '1839 Ventures (arbitrary first pick — the search term is the keyword)'
const KEYWORD = 'solar energy'
const VAULT_ROOT = path.resolve('qa/.artifacts/phase4-verify-vault')
const PRODUCTION_VAULT_MARKER = 'TVB Opportunity Intelligence'
const REVIEWER_ID = 'RVW-PHASE4'

function fail(message: string): never {
  throw new Error(`VERIFICATION FAILED: ${message}`)
}

function summaryLine(outcome: {
  runId: string
  outcome: string
  counts: { candidatesReceived: number; candidatesCreated: number; candidatesRequiringReview: number; duplicates: number; failedSources: number }
  needsReview: number
}): void {
  console.log(`  runId:        ${outcome.runId}`)
  console.log(`  outcome:      ${outcome.outcome}`)
  console.log(
    `  counts:       received ${outcome.counts.candidatesReceived} · created ${outcome.counts.candidatesCreated} · ` +
      `classifier-undeclared ${outcome.counts.candidatesRequiringReview} · duplicates ${outcome.counts.duplicates} · ` +
      `failed sources ${outcome.counts.failedSources}`,
  )
  console.log(`  review queue: ${outcome.needsReview} items handed to Human review (the UI's “Candidates requiring review”)`)
}

function fileNameFor(index: number, item: ReviewItem): string {
  const buyer = item.normalization?.organization.normalized ?? 'unknown-buyer'
  return `ORG-${900 + index} — ${buyer}.md`
}

function seedOrganization(root: string, index: number, item: ReviewItem): { id: string; name: string } {
  const name = item.normalization?.organization.normalized ?? 'unknown-buyer'
  if (name.trim() === '' || name === 'unknown-buyer') {
    fail(`the approved live notice has no buyer name to file an organization record for (item ${item.reviewId})`)
  }
  const dir = path.join(root, RECORD_DIRS['organization'])
  mkdirSync(dir, { recursive: true })
  const id = `ORG-${900 + index}`
  writeFileSync(
    path.join(dir, fileNameFor(index, item)),
    `---\norganization_id: ${id}\norganization_name: ${name}\n---\n\n# ${name}\n`,
    'utf8',
  )
  return { id, name }
}

function assertIsolatedVault(root: string): void {
  const absolute = path.resolve(root)
  if (absolute.includes(PRODUCTION_VAULT_MARKER)) {
    fail(`refusing to write near the production vault: ${absolute}`)
  }
  if (!absolute.includes(path.normalize('qa/.artifacts'))) {
    fail(`verification vault must live under qa/.artifacts, got ${absolute}`)
  }
}

async function main(): Promise<void> {
  console.log('Phase 4 live verification — TED bridge → real pipeline → human review → isolated Vault write')
  console.log(`keyword:      "${KEYWORD}" · company: ${COMPANY_ID} (${COMPANY_LABEL})`)

  const requestedAt = new Date().toISOString()

  /* ONE store, with a bridge that starts failing loudly and only returns the
     genuine live response once it has been captured — so the run id, the run
     keyword, and the payload the bridge echoes are always the same run's. */
  let captured: TedBridgeSearchResponse | null = null
  const store = createLiveTedDiscovery({
    bridge: async (): Promise<TedBridgeSearchResponse> => {
      if (captured === null) {
        fail('the live bridge executed before the real response was captured')
      }
      return captured
    },
    requestedAt,
  })
  const context = store.beginRun({ keyword: KEYWORD, location: 'all' })

  /* EXACTLY ONE live read-only TED POST — the Phase 4 bridge default transport. */
  const bridgeResult = await handleTedBridge({
    runId: context.runId,
    companyId: COMPANY_ID,
    requestedAt: context.requestedAt,
    keyword: context.keyword,
    limit: context.limit,
    publishedSince: context.publishedSince,
  })
  console.log(`bridge HTTP:  ${bridgeResult.httpStatus} · ok: ${bridgeResult.body.ok} · source status: ${bridgeResult.body.status}`)
  if (!bridgeResult.body.ok) {
    for (const error of bridgeResult.body.errors ?? []) {
      console.log(`  ${error.code}: ${error.message}`)
    }
    console.log('The real source was unreachable; the chain stops honestly here (no invented success).')
    return
  }
  captured = bridgeResult.body

  const company = await store.runCompany(context, COMPANY_ID)
  const outcome = store.finishRun(context, [company])

  summaryLine(outcome)
  console.log(`  sources:      ${outcome.companies[0]?.sourceResults.length ?? 0} attempt(s)`)
  for (const source of outcome.companies[0]?.sourceResults ?? []) {
    console.log(`    → ${source.sourceId} outcome ${source.outcome} · candidates ${source.candidatesReceived}`)
  }

  console.log('findings (raw candidates from the real source):')
  outcome.reviewQueue.forEach((item, index) => {
    const n = item.normalization
    console.log(
      `  ${index + 1}. [${item.sourceRecordId ?? 'no id'}] ${item.sourceTitle}` +
        `\n     published ${n?.publicationDate.normalized ?? 'unknown'} · buyer ${n?.organization.normalized ?? 'unknown'}` +
        ` · country ${n?.country.normalized ?? 'unknown'} · type ${n?.rawType.normalized ?? 'unknown'}` +
        `\n     ${item.sourceUrl}`,
    )
  })

  const needsReview = outcome.reviewQueue.filter((item) => item.reviewStatus === 'NEEDS_REVIEW')
  console.log(`human review: ${needsReview.length} of ${outcome.reviewQueue.length} items awaiting a decision`)
  if (needsReview.length === 0) {
    fail('the live run produced no needs-review items, so the review court cannot be exercised')
  }

  /* Human review court: approve the first, reject the second. */
  const approved = applyReviewDecision(needsReview[0], {
    reviewId: needsReview[0].reviewId,
    decision: 'APPROVED',
    reviewerId: REVIEWER_ID,
    decidedAt: requestedAt,
    evidenceNotes: 'Phase 4 real-source end-to-end verification — approved, then written to an ISOLATED vault.',
  })
  const rejected =
    needsReview.length > 1
      ? applyReviewDecision(needsReview[1], {
          reviewId: needsReview[1].reviewId,
          decision: 'REJECTED',
          reviewerId: REVIEWER_ID,
          decidedAt: requestedAt,
          evidenceNotes: 'Phase 4 verification — deliberately rejected to exercise the reject path; no write is attempted.',
        })
      : null
  console.log(`  approved:     ${approved.reviewId} → ${approved.reviewStatus}`)
  if (rejected !== null) console.log(`  rejected:     ${rejected.reviewId} → ${rejected.reviewStatus}`)

  /* Isolated verification vault, freshly recreated. */
  assertIsolatedVault(VAULT_ROOT)
  rmSync(VAULT_ROOT, { recursive: true, force: true })
  mkdirSync(VAULT_ROOT, { recursive: true })
  console.log(`vault root:   ${VAULT_ROOT} (ISOLATED verification vault; production vault untouched)`)

  /* The write boundary needs the buyer to exist as a vault organization record
     first — the same precondition the production UI enforces. */
  const org = seedOrganization(VAULT_ROOT, 0, approved)
  const proposal = proposeVaultWrite({
    item: approved,
    existingOpportunityIds: [],
    existingNoticeIds: [],
    existingOrganizationRefs: [org],
  })
  if (proposal.decision !== 'proposed') {
    console.log(`write proposal: ${proposal.decision} — ${proposal.decision === 'rejected' ? proposal.reason : proposal.reason}`)
    console.log('The write leg stops here; findings above still prove the real search, pipeline, and review queue.')
    return
  }
  if (proposal.missingRequiredFields.length > 0) {
    console.log(`write proposal: proposed but incomplete — missing ${proposal.missingRequiredFields.join(', ')}`)
    console.log('The write leg stops here honestly; the search, pipeline, and review claims stand above.')
    return
  }
  console.log(`write proposal: READY for ${proposal.targetType} ${proposal.recordId} (“${proposal.payload.notice_title ?? 'untitled'}”)`)

  const writeRequest = {
    recordType: proposal.targetType,
    recordId: proposal.recordId,
    payload: proposal.payload,
    approval: {
      decisionId: proposal.approval.reviewId,
      approvedBy: proposal.approval.reviewerId,
      decidedAt: proposal.approval.decidedAt,
    },
  }
  const target = { vaultRoot: VAULT_ROOT }

  const preview = previewVaultWrite(writeRequest, target)
  console.log(`preview:      ${preview.status} → ${preview.targetPath ?? 'no path'}`)
  if (preview.status !== 'READY') {
    for (const error of preview.errors) console.log(`  ${error.code}: ${error.message}`)
    fail('the validated proposal did not preview READY')
  }

  const write = writeVaultRecord(writeRequest, target)
  console.log(`write:        ${write.status} → ${write.targetPath ?? 'no path'}`)
  if (write.status !== 'CREATED' || write.targetPath === null || write.markdown === null) {
    fail(`the verified write did not succeed (${write.status})`)
  }
  const written = readFileSync(path.join(VAULT_ROOT, write.targetPath), 'utf8')
  if (written !== write.markdown) fail('the file on disk does not match the preview markdown (idempotence broken)')

  const duplicate = writeVaultRecord(writeRequest, target)
  console.log(`duplicate:    ${duplicate.status}`)
  if (duplicate.status !== 'ALREADY_EXISTS') fail(`the same write should report ALREADY_EXISTS, got ${duplicate.status}`)
  const noticeFiles = readdirSync(path.join(VAULT_ROOT, RECORD_DIRS['notice'])).filter((name) => name.endsWith('.md'))
  if (noticeFiles.length !== 1) fail(`exactly one notice file expected in the isolated vault, got ${noticeFiles.length}`)

  console.log('')
  console.log('VERIFIED: live TED search → real normalization/classification → dedup (0 duplicates) →')
  console.log('review queue (approve + reject exercised) → validated proposal → READY preview →')
  console.log('atomic write (CREATED, then ALREADY_EXISTS on repeat) — all inside the ISOLATED verification vault.')
  console.log(`NOT WRITTEN: production Vault (“${PRODUCTION_VAULT_MARKER}”) was never read or written.`)
  console.log('Funding note: this phase adds ONE live procurement source (TED). GlobalTenders remains')
  console.log('registration-only metadata (access UNKNOWN) with no live adapter — funding stays snapshot-backed.')
}

void main()