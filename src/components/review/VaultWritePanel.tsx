import { useState } from 'react'
import type { ReviewItem } from '../../automation/review-queue'
import type { VaultBridgeResponse, VaultBridgeStatus } from '../../vault-bridge/contract'
import { VAULT_BRIDGE_PREVIEW_PATH, VAULT_BRIDGE_WRITE_PATH } from '../../vault-bridge/contract'

/**
 * Phase V: the explicit write step for an APPROVED review item.
 *
 * Rendered only for approved items (terminal decisions show no review
 * actions), and it never writes on its own — approval, page load, discovery,
 * and opening the preview all perform zero filesystem work. The only action
 * that creates a record is a click on "Write to Vault", and that button is
 * enabled only after a READY preview of the exact record. The request body
 * carries just the item; the server names the vault (see `contract.ts`).
 *
 * Result states are exactly the brief's display values: SUCCESS,
 * ALREADY_EXISTS, CONFLICT, VALIDATION_ERROR, WRITE_ERROR.
 */

const WRITE_RESULT_SUMMARY: Record<VaultBridgeStatus, string> = {
  SUCCESS: 'The record was created.',
  ALREADY_EXISTS: 'An identical record already exists — nothing was overwritten.',
  CONFLICT: 'The record identity conflicts with an existing record — nothing was written.',
  VALIDATION_ERROR: 'The record did not pass validation — nothing was written.',
  WRITE_ERROR: 'The filesystem write could not be completed — nothing was written.',
  READY: 'The record is ready to write.',
  REJECTED: 'The record was rejected — nothing was written.',
}

export default function VaultWritePanel({ item }: { item: ReviewItem }) {
  const [preview, setPreview] = useState<VaultBridgeResponse | null>(null)
  const [result, setResult] = useState<VaultBridgeResponse | null>(null)
  const [busy, setBusy] = useState<'preview' | 'write' | null>(null)
  const [transportError, setTransportError] = useState<string | null>(null)

  const post = async (path: string): Promise<VaultBridgeResponse> => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item }),
    })
    const body = (await response.json()) as VaultBridgeResponse
    if (typeof body.status !== 'string' || !Array.isArray(body.errors)) {
      throw new Error('the vault bridge returned an unexpected response')
    }
    return body
  }

  const runPreview = async () => {
    setBusy('preview')
    setTransportError(null)
    try {
      setPreview(await post(VAULT_BRIDGE_PREVIEW_PATH))
      setResult(null)
    } catch (cause) {
      setTransportError(cause instanceof Error ? cause.message : 'The preview request failed.')
    } finally {
      setBusy(null)
    }
  }

  const runWrite = async () => {
    setBusy('write')
    setTransportError(null)
    try {
      setResult(await post(VAULT_BRIDGE_WRITE_PATH))
    } catch (cause) {
      setTransportError(cause instanceof Error ? cause.message : 'The write request failed.')
    } finally {
      setBusy(null)
    }
  }

  const writeEnabled = busy === null && preview !== null && preview.status === 'READY'

  return (
    <section className="card">
      <h2 className="card__title">Vault write</h2>
      <p className="card__note">
        An approved review can be filed as a Vault record, but only by an explicit action.
        Preview shows the exact record — type, path, Markdown, and any validation errors —
        and writes nothing. Only “Write to Vault” (enabled after a READY preview) creates a
        file, exactly once.
      </p>

      <div className="rv-actions" role="group" aria-label="Vault write">
        <button
          type="button"
          className="btn rv-btn rv-btn--approve"
          disabled={busy !== null}
          onClick={() => void runPreview()}
        >
          Preview Vault Write
        </button>
        <button
          type="button"
          className="btn rv-btn rv-btn--approve"
          disabled={!writeEnabled}
          onClick={() => void runWrite()}
        >
          Write to Vault
        </button>
      </div>

      {preview !== null ? (
        <div className="vaultwrite-preview">
          <dl className="fields">
            <FieldRow label="Preview status" value={preview.status} />
            {preview.recordType !== null ? (
              <FieldRow label="Target record type" value={preview.recordType} />
            ) : null}
            {preview.recordId !== null ? <FieldRow label="Record ID" value={preview.recordId} /> : null}
            {preview.targetPath !== null ? <FieldRow label="Target path" value={preview.targetPath} /> : null}
          </dl>
          {preview.markdown !== null ? <pre className="vaultwrite-md">{preview.markdown}</pre> : null}
          {preview.errors.length > 0 ? <ErrorList heading="Validation errors" errors={preview.errors} /> : null}
        </div>
      ) : null}

      {result !== null ? (
        <div
          className={result.status === 'SUCCESS' ? 'rv-message rv-message--saved' : 'rv-message rv-message--error'}
          role={result.status === 'SUCCESS' || result.status === 'ALREADY_EXISTS' ? 'status' : 'alert'}
        >
          <strong>{result.status}</strong> — {WRITE_RESULT_SUMMARY[result.status]}
          {result.targetPath !== null ? <> Path: {result.targetPath}.</> : null}
          {result.errors.length > 0 ? <ErrorList errors={result.errors} /> : null}
        </div>
      ) : null}

      {transportError !== null ? (
        <p className="rv-message rv-message--error" role="alert">
          {transportError}
        </p>
      ) : null}
    </section>
  )
}

function ErrorList({
  heading,
  errors,
}: {
  heading?: string
  errors: readonly { code: string; field?: string; message: string }[]
}) {
  return (
    <div className="rv-message rv-message--error" role="alert">
      {heading !== undefined ? <strong>{heading}</strong> : null}
      <ul className="vaultwrite-errors">
        {errors.map((error, index) => (
          <li key={`${error.code}-${String(index)}`}>
            {error.code}
            {error.field !== undefined ? ` (${error.field})` : ''}: {error.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="fields__row">
      <dt className="fields__key">{label}</dt>
      <dd className="fields__value">{value}</dd>
    </div>
  )
}
