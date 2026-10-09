/**
 * Phase V vault bridge — Node-side request handler.
 *
 * This module connects the existing Human Review APPROVED flow to the
 * existing controlled writer WITHOUT a backend service: the Vite dev and
 * preview servers mount it as same-origin middleware (`plugin.ts`), and the
 * browser sends only the review item (`contract.ts`). The target vault root
 * comes from the server's own environment — never from the request — so the
 * browser cannot aim a write at any directory.
 *
 * One request = one explicit action:
 *  - `preview`  → proposal → `previewVaultWrite`: the exact record, errors,
 *    and target path, with zero filesystem mutation;
 *  - `write`    → proposal → `writeVaultRecord`: the single controlled write
 *    (CREATED → SUCCESS, identical file → ALREADY_EXISTS, mismatch → CONFLICT,
 *    validation refusal → VALIDATION_ERROR, filesystem failure → WRITE_ERROR).
 *
 * The writer stays the ONLY write boundary: this module's own filesystem use
 * is read-only (a readdir of the vault's organization folder, so a buyer name
 * can be resolved to a real `[[ORG-### — Name]]` link instead of a guess).
 *
 * Duplicate handling deliberately defers to the writer, which is the only
 * layer that can compare file bytes: the proposal is always built for an
 * approved item, and `writeVaultRecord` classifies the outcome — identical
 * file → ALREADY_EXISTS, divergent file or the same identity at another path
 * → CONFLICT. The writer only ever creates (`wx`), so no path can overwrite.
 */

import fs from 'node:fs'
import path from 'node:path'

import { proposeVaultWrite } from '../automation/approval-write'
import type { OrganizationRef } from '../automation/approval-write'
import type { ReviewItem } from '../automation/review-queue'
import { previewVaultWrite, writeVaultRecord } from '../vault-writer/writer'
import { RECORD_DIRS, idFromTarget, typeForId } from '../types/registry'
import type {
  VaultBridgeError,
  VaultBridgeKind,
  VaultBridgeResponse,
  VaultBridgeStatus,
} from './contract'

/** Writer error codes that mean the filesystem operation itself failed —
 *  surfaced as WRITE_ERROR rather than a validation refusal. */
const FILESYSTEM_ERROR_CODES: ReadonlySet<string> = new Set([
  'write_failed',
  'read_failed',
  'serialization_failed',
  'vault_unreadable',
  'vault_root_missing',
  'vault_root_not_configured',
])

export interface VaultBridgeRequest {
  readonly kind: VaultBridgeKind
  readonly item: unknown
}

export interface VaultBridgeResult {
  readonly httpStatus: number
  readonly body: VaultBridgeResponse
}

function respond(
  kind: VaultBridgeKind,
  status: VaultBridgeStatus,
  errors: readonly VaultBridgeError[],
  fields: {
    recordType?: string | null
    recordId?: string | null
    targetPath?: string | null
    markdown?: string | null
  } = {},
  httpStatus = 200,
): VaultBridgeResult {
  return {
    httpStatus,
    body: {
      kind,
      status,
      recordType: fields.recordType ?? null,
      recordId: fields.recordId ?? null,
      targetPath: fields.targetPath ?? null,
      markdown: fields.markdown ?? null,
      errors,
    },
  }
}

function malformed(kind: VaultBridgeKind, message: string, httpStatus = 400): VaultBridgeResult {
  const status: VaultBridgeStatus = kind === 'write' ? 'VALIDATION_ERROR' : 'REJECTED'
  return respond(kind, status, [{ code: 'malformed_item', message }], {}, httpStatus)
}

/** Failure before/around the writer: preview → REJECTED, write → WRITE_ERROR. */
function bridgeFailure(kind: VaultBridgeKind, code: string, message: string): VaultBridgeResult {
  const status: VaultBridgeStatus = kind === 'write' ? 'WRITE_ERROR' : 'REJECTED'
  return respond(kind, status, [{ code, message }])
}

function mapWriteStatus(
  status: 'CREATED' | 'ALREADY_EXISTS' | 'CONFLICT' | 'REJECTED',
  errors: readonly { code: string }[],
): VaultBridgeStatus {
  if (status === 'CREATED') return 'SUCCESS'
  if (status === 'ALREADY_EXISTS') return 'ALREADY_EXISTS'
  if (status === 'CONFLICT') return 'CONFLICT'
  return errors.some((error) => FILESYSTEM_ERROR_CODES.has(error.code)) ? 'WRITE_ERROR' : 'VALIDATION_ERROR'
}

/** Organization records already in the vault: `ORG-900 — Buyer` → link ref. */
function scanOrganizationRefs(vaultRoot: string): OrganizationRef[] {
  const dir = path.join(vaultRoot, RECORD_DIRS['organization'])
  if (!fs.existsSync(dir)) return []
  const refs: OrganizationRef[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const base = entry.name.slice(0, -'.md'.length)
    const id = idFromTarget(base)
    if (id === null || typeForId(id) !== 'organization') continue
    const separator = base.indexOf(' — ')
    refs.push({ id, name: separator === -1 ? base : base.slice(separator + ' — '.length) })
  }
  return refs
}

export function handleVaultBridge(request: VaultBridgeRequest, vaultRoot: string | null): VaultBridgeResult {
  const kind: VaultBridgeKind = request.kind === 'write' ? 'write' : 'preview'
  const item: unknown = request.item
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return malformed(kind, 'the request body must carry a review item object')
  }

  if (vaultRoot === null || vaultRoot.trim() === '') {
    return bridgeFailure(
      kind,
      'vault_root_not_configured',
      'no vault target is configured for this session — set TVB_VAULT_ROOT on the dev/preview server to an intended vault',
    )
  }

  let organizationRefs: OrganizationRef[]
  try {
    organizationRefs = scanOrganizationRefs(vaultRoot)
  } catch (error) {
    return bridgeFailure(kind, 'read_failed', `could not read the target vault: ${String(error)}`)
  }

  let proposal: ReturnType<typeof proposeVaultWrite>
  try {
    proposal = proposeVaultWrite({
      item: item as ReviewItem,
      // Duplicate/identity classification is the writer's job (it is the only
      // layer that can read file bytes): see the module header.
      existingOpportunityIds: [],
      existingNoticeIds: [],
      existingOrganizationRefs: organizationRefs,
    })
  } catch (error) {
    return malformed(kind, `the review item could not be evaluated: ${String(error)}`)
  }

  if (proposal.decision === 'rejected') {
    const status: VaultBridgeStatus = kind === 'write' ? 'VALIDATION_ERROR' : 'REJECTED'
    return respond(kind, status, [{ code: 'rejected', message: proposal.reason }])
  }

  if (proposal.decision === 'conflict') {
    const status: VaultBridgeStatus = kind === 'write' ? 'CONFLICT' : 'REJECTED'
    return respond(
      kind,
      status,
      [{ code: 'record_conflict', message: proposal.reason }],
      { recordType: proposal.targetType, recordId: proposal.recordId },
    )
  }

  const writeRequest = {
    recordType: proposal.targetType,
    recordId: proposal.recordId,
    payload: proposal.payload,
    approval: {
      decisionId: proposal.approval.reviewId,
      approvedBy: proposal.approval.reviewerId,
      decidedAt: proposal.approval.decidedAt,
    },
  }
  const target = { vaultRoot }

  if (kind === 'preview') {
    const preview = previewVaultWrite(writeRequest, target)
    return respond(
      kind,
      preview.status,
      preview.errors,
      {
        recordType: preview.recordType,
        recordId: preview.recordId,
        targetPath: preview.targetPath,
        markdown: preview.markdown,
      },
    )
  }

  const write = writeVaultRecord(writeRequest, target)
  return respond(
    kind,
    mapWriteStatus(write.status, write.errors),
    write.errors,
    {
      recordType: write.recordType,
      recordId: write.recordId,
      targetPath: write.targetPath,
      markdown: write.markdown,
    },
  )
}
