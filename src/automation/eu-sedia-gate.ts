/**
 * Phase 21C deterministic open-call gate for the EU Funding & Tenders Portal.
 *
 * An EU SEDIA record is reported as a CONFIRMED OPEN call only when ALL of the
 * following hold, from the source's own data (no inference, no guessing):
 *   1. the normalized source status is exactly `open` (SEDIA code 31094502,
 *      "Open for submission") — `forthcoming` and `closed` never qualify;
 *   2. it carries a parseable deadline strictly in the future (relative to an
 *      explicit `now`, so the gate is deterministic and testable);
 *   3. its link is an official `https://ec.europa.eu/` URL;
 *   4. it carries EU SEDIA provenance (source id, record id, source name,
 *      observed-at).
 *
 * Everything else is EXCLUDED with exact reasons. Missing or invalid data never
 * qualifies as confirmed open.
 */

import type { DiscoveryCandidate } from './candidate'
import { EU_SEDIA_SOURCE_ID } from './registry'

export const EU_OPEN_OPPORTUNITY_RULE_VERSION = 'phase21c-1'

export interface EuOpenOpportunityVerdict {
  readonly open: boolean
  readonly reasons: readonly string[]
}

/** The normalized status that means "open for submission". */
export const EU_OPEN_STATUS = 'open'

/** Official EU link prefix a confirmed-open record must use. */
export const EU_OFFICIAL_URL_PREFIX = 'https://ec.europa.eu/'

export function evaluateEuOpenOpportunity(candidate: DiscoveryCandidate, now: string): EuOpenOpportunityVerdict {
  const reasons: string[] = []

  if (candidate.sourceId !== EU_SEDIA_SOURCE_ID) reasons.push('not an EU Funding & Tenders source record')
  if (candidate.sourceStatus !== EU_OPEN_STATUS) {
    reasons.push(`status is ${candidate.sourceStatus === null ? 'missing' : candidate.sourceStatus}, not ${EU_OPEN_STATUS}`)
  }

  const deadline = candidate.sourceDeadline
  if (deadline === null) {
    reasons.push('no deadline')
  } else {
    const deadlineMs = Date.parse(`${deadline}T23:59:59.999Z`)
    const nowMs = Date.parse(now)
    if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) {
      reasons.push('deadline is not parseable')
    } else if (deadlineMs < nowMs) {
      reasons.push('deadline is not in the future')
    }
  }

  if (candidate.sourceUrl === '' || !candidate.sourceUrl.startsWith(EU_OFFICIAL_URL_PREFIX)) {
    reasons.push('no official EU portal URL')
  }

  const p = candidate.provenance
  if (p.sourceId !== EU_SEDIA_SOURCE_ID) reasons.push('missing EU provenance source id')
  if (p.sourceRecordId === null || p.sourceRecordId === '') reasons.push('missing source record id provenance')
  if (p.sourceName === null) reasons.push('missing source name provenance')
  if (p.observedAt === '') reasons.push('missing observed-at provenance')

  return { open: reasons.length === 0, reasons }
}
