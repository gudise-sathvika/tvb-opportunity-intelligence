import type { ProcurementMatchReviewItem } from '../automation/procurement-match-review'

const STORAGE_KEY = 'tvb.target-procurement-match-review-items.v1'

export interface ProcurementMatchReviewStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): ProcurementMatchReviewStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function isProcurementMatchReviewItem(value: unknown): value is ProcurementMatchReviewItem {
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

export function loadProcurementMatchReviewItems(
  storage = defaultStorage(),
): ProcurementMatchReviewItem[] {
  if (storage === null) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isProcurementMatchReviewItem) : []
  } catch {
    return []
  }
}

function persist(
  items: readonly ProcurementMatchReviewItem[],
  storage = defaultStorage(),
): boolean {
  if (storage === null) return false
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(items))
    return true
  } catch {
    return false
  }
}

export function saveProcurementMatchReviewItems(
  items: readonly ProcurementMatchReviewItem[],
  storage = defaultStorage(),
): boolean {
  if (storage === null) return false
  const existing = loadProcurementMatchReviewItems(storage)
  const byProposalId = new Map(existing.map((item) => [item.proposal.proposalId, item]))
  for (const item of items) {
    if (!byProposalId.has(item.proposal.proposalId)) {
      byProposalId.set(item.proposal.proposalId, item)
    }
  }
  return persist([...byProposalId.values()], storage)
}

export function updateProcurementMatchReviewItem(
  item: ProcurementMatchReviewItem,
  storage = defaultStorage(),
): boolean {
  if (storage === null) return false
  const existing = loadProcurementMatchReviewItems(storage)
  const index = existing.findIndex((entry) => entry.proposal.proposalId === item.proposal.proposalId)
  if (index < 0) return false
  const next = [...existing]
  next[index] = item
  return persist(next, storage)
}
