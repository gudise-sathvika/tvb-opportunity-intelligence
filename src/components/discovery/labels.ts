/**
 * Discovery control panel vocabulary (Phase G brief §3–§8; Phase H §1–§5).
 *
 * Product terminology for the panel: funding opportunities are shown as
 * Grants, procurement opportunities as RFPs, and the run scenarios as Standard
 * / Source fails / Blocked source. Every status chip here maps to a locked
 * Phase C pipeline outcome — the UI invents no outcome of its own.
 */

import type {
  DiscoveryFixtureScenario,
  DiscoveryLocation,
  DiscoverySector,
} from '../../automation/discovery-fixture'
import type { NormalizationState } from '../../automation/candidate'
import type { CandidateState } from '../../automation/candidate'
import type { PipelineOutcome } from '../../automation/pipeline'
import type { DiscoveryDomain } from '../../automation/types'
import { DEFAULT_SOURCE_REGISTRY, FIXTURE_ADAPTER_TYPE } from '../../automation/registry'
import { companyNameFor } from '../review/labels'

/**
 * Phase U: whether the source behind a run result is a real, verified source
 * or a local deterministic fixture. Derived from the Source Registry only —
 * the UI never decides this itself.
 */
export type SourceKind = 'real' | 'fixture'

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  real: 'Real source',
  fixture: 'Fixture',
}

export function sourceKindFor(sourceId: string | null): SourceKind | null {
  if (sourceId === null || sourceId === '') return null
  const definition = DEFAULT_SOURCE_REGISTRY.get(sourceId)
  if (definition === undefined) return null
  return definition.adapterType === FIXTURE_ADAPTER_TYPE ? 'fixture' : 'real'
}

/** The two discovery modes. Grants (funding) and RFPs (procurement). */
export const DOMAIN_OPTIONS = [
  { key: 'funding', label: 'Grants' },
  { key: 'procurement', label: 'RFPs' },
] as const satisfies readonly { key: DiscoveryDomain; label: string }[]

export const DOMAIN_LABEL: Record<DiscoveryDomain, string> = {
  funding: 'Grants',
  procurement: 'RFPs',
}

/**
 * Phase H: the run summary names the procurement domain in the singular
 * ("Domain: RFP"), matching the founder's example, while radios and history
 * keep the plural mode label.
 */
export const DOMAIN_SUMMARY_LABEL: Record<DiscoveryDomain, string> = {
  funding: 'Grants',
  procurement: 'RFP',
}

/** Phase H: the founder's fixed sector list plus the unfiltered default. */
export const SECTOR_OPTIONS = [
  { key: 'all', label: 'All sectors' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'transportation', label: 'Transportation' },
  { key: 'construction', label: 'Construction' },
  { key: 'engineering', label: 'Engineering' },
  { key: 'technology', label: 'Technology' },
  { key: 'healthcare', label: 'Healthcare' },
  { key: 'energy', label: 'Energy' },
  { key: 'agriculture', label: 'Agriculture' },
  { key: 'other', label: 'Other' },
] as const satisfies readonly { key: DiscoverySector; label: string }[]

export const SECTOR_LABEL: Record<DiscoverySector, string> = {
  all: 'All sectors',
  infrastructure: 'Infrastructure',
  transportation: 'Transportation',
  construction: 'Construction',
  engineering: 'Engineering',
  technology: 'Technology',
  healthcare: 'Healthcare',
  energy: 'Energy',
  agriculture: 'Agriculture',
  other: 'Other',
}

/**
 * Phase H: the fallback location list from the brief. The fixture/demo data
 * provides no reliable location vocabulary of its own (fixture listings carry
 * country 'Wonderland' or nothing; the demo companies record India and the
 * USA), so the panel offers exactly these four.
 */
export const LOCATION_OPTIONS = [
  { key: 'all', label: 'All locations' },
  { key: 'usa', label: 'USA' },
  { key: 'india', label: 'India' },
  { key: 'other', label: 'Other' },
] as const satisfies readonly { key: DiscoveryLocation; label: string }[]

export const LOCATION_LABEL: Record<DiscoveryLocation, string> = {
  all: 'All locations',
  usa: 'USA',
  india: 'India',
  other: 'Other',
}

/**
 * Phase I: the user-facing kind of a classified candidate, derived from its
 * domain — never from the raw schema type strings, which stay internal.
 */
export const KIND_LABEL: Record<DiscoveryDomain, string> = {
  funding: 'Grant',
  procurement: 'RFP',
}

/** Phase I: human labels for candidate pipeline states (text, never colour-only). */
export const CANDIDATE_STATUS_LABEL: Record<CandidateState, string> = {
  NEW: 'New',
  NORMALIZED: 'Normalized',
  REVIEW: 'In review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  DUPLICATE: 'Duplicate',
  BLOCKED: 'Blocked',
}

/** Phase I: human labels for normalization states. */
export const NORMALIZATION_STATUS_LABEL: Record<NormalizationState, string> = {
  UNCHANGED: 'Unchanged',
  NORMALIZED: 'Normalized',
  WARNING: 'Warning',
  FAILED: 'Failed',
}

/** The scenarios the demo exposes. `partial` and `empty` exist in the fixture
 * adapter but are not surfaced as control-panel scenarios. */
export const SCENARIO_OPTIONS = [
  { key: 'standard', label: 'Standard' },
  { key: 'failure', label: 'Source fails' },
  { key: 'blocked', label: 'Blocked source' },
] as const satisfies readonly { key: DiscoveryFixtureScenario; label: string }[]

export const SCENARIO_LABEL: Record<DiscoveryFixtureScenario, string> = {
  standard: 'Standard',
  partial: 'Partial',
  failure: 'Source fails',
  blocked: 'Blocked source',
  empty: 'No results',
}

/** The per-company states a run walks through. */
export type CompanyDisplayState = 'pending' | 'running' | 'completed' | 'blocked' | 'failed'

export const PROGRESS_LABEL: Record<CompanyDisplayState, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  blocked: 'Blocked',
  failed: 'Failed',
}

/** Maps a pipeline outcome to a display state (chips always carry text too). */
export const COMPANY_STATE_FOR_OUTCOME: Record<PipelineOutcome, CompanyDisplayState> = {
  SUCCESS: 'completed',
  NO_RESULTS: 'completed',
  PARTIAL: 'completed',
  BLOCKED: 'blocked',
  FAILED: 'failed',
}

/** Human label for an outcome chip. */
export const OUTCOME_LABEL: Record<PipelineOutcome, string> = {
  SUCCESS: 'Completed',
  NO_RESULTS: 'Completed (no results)',
  PARTIAL: 'Completed (partial)',
  BLOCKED: 'Blocked',
  FAILED: 'Failed',
}

export { companyNameFor }