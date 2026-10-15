/**
 * Phase 02 (extended) — bounded, read-only end-to-end verification of the REAL
 * path: official opportunity discovery → shared actionability gate → verified
 * company discovery from GLEIF → guarded match assembly.
 *
 * It performs a small, fixed number of read-only requests:
 *   1. ONE Grants.gov search (broad, limit 5);
 *   2. ONE GLEIF LEI search (by legal name, page size 5).
 *
 * It PRINTS what it found and writes nothing: no vault file, no record, no
 * snapshot. Every discovered company is a genuine LEI record (ACTIVE/ISSUED);
 * every opportunity is a live source record classified by the shared gate. The
 * proposal evidence is exactly what the pure match engine produced — nothing is
 * embellished.
 *
 * Run with:  npx tsx src/live-source/verify-real-match.ts
 */

import { DEFAULT_SOURCE_REGISTRY, GRANTS_GOV_SOURCE_ID } from '../automation/registry'
import { createGrantsGovAdapter } from '../automation/grantsgov-adapter'
import { createDiscoveryRequest } from '../automation/request'
import { gateDiscovery } from '../automation/discovery-run'
import { runCandidatePipeline } from '../automation/pipeline'
import { partitionByActionability } from '../automation/opportunity-status'
import { candidateToVerifiedOpportunity } from '../automation/opportunity-match-input'
import { assembleMatchProposals } from '../automation/match-assembly'
import type { VerifiedOpportunityRecord } from '../automation/match-assembly'
import type { VerifiedCompanyProfile } from '../automation/company-profile'
import { GLEIF_API_HOST, mapGleifSearchResponse } from '../automation/gleif-company-discovery'
import { createFetchTransport } from './fetch-transport'

const OPP_LIMIT = 5
const COMPANY_LIMIT = 5
const COMPANY_NAME = process.argv[2] ?? 'Tesla'

async function discoverOpenOpportunities(now: string): Promise<readonly VerifiedOpportunityRecord[]> {
  const request = createDiscoveryRequest({
    runId: 'RUN-REAL-MATCH-OPP',
    companyId: 'COM-LIVE-VERIFY',
    discoveryProfileId: 'DP-LIVE-VERIFY-only',
    sourceId: GRANTS_GOV_SOURCE_ID,
    domain: 'funding',
    queryTerms: ['*'],
    exclusions: [],
    requestedAt: now,
    keyword: '',
    adapterConfig: { rows: OPP_LIMIT, broadSearch: true, oppStatuses: 'posted' },
  })
  const adapter = createGrantsGovAdapter({ transport: createFetchTransport(), registry: DEFAULT_SOURCE_REGISTRY })
  const deps = { registry: DEFAULT_SOURCE_REGISTRY, adapter }
  const gate = gateDiscovery(request, deps)
  if (gate.status === 'BLOCKED') {
    console.log(`  GATE BLOCKED: ${gate.result.blockedReason}`)
    return []
  }
  await adapter.retrieve(request)
  const outcome = runCandidatePipeline(request, deps)
  const { actionable, excluded } = partitionByActionability(outcome.candidates, request.requestedAt)
  console.log(
    `  Grants.gov: received ${outcome.counts.candidatesReceived} · distinct ${outcome.counts.distinct} · ` +
      `actionable-open ${actionable.length} · excluded ${excluded.length}`,
  )
  for (const candidate of actionable) {
    console.log(`    - [${candidate.sourceRecordId}] ${candidate.sourceTitle}`)
    console.log(`      deadline ${candidate.sourceDeadline} · ${candidate.sourceUrl}`)
  }
  return actionable.map((candidate) => candidateToVerifiedOpportunity(candidate, request.requestedAt))
}

async function discoverCompanies(now: string): Promise<readonly VerifiedCompanyProfile[]> {
  const url =
    `https://${GLEIF_API_HOST}/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(COMPANY_NAME)}` +
    `&page[size]=${COMPANY_LIMIT}`
  const response = await fetch(url, { headers: { Accept: 'application/vnd.api+json' } })
  if (!response.ok) {
    console.log(`  GLEIF: HTTP ${response.status} — reported as a failure, not an empty success`)
    return []
  }
  const body: unknown = await response.json()
  const { profiles, rejected } = mapGleifSearchResponse(body, now.slice(0, 10))
  console.log(`  GLEIF: ${profiles.length} verified (ACTIVE/ISSUED) · ${rejected.length} rejected`)
  for (const profile of profiles) {
    console.log(`    - ${profile.name} · ${profile.companyId} · country ${profile.country ?? 'unknown'}`)
    console.log(`      ${profile.provenance.source}`)
  }
  return profiles
}

function main(): void {
  const now = new Date().toISOString()
  console.log('Phase 02 real end-to-end verification (read-only, writes nothing)')
  console.log(`requestedAt: ${now}`)
  console.log('')

  const run = async (): Promise<void> => {
    console.log('[1] Live opportunity discovery (Grants.gov, broad, limit 5):')
    const opportunities = await discoverOpenOpportunities(now)
    console.log('')
    console.log(`[2] Live company discovery (GLEIF LEI registry, name "${COMPANY_NAME}", limit 5):`)
    const companies = await discoverCompanies(now)
    console.log('')

    console.log('[3] Guarded match assembly (pure; verified-open opportunities × verified companies):')
    const result = assembleMatchProposals({ companies, opportunities })
    console.log(
      `  proposals ${result.proposals.length} · skipped companies ${result.skippedCompanies.length} · ` +
        `skipped opportunities ${result.skippedOpportunities.length}`,
    )
    for (const proposal of result.proposals) {
      console.log(`  PROPOSAL ${proposal.proposalId}`)
      console.log(`    company ${proposal.companyId} × opportunity ${proposal.sourceRecordId} → ${proposal.status}`)
      console.log(`    matched signals: ${proposal.matchedSignals.join(', ') || '(none)'}`)
      console.log(`    missing signals: ${proposal.missingSignals.join(', ') || '(none)'}`)
      for (const evidence of proposal.evidence) {
        console.log(`      [${evidence.outcome}] ${evidence.signal} — ${evidence.values.join(', ') || evidence.note}`)
      }
    }
    console.log('')
    console.log('NO VAULT WRITE: this run produced proposals only. A human review is still required before anything is created.')
  }

  void run()
}

main()
