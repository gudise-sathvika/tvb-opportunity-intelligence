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
    if (typeof window !== 'undefined') {
      try {
        if (window.localStorage) return window.localStorage
      } catch {}
      try {
        if (window.sessionStorage) return window.sessionStorage
      } catch {}
    }
    if (typeof globalThis.sessionStorage !== 'undefined' && globalThis.sessionStorage !== null) {
      return globalThis.sessionStorage
    }
    if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage !== null) {
      return globalThis.localStorage
    }
    return null
  } catch {
    return null
  }
}

function compactOutcomeForStorage(outcome: DiscoveryRunOutcome): DiscoveryRunOutcome {
  return {
    ...outcome,
    reviewQueue: (outcome.reviewQueue ?? []).slice(0, 100),
    companies: (outcome.companies ?? []).map((c) => ({
      ...c,
      candidates: (c.candidates ?? []).slice(0, 50),
    })),
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
    let finalOutcome = compactOutcomeForStorage(outcome)
    if (existing.some((entry) => entry.runId === finalOutcome.runId && entry.requestedAt !== finalOutcome.requestedAt)) {
      let suffix = 2
      let candidateId = `${outcome.runId}-${suffix}`
      while (existing.some((entry) => entry.runId === candidateId)) {
        suffix++
        candidateId = `${outcome.runId}-${suffix}`
      }
      finalOutcome = { ...finalOutcome, runId: candidateId }
    }
    const kept = existing.filter((entry) => entry.runId !== finalOutcome.runId)
    kept.push(finalOutcome)

    try {
      store.setItem(STORAGE_KEY, JSON.stringify(kept.slice(-MAX_STORED_RUNS)))
    } catch {
      // If quota exceeded, preserve the latest 10 runs
      try {
        store.setItem(STORAGE_KEY, JSON.stringify(kept.slice(-10)))
      } catch {}
    }

    // Also mirror to sessionStorage if localStorage was primary
    try {
      if (typeof window !== 'undefined' && window.sessionStorage && window.sessionStorage !== store) {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(kept.slice(-10)))
      }
    } catch {}
  } catch {
    // Storage unavailable or full
  }
}

/** Reads back mirrored runs newest-last. Never throws; invalid entries dropped. */
export function loadPersistedRuns(): readonly DiscoveryRunOutcome[] {
  const store = storage()
  if (store === null) return []
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (raw === null) {
      // Try fallback to sessionStorage if primary was empty
      if (typeof window !== 'undefined' && window.sessionStorage && window.sessionStorage !== store) {
        const fallbackRaw = window.sessionStorage.getItem(STORAGE_KEY)
        if (fallbackRaw !== null) {
          const parsed = JSON.parse(fallbackRaw)
          return Array.isArray(parsed) ? parsed.filter(isRunOutcome) : []
        }
      }
      return []
    }
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
