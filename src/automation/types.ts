/**
 * Phase B automation contracts — pure, side-effect-free type vocabulary.
 *
 * These types mirror the locked Phase A architecture (vault:
 * `08 - Documentation/Automation Phase A Architecture.md`). No I/O, no network,
 * no vault access: this module is data-only and has zero imports, so the rest of
 * the framework can never depend on a vault writer by importing a type.
 */

export const ACCESS_STATES: readonly string[] = ['AVAILABLE', 'RESTRICTED', 'UNAVAILABLE', 'UNKNOWN']
export type AccessState = 'AVAILABLE' | 'RESTRICTED' | 'UNAVAILABLE' | 'UNKNOWN'

export const DISCOVERY_DOMAINS: readonly string[] = ['funding', 'procurement']
export type DiscoveryDomain = 'funding' | 'procurement'

export const SOURCE_APPLICABILITY: readonly string[] = ['funding', 'procurement', 'both']
export type SourceApplicability = 'funding' | 'procurement' | 'both'

export const DISCOVERY_CAPABILITIES: readonly string[] = ['listing_search', 'detail_only', 'feed', 'none']
export type DiscoveryCapability = 'listing_search' | 'detail_only' | 'feed' | 'none'

/**
 * Locked Phase A execution-state vocabulary (Architecture §16 / Phase B brief §6).
 * NOT_RUN and READY are pre-execution; the rest are terminal for a run.
 */
export const EXECUTION_STATES: readonly string[] = [
  'NOT_RUN',
  'READY',
  'BLOCKED',
  'SUCCESS',
  'PARTIAL',
  'FAILED',
]
export type ExecutionState = 'NOT_RUN' | 'READY' | 'BLOCKED' | 'SUCCESS' | 'PARTIAL' | 'FAILED'

export const TERMINAL_EXECUTION_STATES: readonly ExecutionState[] = ['BLOCKED', 'SUCCESS', 'PARTIAL', 'FAILED']

export function isExecutionState(value: string): value is ExecutionState {
  return (EXECUTION_STATES as readonly string[]).includes(value)
}

export function isTerminalExecutionState(state: ExecutionState): boolean {
  return (TERMINAL_EXECUTION_STATES as readonly ExecutionState[]).includes(state)
}

export const EXECUTION_ERROR_CODES: readonly string[] = [
  'invalid_request',
  'missing_field',
  'unknown_source',
  'domain_mismatch',
  'source_blocked',
  'adapter_not_available',
  'adapter_error',
  'item_error',
]
export type ExecutionErrorCode =
  | 'invalid_request'
  | 'missing_field'
  | 'unknown_source'
  | 'domain_mismatch'
  | 'source_blocked'
  | 'adapter_not_available'
  | 'adapter_error'
  | 'item_error'

export interface ExecutionError {
  code: ExecutionErrorCode
  message: string
  sourceId?: string
  itemIndex?: number
}

/** What was observed about one raw listing. Missing source values stay missing. */
export interface RawResultProvenance {
  sourceId: string
  sourceUrl: string
  sourceRecordId: string | null
  observedAt: string
  queryTerm: string | null
}

/**
 * Intermediate raw result contract. Preserves source-originated information
 * without pretending it is normalized. Missing values remain `null`; nothing is
 * fabricated (Architecture §9, §10).
 */
export interface RawResult {
  sourceRecordId: string | null
  sourceUrl: string
  title: string
  description: string | null
  publicationDate: string | null
  deadline: string | null
  issuingOrganization: string | null
  country: string | null
  rawType: string | null
  /**
   * Phase 19A: the source-published lifecycle status when the source defines
   * one (e.g. Grants.gov `oppStatus`). `null`/absent for sources that publish no
   * status (USAspending, TED, fixtures). It records what the source said; it is
   * NOT an "is open" verdict and must not be used as one on its own.
   */
  sourceStatus?: string | null
  rawPayload: string
  rawProvenance: RawResultProvenance
}

/**
 * Enough provenance to answer the nine Phase A questions: which source, which
 * source URL, which adapter, which discovery run, which company, which discovery
 * profile, when obtained, what access state, what source record was observed.
 */
export interface ResultProvenance {
  runId: string | null
  companyId: string | null
  discoveryProfileId: string | null
  sourceId: string | null
  sourceName: string | null
  sourceUrl: string | null
  adapterType: string | null
  domain: DiscoveryDomain | null
  accessState: AccessState | null
  requestedAt: string | null
  observedAt: string
}

/**
 * The adapter result envelope. `status` is one of the six locked execution
 * states. A non-AVAILABLE source or an invalid request is BLOCKED; blocked and
 * failed runs never carry fabricated results.
 */
export interface AdapterResult {
  status: ExecutionState
  sourceId: string | null
  adapterType: string | null
  runId: string | null
  domain: DiscoveryDomain | null
  accessState: AccessState | null
  requestedAt: string | null
  observedAt: string
  blockedReason: string | null
  results: readonly RawResult[]
  errors: readonly ExecutionError[]
  warnings: readonly string[]
  provenance: ResultProvenance
}