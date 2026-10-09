/**
 * Shared contract between the browser UI and the Phase V vault bridge.
 *
 * This module is the ONLY slice of the bridge the browser app may import: it
 * is dependency-free (types plus two endpoint constants) and contains no
 * filesystem, network, writer, or node code. The Node side lives in
 * `handler.ts` (business logic) and `plugin.ts` (HTTP middleware on the Vite
 * dev and preview servers); the browser reaches it with a plain `fetch` to
 * these same-origin endpoints.
 *
 * Safety invariants encoded here:
 *  - the request body carries only the review item; the target vault root is
 *    NEVER chosen by the browser (the server reads it from its own
 *    environment, and reports `vault_root_not_configured` when unset);
 *  - `status` is exactly one of the brief's display values: for previews
 *    READY/REJECTED, for writes SUCCESS/ALREADY_EXISTS/CONFLICT/
 *    VALIDATION_ERROR/WRITE_ERROR.
 */

export type VaultBridgeKind = 'preview' | 'write'

export type VaultBridgePreviewStatus = 'READY' | 'REJECTED'

export type VaultBridgeWriteStatus =
  | 'SUCCESS'
  | 'ALREADY_EXISTS'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'WRITE_ERROR'

export type VaultBridgeStatus = VaultBridgePreviewStatus | VaultBridgeWriteStatus

export interface VaultBridgeError {
  readonly code: string
  readonly field?: string
  readonly message: string
}

export interface VaultBridgeResponse {
  readonly kind: VaultBridgeKind
  readonly status: VaultBridgeStatus
  /** `notice` / `opportunity`, or null when the proposal never resolved. */
  readonly recordType: string | null
  readonly recordId: string | null
  /** Vault-relative path with forward slashes, or null when never resolved. */
  readonly targetPath: string | null
  /** The exact Markdown that was (or would have been) written. */
  readonly markdown: string | null
  readonly errors: readonly VaultBridgeError[]
}

export const VAULT_BRIDGE_PREVIEW_PATH = '/__tvb/vault/preview'
export const VAULT_BRIDGE_WRITE_PATH = '/__tvb/vault/write'
