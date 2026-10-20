import type { MatchReviewItem } from '../automation/match-review'

const STORAGE_KEY = 'tvb.target-match-review-items.v1'
const LEGACY_SESSION_KEY = 'tvb.target-match-review-items.v1'

export interface MatchReviewStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): MatchReviewStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function isMatchReviewItem(value: unknown): value is MatchReviewItem {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const proposal = item['proposal']
  if (proposal === null || typeof proposal !== 'object' || Array.isArray(proposal)) return false
  const proposalId = (proposal as Record<string, unknown>)['proposalId']
  return (
    typeof proposalId === 'string' &&
    proposalId.length > 0 &&
    (item['reviewStatus'] === 'PENDING' || item['reviewStatus'] === 'APPROVED' || item['reviewStatus'] === 'REJECTED') &&
    Array.isArray(item['audit'])
  )
}

export function loadMatchReviewItems(storage = defaultStorage()): MatchReviewItem[] {
  if (storage === null) return []
  try {
    let raw = storage.getItem(STORAGE_KEY)
    if (raw === null) {
      raw = storage.getItem(LEGACY_SESSION_KEY)
      if (raw !== null) {
        storage.setItem(STORAGE_KEY, raw)
        storage.removeItem(LEGACY_SESSION_KEY)
      }
    }
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isMatchReviewItem) : []
  } catch {
    return []
  }
}

function persist(items: readonly MatchReviewItem[], storage = defaultStorage()): boolean {
  if (storage === null) return false
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(items))
    return true
  } catch {
    return false
  }
}

export function saveMatchReviewItems(
  items: readonly MatchReviewItem[],
  storage = defaultStorage(),
): boolean {
  if (storage === null) return false
  const existing = loadMatchReviewItems(storage)
  const byProposalId = new Map(existing.map((item) => [item.proposal.proposalId, item]))
  for (const item of items) {
    if (!byProposalId.has(item.proposal.proposalId)) byProposalId.set(item.proposal.proposalId, item)
  }
  return persist([...byProposalId.values()], storage)
}

export function updateMatchReviewItem(
  item: MatchReviewItem,
  storage = defaultStorage(),
): boolean {
  if (storage === null) return false
  const existing = loadMatchReviewItems(storage)
  const index = existing.findIndex((entry) => entry.proposal.proposalId === item.proposal.proposalId)
  if (index < 0) return false
  const next = [...existing]
  next[index] = item
  return persist(next, storage)
}
