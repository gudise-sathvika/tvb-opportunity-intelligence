/**
 * Match review source selector — Phase 24 production/demo separation.
 *
 * The Match Review queue has two strictly separate sources:
 *
 *  - REAL: genuine proposals only. A real proposal requires BOTH a genuine
 *    Company record and a genuine Opportunity record whose provenance is
 *    available, plus matching rules that have evidence to evaluate. The
 *    production snapshot currently contains zero Company records, so no real
 *    proposal can be generated yet and `realMatchReviewItems()` is empty. This
 *    module NEVER substitutes a fixture for a missing real record.
 *
 *  - DEMO: the Phase M fixture proposals (companies COMP-001…003 prefixed
 *    `DEMO —`, fixture opportunities FX-M-3001/FX-M-3002). They are reachable
 *    only through the explicit `?demo=1` flag and are visibly labelled in the
 *    UI. They exist for automated tests and demonstration, never as production
 *    matches.
 *
 * Keeping the two apart by construction means a fixture proposal cannot leak
 * into the production queue, and an empty production queue reports honestly
 * rather than pretending fixtures are real.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import type { MatchReviewItem } from './match-review'
import { matchReviewFixtureStore } from './match-review-fixture'

/** Query flag that opts a reviewer into the explicitly labelled demo queue. */
export const MATCH_REVIEW_DEMO_PARAM = 'demo'
export const MATCH_REVIEW_DEMO_VALUE = '1'

export type MatchReviewQueueMode = 'real' | 'demo'

export interface MatchReviewQueueSource {
  mode: MatchReviewQueueMode
  /** True only for the explicitly requested demo queue. */
  demo: boolean
  items: readonly MatchReviewItem[]
}

const EMPTY: readonly MatchReviewItem[] = Object.freeze([])

export function isDemoMatchReviewRequest(demoParam: string | null | undefined): boolean {
  return demoParam === MATCH_REVIEW_DEMO_VALUE
}

/**
 * Genuine proposals for the production queue.
 *
 * Deliberately empty: real proposals require a real Company record and a real
 * Opportunity record with available provenance. The imported snapshot holds no
 * Company records, so there is nothing honest to propose. Fixtures are never
 * returned here.
 */
export function realMatchReviewItems(): readonly MatchReviewItem[] {
  return EMPTY
}

/** The fixture proposals, reachable only through explicit demo mode. */
export function demoMatchReviewItems(): readonly MatchReviewItem[] {
  return matchReviewFixtureStore.items()
}

/** Resolves the queue source from the `?demo=` flag. Real is the default. */
export function resolveMatchReviewSource(demoParam: string | null | undefined): MatchReviewQueueSource {
  if (isDemoMatchReviewRequest(demoParam)) {
    return { mode: 'demo', demo: true, items: demoMatchReviewItems() }
  }
  return { mode: 'real', demo: false, items: realMatchReviewItems() }
}
