/**
 * Phase 33 application preparation workspace — narrow working-state store.
 *
 * For one APPROVED review item (exactly one company association), the
 * workspace tracks preparation checklist states and notes. Design rules:
 *
 *  - checklist structure is DERIVED deterministically from the review item
 *    (verification actions + one item per official document link when the
 *    item carries them); only states and notes are stored, keyed by stable
 *    item ids — so repeated discovery can neither duplicate workspaces nor
 *    overwrite progress;
 *  - states: `pending` | `done` | `blocked`; unknown item ids are rejected;
 *  - readiness is computed, never stored: blocked if any item blocked; ready
 *    if at least one item exists and all are done; in progress if any item is
 *    done or notes exist; otherwise unknown. Readiness is preparation
 *    bookkeeping — it never implies eligibility or submission;
 *  - review items that are missing or not APPROVED are refused with reasons;
 *  - browser `localStorage` working state only (same seam as review
 *    persistence); failures report honestly and never fake a save.
 */

import type { ReviewItem } from '../automation/review-queue'
import { reviewFixtureStore } from '../automation/review-fixture'

export const PREPARATION_STORAGE_KEY = 'tvb.preparation-workspace.v1'

export type ChecklistItemState = 'pending' | 'done' | 'blocked'
export type ReadinessStatus = 'ready' | 'in_progress' | 'blocked' | 'unknown'

export interface ChecklistItem {
  readonly id: string
  readonly label: string
  readonly kind: 'verification' | 'document'
  readonly evidenceUrl: string | null
  readonly state: ChecklistItemState
}

export interface PreparationWorkspace {
  readonly reviewId: string
  readonly companyId: string
  readonly domain: string
  readonly items: readonly ChecklistItem[]
  readonly notes: string
  readonly readiness: ReadinessStatus
  readonly updatedAt: string | null
}

export interface PreparationStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface StoredWorkspace {
  states: Record<string, ChecklistItemState>
  notes: string
  updatedAt: string | null
}

function defaultStorage(): PreparationStorage | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null
    return globalThis.localStorage
  } catch {
    return null
  }
}

const ITEM_STATES: readonly ChecklistItemState[] = ['pending', 'done', 'blocked']

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Derives the checklist for a review item. Verification actions are always
 * present (they are things to check, never source facts); one document item
 * is added per official document link carried by the item's evidence, when
 * the item carries any.
 */
export function deriveChecklist(item: ReviewItem): Omit<ChecklistItem, 'state'>[] {
  const deadline = item.normalization?.deadline.normalized ?? null
  const documents = item.sourceEvidence?.documents ?? []
  const list: Omit<ChecklistItem, 'state'>[] = [
    {
      id: 'verify-deadline',
      label: `Verify the deadline${deadline !== null ? ` (${deadline})` : ''} is still current at the official source`,
      kind: 'verification',
      evidenceUrl: item.sourceUrl,
    },
    {
      id: 'verify-eligibility',
      label: 'Confirm applicant eligibility in the official call documents — approval is not eligibility proof',
      kind: 'verification',
      evidenceUrl: item.sourceUrl,
    },
    {
      id: 'prepare-documents',
      label: 'Collect the documents the official call requires (see source links)',
      kind: 'verification',
      evidenceUrl: item.sourceUrl,
    },
  ]
  for (const [index, doc] of documents.slice(0, 10).entries()) {
    list.push({
      id: `document-${index}`,
      label: `Review official document: ${doc.label.slice(0, 100)}`,
      kind: 'document',
      evidenceUrl: doc.url,
    })
  }
  return list
}

/** Computes readiness from item states and notes. Preparation only — never eligibility. */
export function computeReadiness(states: readonly ChecklistItemState[], hasNotes: boolean, itemCount: number): ReadinessStatus {
  if (states.some((state) => state === 'blocked')) return 'blocked'
  if (itemCount > 0 && states.length === itemCount && states.every((state) => state === 'done')) return 'ready'
  if (states.some((state) => state === 'done') || hasNotes) return 'in_progress'
  return 'unknown'
}

function readStored(storage: PreparationStorage | null, reviewId: string): StoredWorkspace | null {
  if (storage === null) return null
  try {
    const raw = storage.getItem(PREPARATION_STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    const entry = parsed[reviewId]
    if (!isRecord(entry)) return null
    const states: Record<string, ChecklistItemState> = {}
    if (isRecord(entry['states'])) {
      for (const [key, value] of Object.entries(entry['states'])) {
        if (typeof value === 'string' && (ITEM_STATES as readonly string[]).includes(value)) {
          states[key] = value as ChecklistItemState
        }
      }
    }
    return {
      states,
      notes: typeof entry['notes'] === 'string' ? (entry['notes'] as string).slice(0, 20000) : '',
      updatedAt: typeof entry['updatedAt'] === 'string' ? (entry['updatedAt'] as string) : null,
    }
  } catch {
    return null
  }
}

function writeStored(
  storage: PreparationStorage | null,
  reviewId: string,
  stored: StoredWorkspace,
): boolean {
  if (storage === null) return false
  try {
    const raw = storage.getItem(PREPARATION_STORAGE_KEY)
    const parsed: unknown = raw === null ? {} : JSON.parse(raw)
    const record = isRecord(parsed) ? { ...parsed } : {}
    record[reviewId] = stored
    storage.setItem(PREPARATION_STORAGE_KEY, JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

export type WorkspaceResult =
  | { readonly ok: true; readonly workspace: PreparationWorkspace }
  | { readonly ok: false; readonly error: string }

/**
 * Loads the workspace for an approved review item, merging derived checklist
 * structure with stored states/notes. Refuses missing or non-approved items
 * with reasons instead of guessing.
 */
export function loadWorkspace(
  reviewId: string,
  storage: PreparationStorage | null = defaultStorage(),
): WorkspaceResult {
  const item = reviewFixtureStore.item(reviewId.trim())
  if (item === undefined) return { ok: false, error: 'no such review item in the local store' }
  if (item.reviewStatus !== 'APPROVED') {
    return { ok: false, error: 'only an APPROVED review item can enter application preparation' }
  }
  const derived = deriveChecklist(item)
  const stored = readStored(storage, item.reviewId) ?? { states: {}, notes: '', updatedAt: null }
  const items = derived.map((entry) => ({
    ...entry,
    state: stored.states[entry.id] ?? ('pending' as const),
  }))
  return {
    ok: true,
    workspace: {
      reviewId: item.reviewId,
      companyId: item.companyId,
      domain: item.domain,
      items,
      notes: stored.notes,
      readiness: computeReadiness(
        items.map((entry) => entry.state),
        stored.notes.trim().length > 0,
        items.length,
      ),
      updatedAt: stored.updatedAt,
    },
  }
}

/** Records one checklist state. Unknown item ids are rejected, never stored. */
export function setChecklistState(
  reviewId: string,
  itemId: string,
  state: ChecklistItemState,
  storage: PreparationStorage | null = defaultStorage(),
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  const loaded = loadWorkspace(reviewId, storage)
  if (!loaded.ok) return loaded
  if (!loaded.workspace.items.some((entry) => entry.id === itemId)) {
    return { ok: false, error: 'unknown checklist item' }
  }
  const stored = readStored(storage, reviewId) ?? { states: {}, notes: '', updatedAt: null }
  const next: StoredWorkspace = {
    states: { ...stored.states, [itemId]: state },
    notes: stored.notes,
    updatedAt: new Date().toISOString(),
  }
  if (!writeStored(storage, reviewId, next)) return { ok: false, error: 'the progress update could not be persisted' }
  return { ok: true }
}

/** Records workspace notes. Does not touch source records or decisions. */
export function setWorkspaceNotes(
  reviewId: string,
  notes: string,
  storage: PreparationStorage | null = defaultStorage(),
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  const loaded = loadWorkspace(reviewId, storage)
  if (!loaded.ok) return loaded
  const stored = readStored(storage, reviewId) ?? { states: {}, notes: '', updatedAt: null }
  const next: StoredWorkspace = { states: { ...stored.states }, notes, updatedAt: new Date().toISOString() }
  if (!writeStored(storage, reviewId, next)) return { ok: false, error: 'the notes could not be persisted' }
  return { ok: true }
}
