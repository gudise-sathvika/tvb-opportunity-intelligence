/**
 * Phase 02 live verification — ONE bounded read-only search each against the
 * two sources promoted to AVAILABLE after observation: Grants.gov (grant
 * opportunities) and the EU Funding & Tenders Portal / SEDIA (grant topics and
 * cascade-funding calls).
 *
 * Each source is exercised through the ordinary discovery path: access gate →
 * retrieve (one request) → candidate pipeline (transform → normalize →
 * classify → dedup), then the SAME shared actionability classifier partitions
 * the results into actionable-open vs. excluded. The script PRINTS what it
 * found and writes nothing: no vault file, no record, no snapshot.
 *
 * Run with:  npx tsx src/live-source/verify-live-sources.ts
 *
 * It is intentionally not scheduled, not repeated, and not part of the app
 * bundle. Nothing here retries, bypasses access controls, or downloads
 * documents. Each call is limited (<= 5 records).
 */

import { DEFAULT_SOURCE_REGISTRY, EU_SEDIA_SOURCE_ID, GRANTS_GOV_SOURCE_ID } from '../automation/registry'
import { createGrantsGovAdapter } from '../automation/grantsgov-adapter'
import { createEuSediaAdapter } from '../automation/eu-sedia-adapter'
import { createDiscoveryRequest } from '../automation/request'
import { gateDiscovery } from '../automation/discovery-run'
import { runCandidatePipeline } from '../automation/pipeline'
import { partitionByActionability } from '../automation/opportunity-status'
import type { DiscoveryCandidate } from '../automation/candidate'
import { createFetchTransport } from './fetch-transport'

const LIMIT = 5

function report(label: string, sourceId: string, domain: 'funding' | 'procurement', adapterConfig: Record<string, unknown>): void {
  const requestedAt = new Date().toISOString()
  const request = createDiscoveryRequest({
    runId: `RUN-LIVE-VERIFY-${sourceId}`,
    companyId: 'COM-LIVE-VERIFY',
    discoveryProfileId: 'DP-LIVE-VERIFY-only',
    sourceId,
    domain,
    queryTerms: ['*'],
    exclusions: [],
    requestedAt,
    keyword: '',
    adapterConfig,
  })

  const adapter =
    sourceId === GRANTS_GOV_SOURCE_ID
      ? createGrantsGovAdapter({ transport: createFetchTransport(), registry: DEFAULT_SOURCE_REGISTRY })
      : createEuSediaAdapter({ transport: createFetchTransport(), registry: DEFAULT_SOURCE_REGISTRY })
  const deps = { registry: DEFAULT_SOURCE_REGISTRY, adapter }

  console.log('')
  console.log(`=== ${label} (${sourceId}) ===`)
  console.log(`requestedAt: ${requestedAt}`)
  console.log(`query:       bounded broad search, limit ${LIMIT}`)

  const gate = gateDiscovery(request, deps)
  if (gate.status === 'BLOCKED') {
    console.log(`GATE: BLOCKED — ${gate.result.blockedReason}`)
    return
  }
  console.log('GATE: READY (source access state AVAILABLE)')

  const run = async (): Promise<void> => {
    try {
      await adapter.retrieve(request)
    } catch (error) {
      console.log(`RETRIEVE FAILED (reported as failure, not an empty success): ${String(error)}`)
      return
    }
    const outcome = runCandidatePipeline(request, deps)
    const { actionable, excluded } = partitionByActionability(outcome.candidates, request.requestedAt)

    console.log(`outcome:     ${outcome.outcome}`)
    console.log(
      `counts:      received ${outcome.counts.candidatesReceived} · created ${outcome.counts.candidatesCreated} · ` +
        `normalized ${outcome.counts.normalized} · distinct ${outcome.counts.distinct} · duplicates ${outcome.counts.duplicates} · blocked ${outcome.counts.blocked}`,
    )
    console.log(`actionable:  ${actionable.length} open · excluded ${excluded.length} (preserved, never dropped)`)
    for (const error of outcome.errors) console.log(`error:   ${error}`)
    for (const warning of outcome.warnings) console.log(`warning: ${warning}`)

    const line = (candidate: DiscoveryCandidate, index: number): void => {
      console.log(
        `  ${index + 1}. [${candidate.sourceRecordId ?? 'no id'}] ${candidate.sourceTitle}` +
          `\n     deadline ${candidate.sourceDeadline ?? 'unknown'} · status ${candidate.sourceStatus ?? 'unknown'}` +
          `\n     ${candidate.sourceUrl}`,
      )
    }
    console.log('actionable-open:')
    actionable.forEach(line)
    console.log('excluded (first 5):')
    excluded.slice(0, 5).forEach(line)

    console.log('NO VAULT WRITE: raw candidates only. Nothing was approved or filed.')
  }

  void run()
}

function main(): void {
  console.log('Phase 02 live verification — promoted official sources')
  report('Grants.gov — US federal grant opportunities', GRANTS_GOV_SOURCE_ID, 'funding', {
    rows: LIMIT,
    broadSearch: true,
    oppStatuses: 'posted',
  })
  report('EU Funding & Tenders Portal (SEDIA) — grant topics & cascade funding', EU_SEDIA_SOURCE_ID, 'funding', {
    rows: LIMIT,
    broadSearch: true,
  })
}

main()
