/**
 * Procurement match review source selector — Phase 25.
 *
 * Mirror of `match-review-source.ts` for the procurement queue. REAL is the
 * default and empty (no verified company profiles exist, so no real proposal
 * can be generated); DEMO (`?demo=1`) reveals the Phase Q fixtures with a
 * visible label. Fixtures never leak into the production queue.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import type { ProcurementMatchReviewItem } from './procurement-match-review'
import { procurementMatchReviewFixtureStore } from './procurement-match-fixture'
import { isDemoMatchReviewRequest } from './match-review-source'

export type ProcurementMatchQueueMode = 'real' | 'demo'

export interface ProcurementMatchQueueSource {
  mode: ProcurementMatchQueueMode
  demo: boolean
  items: readonly ProcurementMatchReviewItem[]
}

const EMPTY: readonly ProcurementMatchReviewItem[] = Object.freeze([])

/**
 * Genuine procurement proposals. Deliberately empty: a real proposal needs a
 * genuine Company record and a genuine Notice with available provenance, and
 * the imported snapshot holds no Company records. Fixtures are never returned
 * here.
 */
export function realProcurementMatchReviewItems(): readonly ProcurementMatchReviewItem[] {
  return EMPTY
}

/** The procurement fixtures, reachable only through explicit demo mode. */
export function demoProcurementMatchReviewItems(): readonly ProcurementMatchReviewItem[] {
  return procurementMatchReviewFixtureStore.items()
}

/** Resolves the queue source from the `?demo=` flag. Real is the default. */
export function resolveProcurementMatchSource(
  demoParam: string | null | undefined,
): ProcurementMatchQueueSource {
  if (isDemoMatchReviewRequest(demoParam)) {
    return { mode: 'demo', demo: true, items: demoProcurementMatchReviewItems() }
  }
  return { mode: 'real', demo: false, items: realProcurementMatchReviewItems() }
}
