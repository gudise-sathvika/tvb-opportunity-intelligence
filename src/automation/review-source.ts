/**
 * Human review source selector — Phase 01A production/demo separation.
 *
 * The `/review` queue has two strictly separate sources:
 *
 *  - REAL (default): only review items SUPPLIED at runtime through the
 *    discovery handoff (`reviewFixtureStore.addReviewItems`). These are the
 *    genuine candidates a live or fixture discovery run produced. No discovery
 *    run has run yet, so this is empty — the honest production state. The seed
 *    demonstration items are NEVER returned here.
 *
 *  - DEMO (`?demo=1`): the Phase F demonstration seed items (companies
 *    COMP-001, fixture listings under `fixtures.invalid`) plus any supplied
 *    items. Reachable only through the explicit `?demo=1` flag and visibly
 *    labelled in the UI. They exist for automated tests and demonstration.
 *
 * Keeping the two apart by construction means a fixture candidate cannot leak
 * into the production review queue, and an empty queue reports honestly rather
 * than pretending fixtures are real candidates.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import type { ReviewItem } from './review-queue'
import { reviewFixtureStore } from './review-fixture'

/** Query flag that opts a reviewer into the explicitly labelled demo queue. */
export const REVIEW_DEMO_PARAM = 'demo'
export const REVIEW_DEMO_VALUE = '1'

export type ReviewQueueMode = 'real' | 'demo'

export interface ReviewQueueSource {
  mode: ReviewQueueMode
  /** True only for the explicitly requested demo queue. */
  demo: boolean
  items: readonly ReviewItem[]
}

export function isDemoReviewRequest(demoParam: string | null | undefined): boolean {
  return demoParam === REVIEW_DEMO_VALUE
}

/** Genuine review items supplied at runtime. Empty until a discovery run runs. */
export function realReviewItems(): readonly ReviewItem[] {
  return reviewFixtureStore.suppliedItems()
}

/** The demonstration items plus genuine supplied items, demo mode only. */
export function demoReviewItems(): readonly ReviewItem[] {
  return reviewFixtureStore.items()
}

/** Resolves the queue source from the `?demo=` flag. Real is the default. */
export function resolveReviewSource(demoParam: string | null | undefined): ReviewQueueSource {
  if (isDemoReviewRequest(demoParam)) {
    return { mode: 'demo', demo: true, items: demoReviewItems() }
  }
  return { mode: 'real', demo: false, items: realReviewItems() }
}

/**
 * Resolves a single review item for the detail page. In real mode only a
 * genuine supplied item resolves; a fixture seed id is not-found. In demo mode
 * any store item (fixture or supplied) resolves.
 */
export function resolveReviewItem(
  reviewId: string | undefined,
  demoParam: string | null | undefined,
): ReviewItem | undefined {
  if (!reviewId) return undefined
  if (isDemoReviewRequest(demoParam)) return reviewFixtureStore.item(reviewId)
  return realReviewItems().find((item) => item.reviewId === reviewId)
}
