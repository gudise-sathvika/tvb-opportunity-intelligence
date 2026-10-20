export interface TargetContractRecord {
  readonly contractId: string
  readonly applicationId: string
  readonly companyId: string
  readonly companyName: string
  readonly opportunityId: string
  readonly opportunityTitle: string
  readonly sourceUrl: string
  readonly status: 'draft' | 'confirmed' | 'active' | 'completed' | 'cancelled'
  readonly awardConfirmedAt: string
  readonly createdAt: string
}

const STORAGE_KEY = 'tvb.target-contracts.v1'

export function loadTargetContracts(): TargetContractRecord[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as TargetContractRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function createTargetContract(record: Omit<TargetContractRecord, 'contractId' | 'createdAt'>): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    if (!record.awardConfirmedAt.trim() || !Number.isFinite(Date.parse(record.awardConfirmedAt))) return false
    const existing = loadTargetContracts()
    const duplicate = existing.some(
      (item) => item.companyId === record.companyId && item.opportunityId === record.opportunityId,
    )
    if (duplicate) return false
    let idSuffix = Date.now()
    while (existing.some((item) => item.contractId === `CTR-${idSuffix}`)) idSuffix += 1
    const contract: TargetContractRecord = {
      ...record,
      contractId: `CTR-${idSuffix}`,
      createdAt: new Date().toISOString(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, contract]))
    return true
  } catch {
    return false
  }
}

export function updateTargetContractStatus(
  contractId: string,
  status: TargetContractRecord['status'],
): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    const existing = loadTargetContracts()
    const next = existing.map((item) => (item.contractId === contractId ? { ...item, status } : item))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}