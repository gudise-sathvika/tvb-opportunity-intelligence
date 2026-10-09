/**
 * Phase 20C deterministic open-opportunity gate.
 *
 * A Grants.gov record is only reported as a CONFIRMED OPEN opportunity when ALL
 * of the following hold, from the source's own data (no inference, no guessing):
 *   1. the recognized source status is exactly `posted`;
 *   2. it carries a parseable close date strictly in the future (relative to an
 *      explicit `now`, so the gate is deterministic and testable);
 *   3. its official URL is a Grants.gov opportunity-detail URL;
 *   4. it carries Grants.gov provenance (source id, record id, source name,
 *      observed-at).
 *
 * Everything else is EXCLUDED with the exact reasons. Missing or invalid data
 * never qualifies as confirmed open.
 */

import type { DiscoveryCandidate } from './candidate'
import { GRANTS_GOV_SOURCE_ID } from './registry'
import { GRANTS_GOV_OPPORTUNITY_PREFIX } from './grantsgov-adapter'

export const OPEN_OPPORTUNITY_RULE_VERSION = 'phase20c-1'

export interface OpenOpportunityVerdict {
  readonly open: boolean
  readonly reasons: readonly string[]
}

/** True only for the source status that means "open/accepting applications". */
export const OPEN_GRANTS_GOV_STATUS = 'posted'

export function evaluateOpenOpportunity(candidate: DiscoveryCandidate, now: string): OpenOpportunityVerdict {
  const reasons: string[] = []

  if (candidate.sourceId !== GRANTS_GOV_SOURCE_ID) reasons.push('not a Grants.gov source record')
  if (candidate.sourceStatus !== OPEN_GRANTS_GOV_STATUS) {
    reasons.push(`status is ${candidate.sourceStatus === null ? 'missing' : candidate.sourceStatus}, not ${OPEN_GRANTS_GOV_STATUS}`)
  }

  const close = candidate.sourceDeadline
  if (close === null) {
    reasons.push('no close date')
  } else {
    const closeMs = Date.parse(`${close}T23:59:59.999Z`)
    const nowMs = Date.parse(now)
    if (!Number.isFinite(closeMs) || !Number.isFinite(nowMs)) {
      reasons.push('close date is not parseable')
    } else if (closeMs < nowMs) {
      reasons.push('close date is not in the future')
    }
  }

  if (candidate.sourceUrl === '' || !candidate.sourceUrl.startsWith(GRANTS_GOV_OPPORTUNITY_PREFIX)) {
    reasons.push('no official Grants.gov opportunity URL')
  }

  const p = candidate.provenance
  if (p.sourceId !== GRANTS_GOV_SOURCE_ID) reasons.push('missing Grants.gov provenance source id')
  if (p.sourceRecordId === null || p.sourceRecordId === '') reasons.push('missing source record id provenance')
  if (p.sourceName === null) reasons.push('missing source name provenance')
  if (p.observedAt === '') reasons.push('missing observed-at provenance')

  return { open: reasons.length === 0, reasons }
}
