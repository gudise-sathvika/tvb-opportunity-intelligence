/**
 * Phase 06 GLEIF bridge — Vite middleware plugin (dev + preview servers).
 *
 * Mounts one same-origin POST endpoint on both `vite dev` and `vite preview`:
 *
 *   POST /__tvb/gleif/search  body { runId, companyId, query, limit, requestedAt }
 *                             → one real read-only LEI search, raw body back
 *
 * The live GLEIF GET happens only in `handler.ts` on THIS server; the browser
 * never talks to the source directly (the source offers no CORS headers).
 *
 * Route matching, method/Content-Type validation, the bounded body read, the
 * response timeout, and the structured error envelope are all delegated to the
 * shared host-independent boundary (`../http-boundary`).
 */

import type { ServerResponse } from 'node:http'

import type { Connect, Plugin } from 'vite'

import { GLEIF_BRIDGE_SEARCH_PATH } from './contract'
import type { GleifBridgeSearchRequest } from './contract'
import { dispatchBridgeRequest, BRIDGE_JSON_CONTENT_TYPE } from '../http-boundary'
import { handleGleifBridge } from './handler'

function send(res: ServerResponse, httpStatus: number, body: unknown): void {
  res.statusCode = httpStatus
  res.setHeader('Content-Type', BRIDGE_JSON_CONTENT_TYPE)
  res.end(JSON.stringify(body))
}

const ROUTES = {
  [GLEIF_BRIDGE_SEARCH_PATH]: (value: unknown) => handleGleifBridge(value as GleifBridgeSearchRequest | null),
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
    send(res, 500, { ok: false, error: { code: 'bridge_failure', message: String(error) } })
  })
}

export function tvbGleifBridge(): Plugin {
  return {
    name: 'tvb-gleif-bridge',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
