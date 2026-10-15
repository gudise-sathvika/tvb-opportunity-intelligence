/**
 * Phase 06 live match check — browser-side, read-only, non-persistent.
 *
 * One repeatable workflow that (1) searches the official GLEIF LEI registry
 * through the same-origin gleif-bridge and admits only ACTIVE/ISSUED records
 * as verified company profiles, (2) replays one broad Grants.gov search and
 * one broad FTS search through the real adapters + pipeline + shared
 * actionability gate, and (3) evaluates every verified company against every
 * actionable opportunity with the existing pure engines (MATCH-RULES-v1 for
 * funding, PMATCH-RULES-v1 for procurement).
 *
 * Nothing here writes anywhere: no vault, no snapshot, no review store. The
 * caller (currently a Match Review panel) holds the returned proposals in
 * component state for inspection. Failures at any step are reported as
 * errors, never converted into empty successes or filler matches.
 *
 * Company attributes the source does not publish (industry, description,
 * capabilities) stay unknown — the engines report them as missing evidence,
 * and country compatibility or keyword overlap alone never yields an
 * eligibility claim.
 */

import type { DiscoveryCandidate } from '../automation/candidate'
import { candidateToVerifiedOpportunity } from '../automation/opportunity-match-input'
import { assembleMatchProposals } from '../automation/match-assembly'
import type { MatchProposal } from '../automation/match-proposal'
import {
  proposeProcurementMatches,
} from '../automation/procurement-proposal'
import type {
  ProcurementCompanyRecord,
  ProcurementMatchProposal,
  ProcurementSourceRecord,
} from '../automation/procurement-proposal'
import type { VerifiedCompanyProfile } from '../automation/company-profile'
import { mapGleifSearchResponse } from '../automation/gleif-company-discovery'
import type { GleifRejection } from '../automation/gleif-company-discovery'
import { createGrantsGovAdapter } from '../automation/grantsgov-adapter'
import { createFtsAdapter } from '../automation/fts-adapter'
import { createDiscoveryRequest } from '../automation/request'
import { gateDiscovery } from '../automation/discovery-run'
import { runCandidatePipeline } from '../automation/pipeline'
import { classifyOpportunityState, partitionByActionability } from '../automation/opportunity-status'
import { DEFAULT_SOURCE_REGISTRY, FTS_SOURCE_ID, GRANTS_GOV_SOURCE_ID } from '../automation/registry'
import { tedFtsLiveRegistry } from './live-discovery'
import { GRANTS_GOV_BRIDGE_SEARCH_PATH } from './grantsgov-bridge/contract'
import type { GrantsGovBridgeSearchRequest, GrantsGovBridgeSearchResponse } from './grantsgov-bridge/contract'
import { FTS_BRIDGE_SEARCH_PATH } from './fts-bridge/contract'
import type { FtsBridgeSearchRequest, FtsBridgeSearchResponse } from './fts-bridge/contract'
import { GLEIF_BRIDGE_SEARCH_PATH } from './gleif-bridge/contract'
import type { GleifBridgeSearchRequest, GleifBridgeSearchResponse } from './gleif-bridge/contract'
import { SEC_BRIDGE_ENRICH_PATH } from './sec-bridge/contract'
import type { SecBridgeEnrichRequest, SecBridgeEnrichResponse } from './sec-bridge/contract'
import { applyEnrichment, findSecTickerCandidate, mapSecSubmissions } from '../automation/company-enrichment'
import type { CompanyEnrichment } from '../automation/company-enrichment'
import { resolveConfirmedIdentities } from '../automation/company-identity'

export const LIVE_MATCH_RUN_ID = 'RUN-LIVE-MATCH'
export const LIVE_MATCH_POOL_COMPANY_ID = 'RUN'
export const LIVE_MATCH_DEFAULT_OPP_LIMIT = 5
export const LIVE_MATCH_DEFAULT_COMPANY_LIMIT = 5
/** Phase 08: at most this many companies are enriched per check (rate respect). */
export const LIVE_MATCH_DEFAULT_MAX_ENRICHED = 3

export type LiveMatchBridgeClient<Req, Res> = (request: Req) => Promise<Res>

export interface LiveMatchClients {
  readonly gleif: LiveMatchBridgeClient<GleifBridgeSearchRequest, GleifBridgeSearchResponse>
  readonly grantsgov: LiveMatchBridgeClient<GrantsGovBridgeSearchRequest, GrantsGovBridgeSearchResponse>
  readonly fts: LiveMatchBridgeClient<FtsBridgeSearchRequest, FtsBridgeSearchResponse>
  /** Phase 08, optional: SEC enrichment bridge. Absent = no enrichment attempted. */
  readonly sec?: LiveMatchBridgeClient<SecBridgeEnrichRequest & { cik?: string }, SecBridgeEnrichResponse>
}

function postJson<Req, Res>(path: string): LiveMatchBridgeClient<Req, Res> {
  return async (request: Req): Promise<Res> => {
    const response = await globalThis.fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    return (await response.json()) as Res
  }
}

export function defaultLiveMatchClients(): LiveMatchClients {
  return {
    gleif: postJson(GLEIF_BRIDGE_SEARCH_PATH),
    grantsgov: postJson(GRANTS_GOV_BRIDGE_SEARCH_PATH),
    fts: postJson(FTS_BRIDGE_SEARCH_PATH),
    sec: postJson(SEC_BRIDGE_ENRICH_PATH),
  }
}

export interface LiveMatchCheckInput {
  readonly companyQuery: string
  readonly oppLimit?: number
  readonly companyLimit?: number
  readonly requestedAt?: string
  /**
   * Phase 12A user-confirmed legal-entity ids (e.g. `LEI-…`). GLEIF hits are
   * search results, never proof of the intended company — only confirmed ids
   * are evaluated. Absent or empty means "evaluate every verified hit" (the
   * pre-12A behavior, preserved for backward compatibility).
   */
  readonly confirmedCompanyIds?: readonly string[]
  /**
   * Phase 08, default false: when true (and a `sec` client is present),
   * verified profiles are enriched from SEC EDGAR before matching. Existing
   * callers omit it and observe byte-identical behavior.
   */
  readonly enrich?: boolean
  readonly maxEnrichedCompanies?: number
}

export interface CompanyEnrichmentOutcome {
  readonly companyId: string
  readonly enrichment: CompanyEnrichment
}

/** Phase 12: an excluded opportunity with its classifier reason, for honest display. */
export interface ExcludedOpportunityDetail {
  readonly recordId: string
  readonly title: string
  readonly state: string
  readonly reason: string
}

export interface LiveMatchCheckResult {
  readonly requestedAt: string
  readonly companies: readonly VerifiedCompanyProfile[]
  readonly gleifRejected: readonly GleifRejection[]
  /** Phase 15C: raw GLEIF record count (0 = valid zero-hit search when no errors). */
  readonly gleifRawRecords: number
  /** Phase 08: one entry per enrichment attempted (empty when enrichment off). */
  readonly enrichments: readonly CompanyEnrichmentOutcome[]
  /**
   * Phase 12A: verified GLEIF hits the user did NOT confirm as the intended
   * legal entity. Listed for transparency, never evaluated, never matched.
   */
  readonly unconfirmedCompanies: readonly VerifiedCompanyProfile[]
  /** Phase 12: why gated-out records were excluded (never actionable). */
  readonly fundingExcludedDetails: readonly ExcludedOpportunityDetail[]
  readonly procurementExcludedDetails: readonly ExcludedOpportunityDetail[]
  readonly fundingEvaluated: number
  readonly fundingActionable: readonly DiscoveryCandidate[]
  readonly fundingExcluded: number
  readonly procurementEvaluated: number
  readonly procurementActionable: readonly DiscoveryCandidate[]
  readonly procurementExcluded: number
  readonly fundingProposals: readonly MatchProposal[]
  readonly procurementProposals: readonly ProcurementMatchProposal[]
  readonly errors: readonly string[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function replayTransport(response: GrantsGovBridgeSearchResponse | FtsBridgeSearchResponse) {
  return () => {
    if (!response.ok) {
      throw new Error(response.errors.map((error) => error.message).join('; '))
    }
    return { status: response.status, body: response.body as string }
  }
}

function toProcurementCompany(profile: VerifiedCompanyProfile): ProcurementCompanyRecord {
  const capabilities: string[] = [
    ...(profile.technologyFocus ?? []),
    ...(profile.projectFocus ?? []),
    ...(profile.certifications ?? []),
  ]
  return {
    companyId: profile.companyId,
    name: profile.name,
    country: profile.country ?? null,
    industries: profile.industry ?? null,
    description: profile.businessDescription ?? null,
    // Flattened only from present verified fields; empty when the source
    // publishes none (GLEIF) — the engine reports capability-overlap missing.
    capabilities: capabilities.length > 0 ? capabilities : null,
  }
}

function toProcurementNotice(candidate: DiscoveryCandidate): ProcurementSourceRecord {
  return {
    recordId: candidate.sourceRecordId ?? candidate.candidateId,
    recordType: 'notice',
    name: candidate.sourceTitle,
    country: candidate.sourceCountry,
    industries: null,
    description: candidate.sourceSummary,
  }
}

/**
 * Phase 08 additive enrichment. When disabled (default) or when no SEC client
 * is present, profiles pass through untouched. Otherwise the first N verified
 * companies are enriched from SEC EDGAR; any source failure keeps the verified
 * profile as-is and records an error — enrichment never erases, rewrites, or
 * blocks matching.
 */
async function maybeEnrichCompanies(
  companies: readonly VerifiedCompanyProfile[],
  options: { enrich: boolean; maxEnrichedCompanies: number },
  sec: LiveMatchClients['sec'],
  requestedAt: string,
  errors: string[],
): Promise<{ enrichedCompanies: readonly VerifiedCompanyProfile[]; enrichments: readonly CompanyEnrichmentOutcome[] }> {
  if (!options.enrich || sec === undefined) return { enrichedCompanies: companies, enrichments: [] }
  const enrichedCompanies: VerifiedCompanyProfile[] = []
  const enrichments: CompanyEnrichmentOutcome[] = []
  for (const profile of companies.slice(0, Math.max(0, options.maxEnrichedCompanies))) {
    try {
      const tickersAnswer = await sec({
        runId: LIVE_MATCH_RUN_ID,
        companyId: LIVE_MATCH_POOL_COMPANY_ID,
        legalName: profile.name,
        requestedAt,
      })
      if (!tickersAnswer.ok) {
        errors.push(`SEC enrichment for ${profile.companyId} failed: ${tickersAnswer.errors.map((e) => e.message).join('; ')}`)
        enrichedCompanies.push(profile)
        continue
      }
      let tickersJson: unknown = null
      try {
        tickersJson = JSON.parse(tickersAnswer.body.tickers)
      } catch {
        errors.push(`SEC enrichment for ${profile.companyId} failed: ticker file is not valid JSON`)
        enrichedCompanies.push(profile)
        continue
      }
      const candidate = findSecTickerCandidate(tickersJson, profile.name)
      if (candidate === null) {
        const none: CompanyEnrichment = {
          status: 'none', industry: null, website: null, locations: null, organizationType: null,
          capabilities: null, evidence: [], checkedAt: requestedAt,
          notes: ['no EDGAR filer matched the legal name under the conservative token rule'],
        }
        enrichments.push({ companyId: profile.companyId, enrichment: none })
        enrichedCompanies.push(profile)
        continue
      }
      const subAnswer = await sec({
        runId: LIVE_MATCH_RUN_ID,
        companyId: LIVE_MATCH_POOL_COMPANY_ID,
        legalName: profile.name,
        cik: candidate.cik,
        requestedAt,
      })
      if (!subAnswer.ok || subAnswer.body.submissions === null) {
        errors.push(
          `SEC enrichment for ${profile.companyId} failed: ${!subAnswer.ok ? subAnswer.errors.map((e) => e.message).join('; ') : 'no submissions document returned'}`,
        )
        enrichedCompanies.push(profile)
        continue
      }
      let submissions: unknown = null
      try {
        submissions = JSON.parse(subAnswer.body.submissions)
      } catch {
        errors.push(`SEC enrichment for ${profile.companyId} failed: submissions document is not valid JSON`)
        enrichedCompanies.push(profile)
        continue
      }
      const enrichment = mapSecSubmissions(submissions, candidate.cik, requestedAt)
      enrichments.push({ companyId: profile.companyId, enrichment })
      enrichedCompanies.push(applyEnrichment(profile, enrichment).profile)
    } catch (error) {
      errors.push(`SEC enrichment for ${profile.companyId} failed: ${error instanceof Error ? error.message : String(error)}`)
      enrichedCompanies.push(profile)
    }
  }
  for (const profile of companies.slice(Math.max(0, options.maxEnrichedCompanies))) enrichedCompanies.push(profile)
  return { enrichedCompanies, enrichments }
}

/**
 * Runs the full live match check. Every external call is one bounded
 * read-only bridge request; every record flows through the real
 * adapter → pipeline → gate path before any matching is attempted.
 */
export async function runLiveMatchCheck(
  input: LiveMatchCheckInput,
  clients: LiveMatchClients = defaultLiveMatchClients(),
): Promise<LiveMatchCheckResult> {
  const requestedAt = input.requestedAt ?? nowIso()
  const oppLimit = input.oppLimit ?? LIVE_MATCH_DEFAULT_OPP_LIMIT
  const companyLimit = input.companyLimit ?? LIVE_MATCH_DEFAULT_COMPANY_LIMIT
  const query = input.companyQuery.trim()
  const errors: string[] = []

  let companies: readonly VerifiedCompanyProfile[] = []
  let gleifRejected: readonly GleifRejection[] = []
  let gleifRawRecords = 0
  if (query === '') {
    errors.push('a company legal-name query is required; directory names are never verified without a source lookup')
  } else {
    try {
      const answer = await clients.gleif({
        runId: LIVE_MATCH_RUN_ID,
        companyId: LIVE_MATCH_POOL_COMPANY_ID,
        query,
        limit: companyLimit,
        requestedAt,
      })
      if (!answer.ok) {
        errors.push(`GLEIF search failed: ${answer.errors.map((e) => e.message).join('; ')}`)
      } else {
        let parsed: unknown
        try {
          parsed = JSON.parse(answer.body)
        } catch {
          errors.push('GLEIF search returned a body that is not valid JSON')
          parsed = null
        }
        if (parsed !== null) {
          const mapped = mapGleifSearchResponse(parsed, requestedAt.slice(0, 10))
          companies = mapped.profiles
          gleifRejected = mapped.rejected
          gleifRawRecords = mapped.totalRecords
        }
      }
    } catch (error) {
      errors.push(`GLEIF search failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let fundingActionable: readonly DiscoveryCandidate[] = []
  let fundingEvaluated = 0
  let fundingExcluded = 0
  let fundingExcludedDetails: readonly ExcludedOpportunityDetail[] = []
  try {
    const request = createDiscoveryRequest({
      runId: `${LIVE_MATCH_RUN_ID}-G`,
      companyId: LIVE_MATCH_POOL_COMPANY_ID,
      discoveryProfileId: 'DP-LIVE-MATCH',
      sourceId: GRANTS_GOV_SOURCE_ID,
      domain: 'funding',
      queryTerms: ['*'],
      exclusions: [],
      requestedAt,
      keyword: '',
      adapterConfig: { rows: oppLimit, broadSearch: true, oppStatuses: 'posted' },
    })
    const answer = await clients.grantsgov({
      runId: LIVE_MATCH_RUN_ID,
      companyId: LIVE_MATCH_POOL_COMPANY_ID,
      keyword: '',
      oppStatuses: 'posted',
      limit: oppLimit,
      requestedAt,
    })
    const adapter = createGrantsGovAdapter({ transport: replayTransport(answer), registry: DEFAULT_SOURCE_REGISTRY })
    const deps = { registry: DEFAULT_SOURCE_REGISTRY, adapter }
    const gate = gateDiscovery(request, deps)
    if (gate.status === 'BLOCKED') {
      errors.push(`Grants.gov gate blocked: ${gate.result.blockedReason}`)
    } else {
      await adapter.retrieve(request)
      const outcome = runCandidatePipeline(request, deps)
      fundingEvaluated = outcome.counts.candidatesCreated
      const part = partitionByActionability(outcome.candidates, requestedAt)
      fundingActionable = part.actionable
      fundingExcluded = part.excluded.length
      fundingExcludedDetails = part.excluded.map((candidate) => {
        const verdict = classifyOpportunityState(candidate, requestedAt)
        return {
          recordId: candidate.sourceRecordId ?? candidate.candidateId,
          title: candidate.sourceTitle,
          state: verdict.state,
          reason: verdict.reason,
        }
      })
      for (const message of outcome.errors) errors.push(`Grants.gov: ${message}`)
    }
  } catch (error) {
    errors.push(`Grants.gov search failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  let procurementActionable: readonly DiscoveryCandidate[] = []
  let procurementEvaluated = 0
  let procurementExcluded = 0
  let procurementExcludedDetails: readonly ExcludedOpportunityDetail[] = []
  try {
    const registry = tedFtsLiveRegistry()
    const request = createDiscoveryRequest({
      runId: `${LIVE_MATCH_RUN_ID}-F`,
      companyId: LIVE_MATCH_POOL_COMPANY_ID,
      discoveryProfileId: 'DP-LIVE-MATCH',
      sourceId: FTS_SOURCE_ID,
      domain: 'procurement',
      queryTerms: ['*'],
      exclusions: [],
      requestedAt,
      keyword: '',
      adapterConfig: { limit: oppLimit },
    })
    const answer = await clients.fts({
      runId: LIVE_MATCH_RUN_ID,
      companyId: LIVE_MATCH_POOL_COMPANY_ID,
      limit: oppLimit,
      requestedAt,
    })
    const adapter = createFtsAdapter({ transport: replayTransport(answer), registry })
    const deps = { registry, adapter }
    const gate = gateDiscovery(request, deps)
    if (gate.status === 'BLOCKED') {
      errors.push(`Find a Tender gate blocked: ${gate.result.blockedReason}`)
    } else {
      await adapter.retrieve(request)
      const outcome = runCandidatePipeline(request, deps)
      procurementEvaluated = outcome.counts.candidatesCreated
      const part = partitionByActionability(outcome.candidates, requestedAt)
      procurementActionable = part.actionable
      procurementExcluded = part.excluded.length
      procurementExcludedDetails = part.excluded.map((candidate) => {
        const verdict = classifyOpportunityState(candidate, requestedAt)
        return {
          recordId: candidate.sourceRecordId ?? candidate.candidateId,
          title: candidate.sourceTitle,
          state: verdict.state,
          reason: verdict.reason,
        }
      })
      for (const message of outcome.errors) errors.push(`Find a Tender: ${message}`)
    }
  } catch (error) {
    errors.push(`Find a Tender search failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Phase 12A/16: a GLEIF hit is a search result, not the intended company
  // until the user confirms it (see `resolveConfirmedIdentities`). Unconfirmed
  // verified hits are reported, never run.
  const resolved = resolveConfirmedIdentities(
    companies.map((profile) => profile.companyId),
    input.confirmedCompanyIds,
  )
  const confirmedIds = new Set(resolved.confirmed)
  const confirmed = companies.filter((profile) => confirmedIds.has(profile.companyId))
  const unconfirmedCompanies = companies.filter((profile) => !confirmedIds.has(profile.companyId))

  const { enrichedCompanies, enrichments } = await maybeEnrichCompanies(
    confirmed,
    { enrich: input.enrich ?? false, maxEnrichedCompanies: input.maxEnrichedCompanies ?? LIVE_MATCH_DEFAULT_MAX_ENRICHED },
    clients.sec,
    requestedAt,
    errors,
  )

  const fundingProposals =
    enrichedCompanies.length > 0 && fundingActionable.length > 0
      ? assembleMatchProposals({
          companies: enrichedCompanies,
          opportunities: fundingActionable.map((candidate) => candidateToVerifiedOpportunity(candidate, requestedAt)),
        }).proposals
      : []

  const procurementCompanies = enrichedCompanies.map(toProcurementCompany)
  const procurementProposals: ProcurementMatchProposal[] = []
  for (const notice of procurementActionable) {
    procurementProposals.push(...proposeProcurementMatches(toProcurementNotice(notice), procurementCompanies))
  }

  return {
    requestedAt,
    companies: enrichedCompanies,
    gleifRejected,
    gleifRawRecords,
    enrichments,
    unconfirmedCompanies,
    fundingEvaluated,
    fundingActionable,
    fundingExcluded,
    fundingExcludedDetails,
    procurementEvaluated,
    procurementActionable,
    procurementExcluded,
    procurementExcludedDetails,
    fundingProposals,
    procurementProposals,
    errors,
  }
}
