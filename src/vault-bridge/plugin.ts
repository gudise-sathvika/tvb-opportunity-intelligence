/**
 * Phase V vault bridge — Vite middleware plugin (dev + preview servers).
 *
 * Mounts two same-origin POST endpoints on both `vite dev` and `vite preview`
 * (the server QA runs):
 *
 *   POST /__tvb/vault/preview   body { item }  → dry-run proposal preview
 *   POST /__tvb/vault/write     body { item }  → the single controlled write
 *
 * The target vault root is read from THIS SERVER'S OWN environment
 * (`TVB_VAULT_ROOT`) on every request — never from the request body or
 * query — so a browser cannot choose where a record is filed, and an
 * unset variable yields an honest `vault_root_not_configured` refusal
 * instead of any default directory. The production vault is only ever
 * targeted when an operator deliberately exports that variable.
 *
 * Route matching, method/Content-Type validation, the bounded body read, the
 * response timeout, and the structured error envelope are delegated to the
 * shared host-independent boundary (`../http-boundary`). NOTE: this write-
 * capable bridge must NOT be mounted on a public production host.
 */

import type { ServerResponse } from 'node:http'

import type { Connect, Plugin } from 'vite'

import { VAULT_BRIDGE_PREVIEW_PATH, VAULT_BRIDGE_WRITE_PATH } from './contract'
import type { VaultBridgeKind } from './contract'
import { dispatchBridgeRequest, BRIDGE_JSON_CONTENT_TYPE } from '../live-source/http-boundary'
import { handleVaultBridge } from './handler'

function extractItem(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return (value as { item?: unknown }).item ?? null
  }
  return null
}

function vaultRoot(): string | null {
  return process.env.TVB_VAULT_ROOT?.trim() || null
}

function route(kind: VaultBridgeKind): (value: unknown) => ReturnType<typeof handleVaultBridge> {
  return (value: unknown) => handleVaultBridge({ kind, item: extractItem(value) }, vaultRoot())
}

const ROUTES = {
  [VAULT_BRIDGE_PREVIEW_PATH]: route('preview'),
  [VAULT_BRIDGE_WRITE_PATH]: route('write'),
}

function send(res: ServerResponse, httpStatus: number, body: unknown): void {
  res.statusCode = httpStatus
  res.setHeader('Content-Type', BRIDGE_JSON_CONTENT_TYPE)
  res.end(JSON.stringify(body))
}

const middleware: Connect.NextHandleFunction = (req, res, next) => {
  void (async () => {
    const result = await dispatchBridgeRequest(req, { routes: ROUTES })
    if (result === null) {
      next()
      return
    }
    send(res, result.httpStatus, result.body)
  })().catch((error: unknown) => {
    send(res, 500, {
      kind: 'write',
      status: 'WRITE_ERROR',
      errors: [{ code: 'bridge_failure', message: String(error) }],
    })
  })
}

export function tvbVaultBridge(): Plugin {
  return {
    name: 'tvb-vault-bridge',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
