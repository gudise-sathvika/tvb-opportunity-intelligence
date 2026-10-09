/**
 * Candidate transformation (Phase C brief §5): the step that turns a sealed
 * AdapterResult into a set of NEW discovery candidates, one per raw listing.
 *
 * Error handling is strict and mirrors the adapter envelope:
 *  - BLOCKED run   → no candidates, reason preserved
 *  - FAILED run    → no candidates, errors preserved
 *  - SUCCESS empty → a valid NO_RESULTS signal (never confused with a failure)
 *  - PARTIAL run   → candidates for every surviving item, per-item errors kept
 *  - SUCCESS       → a candidate per raw result
 *
 * Candidates are created with NEW status and no stage metadata other than a
 * provenance stageHistory of ['transform']. Nothing is guessed: fields that a
 * source left null stay null.
 */

import type { AdapterResult, ExecutionError, RawResult } from './types'
import { candidateIdFor, deepFreeze, type DiscoveryCandidate } from './candidate'

export type TransformKind = 'success' | 'partial' | 'empty' | 'blocked' | 'failed'

export interface TransformOutcome {
  readonly kind: TransformKind
  readonly candidates: readonly DiscoveryCandidate[]
  readonly errors: readonly string[]
}

function errorToString(error: ExecutionError): string {
  const where = error.itemIndex !== undefined && error.itemIndex !== null ? ` (item ${error.itemIndex})` : ''
  return `${error.code}${where}: ${error.message}`
}

export function executionErrorsToString(errors: readonly ExecutionError[]): readonly string[] {
  return errors.map(errorToString)
}

/**
 * Builds one NEW candidate from one raw listing. The domain comes from the
 * adapter envelope (which the discovery runner seals to the request), so a
 * raw result can never declare its own domain here.
 */
export function candidateFromRawResult(result: AdapterResult, raw: RawResult): DiscoveryCandidate {
  if (result.domain === null) {
    throw new Error('cannot create a discovery candidate without an adapter-result domain')
  }

  const p = result.provenance
  const rp = raw.rawProvenance
  const sourceId = result.sourceId ?? rp.sourceId

  const candidate: DiscoveryCandidate = {
    candidateId: candidateIdFor({
      sourceId,
      sourceRecordId: raw.sourceRecordId,
      sourceUrl: raw.sourceUrl,
      rawPayload: raw.rawPayload,
    }),
    discoveryRunId: p.runId ?? '',
    companyId: p.companyId ?? '',
    discoveryProfileId: p.discoveryProfileId ?? '',
    sourceId,
    sourceRecordId: raw.sourceRecordId,
    sourceUrl: raw.sourceUrl,
    sourceTitle: raw.title,
    sourceSummary: raw.description,
    sourcePublicationDate: raw.publicationDate,
    sourceDeadline: raw.deadline,
    sourceOrganization: raw.issuingOrganization,
    sourceCountry: raw.country,
    sourceRawType: raw.rawType,
    sourceStatus: raw.sourceStatus ?? null,
    domain: result.domain,
    candidateType: 'opportunity',
    candidateStatus: 'NEW',
    provenance: {
      runId: p.runId ?? '',
      companyId: p.companyId ?? '',
      discoveryProfileId: p.discoveryProfileId ?? '',
      sourceId,
      sourceName: p.sourceName,
      sourceUrl: raw.sourceUrl,
      sourceRecordId: raw.sourceRecordId,
      adapterType: p.adapterType,
      domain: result.domain,
      accessState: p.accessState,
      queryTerm: rp.queryTerm,
      requestedAt: p.requestedAt ?? '',
      observedAt: rp.observedAt,
      stageHistory: ['transform'],
    },
    normalization: null,
    classification: null,
    duplicate: null,
  }

  return deepFreeze(candidate)
}

/**
 * Transforms a sealed AdapterResult into candidates. BLOCKED and FAILED runs
 * produce zero candidates because a blocked or failed run has no evidence to
 * turn into a candidate.
 */
export function transformAdapterResult(result: AdapterResult): TransformOutcome {
  if (result.status === 'BLOCKED') {
    return deepFreeze({
      kind: 'blocked' as const,
      candidates: [],
      errors: deepFreeze([
        ...(result.blockedReason !== null ? [`blocked: ${result.blockedReason}`] : []),
        ...executionErrorsToString(result.errors),
      ]),
    })
  }

  if (result.status === 'FAILED') {
    return deepFreeze({
      kind: 'failed' as const,
      candidates: [],
      errors: deepFreeze(executionErrorsToString(result.errors)),
    })
  }

  if (result.results.length === 0) {
    return deepFreeze({
      kind: result.status === 'PARTIAL' ? ('failed' as const) : ('empty' as const),
      candidates: [],
      errors: deepFreeze(executionErrorsToString(result.errors)),
    })
  }

  const candidates = deepFreeze(result.results.map((raw) => candidateFromRawResult(result, raw)))

  return deepFreeze({
    kind: result.status === 'PARTIAL' ? ('partial' as const) : ('success' as const),
    candidates,
    errors: deepFreeze(executionErrorsToString(result.errors)),
  })
}