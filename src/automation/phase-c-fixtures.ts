/**
 * Shared Phase C test fixtures — deterministic local data only.
 *
 * Everything here is synthetic and non-resolvable (fixture.invalid). No file
 * in this module performs I/O, so cross-source and GlobalTenders-STYLE tests
 * can fabricate AdapterResults and run them through buildPipelineResult with
 * zero network access.
 */

import type { AccessState, AdapterResult, ExecutionError, RawResult } from './types'
import type { DiscoveryRequest } from './request'
import { createDiscoveryRequest } from './request'
import { executedResult } from './adapter'

export interface MakeRawOptions {
  sourceUrl: string
  title: string
  sourceRecordId?: string | null
  description?: string | null
  publicationDate?: string | null
  deadline?: string | null
  issuingOrganization?: string | null
  country?: string | null
  rawType?: string | null
  rawPayload?: string
  sourceId?: string
  queryTerm?: string | null
  observedAt?: string
}

export function makeRaw(options: MakeRawOptions): RawResult {
  return {
    sourceRecordId: options.sourceRecordId ?? null,
    sourceUrl: options.sourceUrl,
    title: options.title,
    description: options.description ?? null,
    publicationDate: options.publicationDate ?? null,
    deadline: options.deadline ?? null,
    issuingOrganization: options.issuingOrganization ?? null,
    country: options.country ?? null,
    rawType: options.rawType ?? null,
    rawPayload: options.rawPayload ?? '{}',
    rawProvenance: {
      sourceId: options.sourceId ?? 'SU-FX-001',
      sourceUrl: options.sourceUrl,
      sourceRecordId: options.sourceRecordId ?? null,
      observedAt: options.observedAt ?? '2026-10-07T00:00:00.000Z',
      queryTerm: options.queryTerm ?? null,
    },
  }
}

export function fixtureRequest(overrides: Partial<DiscoveryRequest> = {}): DiscoveryRequest {
  return createDiscoveryRequest({
    runId: overrides.runId ?? 'RUN-PHASEC',
    companyId: overrides.companyId ?? 'COM-PHASEC',
    discoveryProfileId: overrides.discoveryProfileId ?? 'DP-PHASEC-v1',
    sourceId: overrides.sourceId ?? 'SU-FX-001',
    domain: overrides.domain ?? 'procurement',
    queryTerms: overrides.queryTerms ?? ['fixture search'],
    exclusions: overrides.exclusions ?? [],
    requestedAt: overrides.requestedAt ?? '2026-10-07T00:00:00.000Z',
    ...(overrides.adapterConfig !== undefined ? { adapterConfig: overrides.adapterConfig } : {}),
  })
}

export interface SyntheticAdapterOptions {
  request: DiscoveryRequest
  sourceName: string
  adapterType: string
  accessState?: AccessState
  results?: RawResult[]
  errors?: ExecutionError[]
  warnings?: string[]
}

/** Fabricated AdapterResult built through the Phase B envelope constructor. */
export function syntheticAdapterResult(options: SyntheticAdapterOptions): AdapterResult {
  return executedResult({
    request: options.request,
    sourceName: options.sourceName,
    adapterType: options.adapterType,
    accessState: options.accessState ?? 'AVAILABLE',
    results: options.results ?? [],
    errors: options.errors ?? [],
    warnings: options.warnings ?? [],
  })
}