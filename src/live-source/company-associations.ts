/**
 * Phase 32 company-opportunity approval associations — narrow working-state store.
 *
 * A reviewer approving a review item for an intended company creates exactly
 * one association: `{ reviewId, companyId, ... }`. Design rules:
 *
 *  - the company must be an explicitly confirmed directory name (never
 *    inferred, never a pool marker, never blank);
 *  - the review item must exist and already be APPROVED (approval happens
 *    first through the real Phase E path; this store never approves);
 *  - one review item yields at most one association (terminal decisions make
 *    repeats impossible; duplicates are idempotent no-ops, never new rows);
 *  - the same underlying opportunity may be associated with many companies —
 *    each pair is its own association;
 *  - associations are working state for the local single-user prototype and
 *    live in browser `localStorage` (same seam as review persistence), never
 *    in the production Vault and never auto-created by discovery or matching;
 *  - opportunity details (title, URL, deadline) are always read live from the
 *    referenced review item, so an association can never drift from its
 *    evidence; a missing review record renders as unavailable, never guessed.
 */

import { COMPANY_DIRECTORY_NAMES } from '../data/company-directory-names'
import { reviewFixtureStore } from '../automation/review-fixture'
import type { DiscoveryDomain } from '../automation/types'

export const COMPANY_ASSOCIATIONS_KEY = 'tvb.company-associations.v1'

export interface CompanyAssociation {
  readonly reviewId: string
  readonly companyId: string
  readonly candidateId: string
  readonly sourceRecordId: string | null
  readonly domain: DiscoveryDomain
  readonly decidedAt: string
  readonly reviewerId: string
}

export interface AssociationStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): AssociationStorage | null {
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

function isStorableAssociation(value: unknown): value is CompanyAssociation {
  if (!isRecord(value)) return false
  if (typeof value['reviewId'] !== 'string' || (value['reviewId'] as string).length === 0) return false
  if (typeof value['companyId'] !== 'string' || (value['companyId'] as string).length === 0) return false
  if (typeof value['candidateId'] !== 'string' || (value['candidateId'] as string).length === 0) return false
  if (value['domain'] !== 'funding' && value['domain'] !== 'procurement') return false
  if (typeof value['decidedAt'] !== 'string' || typeof value['reviewerId'] !== 'string') return false
  return true
}

function readAll(storage: AssociationStorage | null): CompanyAssociation[] {
  if (storage === null) return []
  try {
    const raw = storage.getItem(COMPANY_ASSOCIATIONS_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isStorableAssociation)
  } catch {
    return []
  }
}

function writeAll(storage: AssociationStorage | null, associations: readonly CompanyAssociation[]): boolean {
  if (storage === null) return false
  try {
    storage.setItem(COMPANY_ASSOCIATIONS_KEY, JSON.stringify(associations))
    return true
  } catch {
    return false
  }
}

export type AssociateCompanyResult =
  | { readonly ok: true; readonly association: CompanyAssociation; readonly duplicate: boolean }
  | { readonly ok: false; readonly error: string }

/**
 * Records the company association for an approved review item. Rejects blank
 * or non-directory companies, missing items, and non-approved items instead
 * of fabricating anything. Idempotent per review id.
 */
export function associateCompany(
  input: { reviewId: string; companyId: string; decidedAt: string; reviewerId: string },
  storage: AssociationStorage | null = defaultStorage(),
): AssociateCompanyResult {
  const reviewId = input.reviewId.trim()
  const companyId = input.companyId.trim()
  if (reviewId === '') return { ok: false, error: 'a review id is required' }
  if (companyId === '') return { ok: false, error: 'confirm the intended company before associating' }
  if (!(COMPANY_DIRECTORY_NAMES as readonly string[]).includes(companyId)) {
    return { ok: false, error: 'the confirmed company must be a directory entry' }
  }
  const item = reviewFixtureStore.item(reviewId)
  if (item === undefined) return { ok: false, error: 'no such review item in the local store' }
  if (item.reviewStatus !== 'APPROVED') {
    return { ok: false, error: 'only an APPROVED review item can be associated with a company' }
  }
  const existing = readAll(storage).find((entry) => entry.reviewId === reviewId)
  if (existing !== undefined) return { ok: true, association: existing, duplicate: true }
  const association: CompanyAssociation = {
    reviewId,
    companyId,
    candidateId: item.candidateId,
    sourceRecordId: item.sourceRecordId,
    domain: item.domain,
    decidedAt: input.decidedAt,
    reviewerId: input.reviewerId,
  }
  const next = [...readAll(storage), association]
  if (!writeAll(storage, next)) return { ok: false, error: 'the association could not be persisted' }
  return { ok: true, association, duplicate: false }
}

/** All recorded associations (validated shape only). */
export function listAssociations(storage: AssociationStorage | null = defaultStorage()): readonly CompanyAssociation[] {
  return readAll(storage)
}

/** Associations for one company, newest decision first. */
export function associationsForCompany(
  companyId: string,
  storage: AssociationStorage | null = defaultStorage(),
): readonly CompanyAssociation[] {
  return readAll(storage)
    .filter((entry) => entry.companyId === companyId)
    .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1))
}
