/**
 * Phase 31 durable human-review decisions — minimal persistence foundation.
 *
 * Problem: the review store is module-memory only, so a page reload silently
 * discards supplied review items and every recorded human decision. This
 * module mirrors supplied (real, non-fixture) review items into browser
 * `localStorage` and restores them on session start. It is deliberately
 * narrow:
 *
 *  - supplied items only: deterministic seed fixtures rebuild themselves and
 *    are never persisted (demo decisions stay ephemeral by design);
 *  - restore merges by review id and never overwrites a live in-memory item,
 *    so current-session truth always wins ties;
 *  - stored items are shape-validated before touching the store; corrupt or
 *    foreign payloads are ignored, never guessed;
 *  - storage failures (private mode, quota, unavailable) degrade to the
 *    previous in-memory behavior — persistence is best-effort, never load-bearing;
 *  - no Vault involvement: this is working-state durability for one local
 *    user, not a multi-user backend (see the Phase 31 report for why a server
 *    database is unjustified for this deployment).
 *
 * Wiring: `installReviewPersistence()` subscribes a saver to the store and
 * restores once; call it from the Human Review view. Everything here is
 * injected/testable and side-effect free until installed.
 */

import { REVIEW_STATUSES } from '../automation/review-queue'
import type { ReviewItem, ReviewStatus } from '../automation/review-queue'
import { reviewFixtureStore } from '../automation/review-fixture'

export const REVIEW_PERSISTENCE_KEY = 'tvb.human-review.supplied.v1'

export interface ReviewStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): ReviewStorage | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null
    return globalThis.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === 'string' && (REVIEW_STATUSES as readonly string[]).includes(value)
}

/** Shape gate for restored items: contract-valid shape or nothing. */
export function isStorableReviewItem(value: unknown): value is ReviewItem {
  if (!isRecord(value)) return false
  if (typeof value['reviewId'] !== 'string' || (value['reviewId'] as string).length === 0) return false
  if (typeof value['candidateId'] !== 'string' || (value['candidateId'] as string).length === 0) return false
  if (!isReviewStatus(value['reviewStatus'])) return false
  if (!Array.isArray(value['audit'])) return false
  return true
}

export interface RestoreOutcome {
  readonly restored: number
  readonly skipped: number
}

/** Persists current supplied items. Returns false when storage is unavailable. */
export function saveSuppliedReviewState(storage: ReviewStorage | null = defaultStorage()): boolean {
  if (storage === null) return false
  try {
    storage.setItem(REVIEW_PERSISTENCE_KEY, JSON.stringify(reviewFixtureStore.suppliedItems()))
    return true
  } catch {
    return false
  }
}

/**
 * Restores previously saved supplied items into the store. Merges by review
 * id (existing in-memory items win ties); invalid entries are skipped.
 */
export function restoreSuppliedReviewState(storage: ReviewStorage | null = defaultStorage()): RestoreOutcome {
  if (storage === null) return { restored: 0, skipped: 0 }
  let parsed: unknown = null
  try {
    const raw = storage.getItem(REVIEW_PERSISTENCE_KEY)
    if (raw === null) return { restored: 0, skipped: 0 }
    parsed = JSON.parse(raw)
  } catch {
    return { restored: 0, skipped: 0 }
  }
  if (!Array.isArray(parsed)) return { restored: 0, skipped: 0 }
  const valid = parsed.filter(isStorableReviewItem)
  const skipped = parsed.length - valid.length
  const before = new Set(reviewFixtureStore.items().map((item) => item.reviewId))
  const fresh = valid.filter((item) => !before.has(item.reviewId))
  if (fresh.length > 0) reviewFixtureStore.addReviewItems(fresh)
  return { restored: fresh.length, skipped }
}

let installedUnsubscribe: (() => void) | null = null

/**
 * Installs once per session: restores saved decisions, then saves on every
 * subsequent store change. Returns an uninstall function (tests only).
 */
export function installReviewPersistence(storage: ReviewStorage | null = defaultStorage()): () => void {
  restoreSuppliedReviewState(storage)
  if (installedUnsubscribe === null) {
    installedUnsubscribe = reviewFixtureStore.subscribe(() => {
      saveSuppliedReviewState(storage)
    })
  }
  return () => {
    installedUnsubscribe?.()
    installedUnsubscribe = null
  }
}
