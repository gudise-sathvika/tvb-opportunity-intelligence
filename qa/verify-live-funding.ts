/**
 * Persistent verification of the Phase V live USAspending funding source.
 *
 * Reads one GENUINE response from the official API through the SAME production
 * server handler (`handleUsaSpendingBridge` → `createFetchTransport` → one
 * read-only POST) and replays it through the REAL Phase D orchestrator with the
 * USAspending adapter, exactly like the browser's live funding run would.
 * Prints the normalized funding candidates with their live-source provenance.
 *
 * Read-only: performs no writes, downloads no documents, creates no proposals,
 * and never touches the production Vault or generated production data.
 *
 *   Run with:  npx tsx qa/verify-live-funding.ts
 */

import {
  handleUsaSpendingBridge,
  USA_BRIDGE_PROFILE_ID,
  USA_BRIDGE_DEFAULT_LIMIT,
} from '../src/live-source/usaspending-bridge/handler'
import { createLiveUsaSpendingDiscovery, USA_LIVE_RUN_ID_PREFIX } from '../src/live-source/live-funding-discovery'
import type { UsaSpendingTransport } from '../src/automation/usaspending-adapter'
import { USA_SPENDING_SOURCE_ID } from '../src/automation/registry'

const KEYWORD = 'solar energy'
const COMPANY_ID = 'COM-001'
const LIMIT = USA_BRIDGE_DEFAULT_LIMIT

function nowIso(): string {
  return new Date().toISOString()
}

async function main(): Promise<void> {
  const requestedAt = nowIso()
  const runId = `${USA_LIVE_RUN_ID_PREFIX}-VERIFY`

  const { httpStatus, body } = await handleUsaSpendingBridge({
    runId,
    companyId: COMPANY_ID,
    keyword: KEYWORD,
    publishedSince: '',
    limit: LIMIT,
    requestedAt,
  })

  console.log(`bridge  HTTP     = ${httpStatus}`)
  console.log(`bridge  ok       = ${body.ok}`)
  if (!body.ok) {
    console.log(`source  errors   = ${body.errors.map((error) => error.message).join('; ')}`)
    return
  }
  console.log(`source  status   = ${body.status}  (${body.body.length} bytes raw, one live POST)`)
  console.log(`source  endpt    = https://api.usaspending.gov/api/v2/search/spending_by_award/`)
  console.log(`source  id       = ${USA_SPENDING_SOURCE_ID}  (official, public, no credentials)`)

  const transport: UsaSpendingTransport = () => {
    if (!body.ok) {
      throw new Error(body.errors.map((error) => error.message).join('; '))
    }
    return { status: body.status, body: body.body }
  }

  // The browser store does exactly this: runCompany over the bridge, then
  // finishRun hands normalized candidates to the Phase E review queue.
  const store = createLiveUsaSpendingDiscovery({ bridge: async () => body, requestedAt })
  const context = store.beginRun({ keyword: KEYWORD })
  const company = await store.runCompany(context, COMPANY_ID)
  const outcome = store.finishRun(context, [company])

  console.log(`run     profile   = ${USA_BRIDGE_PROFILE_ID} | domain = funding | scenario = ${outcome.scenario}`)
  console.log(`run     outcome   = ${outcome.outcome}`)
  console.log(`run     received  = ${outcome.counts.candidatesReceived}`)
  console.log(`run     created   = ${outcome.counts.candidatesCreated}`)
  console.log(`run     dupes     = ${outcome.counts.duplicates}`)
  console.log(`run     blocked   = ${outcome.counts.blockedSources} | failed = ${outcome.counts.failedSources}`)
  console.log(`run     review    = ${outcome.needsReview} of ${outcome.companies[0]?.candidates.length ?? 0} funding candidate(s)`)

  console.log(`candidates (live-source ${USA_SPENDING_SOURCE_ID}):`)
  for (const candidate of outcome.companies[0].candidates.slice(0, 10)) {
    console.log(`- [${candidate.sourceId}] ${candidate.sourceTitle}`)
    console.log(`  ${candidate.sourceUrl}`)
  }
}

void main().catch((error: unknown) => {
  console.error(`verification failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})