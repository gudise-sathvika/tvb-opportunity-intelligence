/**
 * Phase 22 — source-specific open-opportunity classification.
 *
 * One normalized vocabulary describing whether a discovery candidate is a
 * genuinely-actionable opportunity RIGHT NOW, so the results UI and any later
 * surface agree on what "currently open" means without re-implementing each
 * source's rules. This module is PURE: no network, clock, filesystem, or vault
 * primitive, and it never mutates its input.
 *
 * The state is derived ONLY from the source's own published fields
 * (`sourceStatus`, `sourceRawType`, `sourceDeadline`, `sourceUrl`, `provenance`).
 * Honesty rules, enforced by design:
 *  - an UNKNOWN / missing status is never treated as open;
 *  - a missing deadline is never treated as open (it is `unknown`);
 *  - a past deadline is `expired` (or `closed` when the source says closed);
 *  - awarded / completed / archived records are `historical`, never open;
 *  - an opportunity is `open` only when the source says it is open/active AND a
 *    parseable deadline is strictly in the future AND the link is official.
 *
 * This is the shared classifier; the older, narrower `grantsgov-gate` and
 * `eu-sedia-gate` predicates remain as their own contracts, and this module
 * agrees with them on the `open` bucket.
 */

import type { DiscoveryCandidate } from './candidate'
import {
  EU_SEDIA_SOURCE_ID,
  GRANTS_GOV_SOURCE_ID,
  TED_SOURCE_ID,
  USA_SPENDING_SOURCE_ID,
} from './registry'
import { GRANTS_GOV_OPPORTUNITY_PREFIX } from './grantsgov-adapter'
import { EU_OFFICIAL_URL_PREFIX } from './eu-sedia-gate'
import { TED_NOTICE_DETAIL_PREFIX } from './ted-adapter'

export const OPPORTUNITY_STATE_RULE_VERSION = 'phase22-1'

/**
 * Normalized opportunity state. `open` is the only actionable bucket;
 * `forthcoming` is announced-not-yet-open; `expired`/`closed` are no longer
 * actionable; `historical` is an award/archive; `unknown` means the source did
 * not give enough to decide (and is NEVER read as open).
 */
export const OPPORTUNITY_STATES = ['open', 'forthcoming', 'expired', 'closed', 'historical', 'unknown'] as const
export type OpportunityState = (typeof OPPORTUNITY_STATES)[number]

export interface OpportunityStatus {
  readonly state: OpportunityState
  /** Short source-specific reason, for display and audit. */
  readonly reason: string
}

export function isOpenState(state: OpportunityState): boolean {
  return state === 'open'
}

/**
 * The single ingest-time actionability gate. A candidate may enter the
 * actionable-open pool ONLY when the shared classifier says `open` — i.e. the
 * source itself says it is open/active, a parseable deadline is in the future,
 * and the link is official. Everything else (forthcoming/expired/closed/
 * historical/unknown) is excluded from the actionable pool and preserved
 * separately for provenance and audit.
 */
export function isActionableOpen(candidate: DiscoveryCandidate, now: string): boolean {
  return isOpenState(classifyOpportunityState(candidate, now).state)
}

export interface ActionabilityPartition {
  /** Records that pass the gate and may be presented as actionable-open. */
  readonly actionable: readonly DiscoveryCandidate[]
  /** Records that fail the gate; preserved (never dropped) for provenance/audit. */
  readonly excluded: readonly DiscoveryCandidate[]
}

/**
 * Splits candidates into the actionable-open pool and the excluded set using
 * the shared per-source classifier. Pure and order-preserving: this is the
 * function an ingest path calls BEFORE a record can be treated as actionable.
 */
export function partitionByActionability(
  candidates: readonly DiscoveryCandidate[],
  now: string,
): ActionabilityPartition {
  const actionable: DiscoveryCandidate[] = []
  const excluded: DiscoveryCandidate[] = []
  for (const candidate of candidates) {
    if (isActionableOpen(candidate, now)) actionable.push(candidate)
    else excluded.push(candidate)
  }
  return { actionable, excluded }
}

/** Whether a `YYYY-MM-DD` (or ISO datetime) deadline is strictly in the future of `now`. */
function deadlineInFuture(deadline: string | null, now: string): boolean | null {
  if (deadline === null || deadline.trim() === '') return null
  const deadlineMs = Date.parse(`${deadline.slice(0, 10)}T23:59:59.999Z`)
  const nowMs = Date.parse(now)
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) return null
  return deadlineMs >= nowMs
}

function hasOfficialUrl(candidate: DiscoveryCandidate, prefix: string): boolean {
  return candidate.sourceUrl !== '' && candidate.sourceUrl.startsWith(prefix)
}

/**
 * Grants.gov: posted + future close date = open; forecasted = forthcoming;
 * closed = closed; archived = historical; posted with a past/missing close is
 * expired/unknown; an unrecognized status is unknown.
 */
export function classifyGrantsGovOpportunity(candidate: DiscoveryCandidate, now: string): OpportunityStatus {
  switch (candidate.sourceStatus) {
    case 'archived':
      return { state: 'historical', reason: 'archived opportunity record' }
    case 'closed':
      return { state: 'closed', reason: 'source status is closed' }
    case 'forecasted':
      return { state: 'forthcoming', reason: 'forecasted, not yet posted' }
    case 'posted': {
      if (!hasOfficialUrl(candidate, GRANTS_GOV_OPPORTUNITY_PREFIX)) {
        return { state: 'unknown', reason: 'no official Grants.gov opportunity URL' }
      }
      const future = deadlineInFuture(candidate.sourceDeadline, now)
      if (future === null) return { state: 'unknown', reason: 'posted but no parseable close date' }
      return future
        ? { state: 'open', reason: 'posted with a future close date' }
        : { state: 'expired', reason: 'posted but the close date has passed' }
    }
    default:
      return { state: 'unknown', reason: `status is ${candidate.sourceStatus ?? 'missing'}, not posted` }
  }
}

/**
 * EU SEDIA: open-for-submission + future deadline = open; forthcoming = a
 * distinct forthcoming bucket (never mixed into open); closed = closed; open
 * with a past/missing deadline is expired/unknown; fallback unknown.
 */
export function classifyEuOpportunityState(candidate: DiscoveryCandidate, now: string): OpportunityStatus {
  switch (candidate.sourceStatus) {
    case 'forthcoming':
      return { state: 'forthcoming', reason: 'forthcoming call, not yet open for submission' }
    case 'closed':
      return { state: 'closed', reason: 'source status is closed' }
    case 'open': {
      if (!hasOfficialUrl(candidate, EU_OFFICIAL_URL_PREFIX)) {
        return { state: 'unknown', reason: 'no official EU portal URL' }
      }
      const future = deadlineInFuture(candidate.sourceDeadline, now)
      if (future === null) return { state: 'unknown', reason: 'open but no parseable deadline' }
      return future
        ? { state: 'open', reason: 'open for submission with a future deadline' }
        : { state: 'expired', reason: 'open but the deadline has passed' }
    }
    default:
      return { state: 'unknown', reason: `status is ${candidate.sourceStatus ?? 'missing'}, not open` }
  }
}

/** The leading token of a TED notice type, e.g. `cn-standard` → `cn`. */
export function tedNoticeKind(rawType: string | null): string | null {
  if (rawType === null) return null
  const token = rawType.trim().toLowerCase()
  if (token === '') return null
  const dash = token.indexOf('-')
  return dash === -1 ? token : token.slice(0, dash)
}

/**
 * TED: a contract notice (`cn-*`) with a future submission deadline is an
 * active opportunity; a contract-award notice (`can-*`) or voluntary ex-ante
 * transparency notice (`veat`) is `historical`; a prior-information notice
 * (`pin-*`) is `forthcoming`; anything else is `unknown`. Missing deadline on a
 * contract notice is `unknown`, never open.
 */
export function classifyTedOpportunity(candidate: DiscoveryCandidate, now: string): OpportunityStatus {
  const kind = tedNoticeKind(candidate.sourceRawType)
  if (kind === null) return { state: 'unknown', reason: 'no notice type published' }
  if (kind === 'can' || kind === 'veat') {
    return { state: 'historical', reason: `award notice (${candidate.sourceRawType})` }
  }
  if (kind === 'pin') {
    return { state: 'forthcoming', reason: `prior-information notice (${candidate.sourceRawType})` }
  }
  if (kind === 'cn') {
    if (candidate.sourceUrl === '' || !candidate.sourceUrl.startsWith(TED_NOTICE_DETAIL_PREFIX)) {
      return { state: 'unknown', reason: 'no official TED notice URL' }
    }
    const future = deadlineInFuture(candidate.sourceDeadline, now)
    if (future === null) return { state: 'unknown', reason: 'contract notice without a parseable submission deadline' }
    return future
      ? { state: 'open', reason: 'active contract notice with a future submission deadline' }
      : { state: 'expired', reason: 'contract notice whose submission deadline has passed' }
  }
  return { state: 'unknown', reason: `unrecognized notice type (${candidate.sourceRawType})` }
}

/**
 * Dispatches to the source-specific rule. USAspending is always `historical`
 * (obligated award history, never an open solicitation); an unknown source id
 * is `unknown` (never open).
 */
export function classifyOpportunityState(candidate: DiscoveryCandidate, now: string): OpportunityStatus {
  switch (candidate.sourceId) {
    case GRANTS_GOV_SOURCE_ID:
      return classifyGrantsGovOpportunity(candidate, now)
    case EU_SEDIA_SOURCE_ID:
      return classifyEuOpportunityState(candidate, now)
    case TED_SOURCE_ID:
      return classifyTedOpportunity(candidate, now)
    case USA_SPENDING_SOURCE_ID:
      return { state: 'historical', reason: 'obligated federal award history, not an open solicitation' }
    default:
      return { state: 'unknown', reason: `no opportunity rule for source ${candidate.sourceId}` }
  }
}
