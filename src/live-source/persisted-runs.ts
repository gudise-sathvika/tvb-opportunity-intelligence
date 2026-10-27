/**
 * Phase 15B session persistence for Discovery run outcomes — minimal additive layer.
 *
 * Store histories are module-memory only, so a full page reload wiped them and
 * the History view could never survive navigation outside the SPA. This module
 * mirrors every finished run outcome into `sessionStorage` (same tab only;
 * never localStorage, never the network, never the Vault) and reads them back
 * with strict shape validation — corrupt or foreign entries are ignored, never
 * guessed.
 *
 * What is (and is not) restored:
 *  - run snapshots (inputs, counts, per-company results, handoff review items
 *    as-handed-off) ARE restored for browsing;
 *  - human decisions are NOT restorable: they live in the review store, which
 *    is equally session-only. Rehydrated handoff items therefore re-enter as
 *    their handoff states; anything decided before the reload is documented as
 *    lost, never reconstructed.
 *  - rehydration into the review store uses the existing idempotent
 *    `addReviewItems` (reviewId-deduped), so repeated loads cannot duplicate.
 */

import type { DiscoveryRunOutcome } from '../automation/discovery-fixture'
import { reviewFixtureStore } from '../automation/review-fixture'
import type { ReviewItem } from '../automation/review-queue'

const STORAGE_KEY = 'tvb.discovery.runs.v1'
const MAX_STORED_RUNS = 50

function storage(): Storage | null {
  try {
    if (typeof globalThis.sessionStorage === 'undefined') return null
    return globalThis.sessionStorage
  } catch {
    return null
  }
}

function isRunOutcome(value: unknown): value is DiscoveryRunOutcome {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record['runId'] === 'string' &&
    (record['runId'] as string).length > 0 &&
    Array.isArray(record['companyIds']) &&
    Array.isArray(record['companies']) &&
    typeof record['requestedAt'] === 'string' &&
    Array.isArray(record['reviewQueue'])
  )
}

/** Appends one finished run outcome to the session mirror. Never throws. */
export function persistRunOutcome(outcome: DiscoveryRunOutcome): void {
  const store = storage()
  if (store === null) return
  try {
    const raw = store.getItem(STORAGE_KEY)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    const existing = (Array.isArray(parsed) ? parsed : []).filter(isRunOutcome)
    let finalOutcome = outcome
    if (existing.some((entry) => entry.runId === finalOutcome.runId && entry.requestedAt !== finalOutcome.requestedAt)) {
      let suffix = 2
      let candidateId = `${outcome.runId}-${suffix}`
      while (existing.some((entry) => entry.runId === candidateId)) {
        suffix++
        candidateId = `${outcome.runId}-${suffix}`
      }
      finalOutcome = { ...outcome, runId: candidateId }
    }
    const kept = existing.filter((entry) => entry.runId !== finalOutcome.runId)
    kept.push(finalOutcome)
    store.setItem(STORAGE_KEY, JSON.stringify(kept.slice(-MAX_STORED_RUNS)))
  } catch {
    // Session storage unavailable or full: history simply stays memory-only.
  }
}

/** Reads back mirrored runs newest-last. Never throws; invalid entries dropped. */
export function loadPersistedRuns(): readonly DiscoveryRunOutcome[] {
  const store = storage()
  if (store === null) return []
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRunOutcome)
  } catch {
    return []
  }
}

/**
 * Rehydrates handoff review items for restored runs so run-scoped review links
 * keep working after a reload. Idempotent via the store's reviewId dedup; runs
 * already live in a store are skipped by id.
 */
export function rehydratePersistedReviews(runs: readonly DiscoveryRunOutcome[]): number {
  let added = 0
  try {
    const existing = new Set(reviewFixtureStore.items().map((item) => item.reviewId))
    for (const run of runs) {
      const fresh = (run.reviewQueue as readonly ReviewItem[]).filter((item) => !existing.has(item.reviewId))
      for (const item of fresh) existing.add(item.reviewId)
      if (fresh.length > 0) {
        reviewFixtureStore.addReviewItems(fresh)
        added += fresh.length
      }
    }
  } catch {
    // Never let rehydration break a page render.
  }
  return added
}
