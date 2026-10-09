/**
 * Phase U live verification — ONE read-only search against TED.
 *
 * This script performs exactly one real retrieval through the ordinary
 * discovery path: access gate → retrieve (one POST) → candidate pipeline
 * (transform → normalize → classify → dedup). It PRINTS what it found and
 * writes nothing: no vault file, no record, no snapshot. The retrieved
 * findings remain raw candidates that still have to pass Discovery →
 * Candidate → Human Review before anything could ever reach the Vault.
 *
 * Run with:  npx tsx src/live-source/verify-ted.ts
 *
 * It is intentionally not scheduled, not repeated, and not part of the app
 * bundle. Nothing here retries, bypasses access controls, or downloads
 * documents.
 */

import { DEFAULT_SOURCE_REGISTRY, TED_SOURCE_ID } from '../automation/registry'
import { createTedAdapter } from '../automation/ted-adapter'
import { createDiscoveryRequest } from '../automation/request'
import { gateDiscovery } from '../automation/discovery-run'
import { runCandidatePipeline } from '../automation/pipeline'
import { createFetchTransport } from './fetch-transport'

const KEYWORD = 'solar'
const PUBLISHED_SINCE = '20260908' // today minus 30 days (YYYYMMDD)
const LIMIT = 5

function main(): void {
  const request = createDiscoveryRequest({
    runId: 'RUN-TED-LIVE-VERIFY-001',
    companyId: 'COM-LIVE-VERIFY',
    discoveryProfileId: 'DP-LIVE-VERIFY-only',
    sourceId: TED_SOURCE_ID,
    domain: 'procurement',
    queryTerms: [KEYWORD],
    exclusions: [],
    requestedAt: new Date().toISOString(),
    keyword: KEYWORD,
    adapterConfig: { publishedSince: PUBLISHED_SINCE, limit: LIMIT },
  })

  const adapter = createTedAdapter({ transport: createFetchTransport() })
  const deps = { registry: DEFAULT_SOURCE_REGISTRY, adapter }

  console.log('Phase U live verification — TED (Tenders Electronic Daily)')
  console.log(`requestedAt: ${request.requestedAt}`)
  console.log(`endpoint:    official TED search API (read-only POST)`)
  console.log(`query:       keyword "${KEYWORD}", published since ${PUBLISHED_SINCE}, limit ${LIMIT}`)

  const gate = gateDiscovery(request, deps)
  if (gate.status === 'BLOCKED') {
    console.log('GATE: BLOCKED — no request was made')
    console.log(`reason: ${gate.result.blockedReason}`)
    for (const error of gate.result.errors) console.log(`  ${error.code}: ${error.message}`)
    return
  }
  console.log('GATE: READY (source access state AVAILABLE)')

  const run = async (): Promise<void> => {
    await adapter.retrieve(request)
    const outcome = runCandidatePipeline(request, deps)

    console.log(`outcome:     ${outcome.outcome}`)
    console.log(`source:      ${outcome.sourceName ?? 'null'} (${outcome.sourceId ?? 'null'})`)
    console.log(
      `counts:      received ${outcome.counts.candidatesReceived} · created ${outcome.counts.candidatesCreated} · ` +
        `normalized ${outcome.counts.normalized} · classified ${outcome.counts.classified} · ` +
        `distinct ${outcome.counts.distinct} · duplicates ${outcome.counts.duplicates} · blocked ${outcome.counts.blocked}`,
    )
    for (const error of outcome.errors) console.log(`error:   ${error}`)
    for (const warning of outcome.warnings) console.log(`warning: ${warning}`)

    console.log('findings:')
    outcome.candidates.forEach((candidate, index) => {
      console.log(
        `  ${index + 1}. [${candidate.sourceRecordId ?? 'no id'}] ${candidate.sourceTitle}` +
          `\n     published ${candidate.sourcePublicationDate ?? 'unknown'} · buyer ${
            candidate.sourceOrganization ?? 'unknown'
          } · country ${candidate.sourceCountry ?? 'unknown'} · raw type ${candidate.sourceRawType ?? 'unknown'}` +
          `\n     ${candidate.sourceUrl}`,
      )
    })

    console.log('')
    console.log('NO VAULT WRITE: this run produced raw candidates only.')
    console.log('Next steps remain Discovery → Candidate → Human Review; nothing was approved or filed.')
  }

  void run()
}

main()
