/**
 * Phase 4 TED bridge — Vite middleware plugin (dev + preview servers).
 *
 * Mounts one same-origin POST endpoint on both `vite dev` and `vite preview`
 * (the server QA runs):
 *
 *   POST /__tvb/ted/search  body { runId, companyId, keyword, publishedSince, limit, requestedAt }
 *                           → one real read-only source search, raw body back
 *
 * The live TED POST happens only in `handler.ts` on THIS server; the browser
 * never talks to the source directly (the source offers no CORS headers), so
 * the control panel's live button stays same-origin and entirely testable.
 *
 * Route matching, method/Content-Type validation, the bounded body read, the
 * response timeout, and the structured error envelope are all delegated to the
 * shared host-independent boundary (`../http-boundary`).
 */

import type { ServerResponse } from 'node:http'

import type { Connect, Plugin } from 'vite'

import { TED_BRIDGE_SEARCH_PATH } from './contract'
import type { TedBridgeSearchRequest } from './contract'
import { dispatchBridgeRequest, BRIDGE_JSON_CONTENT_TYPE } from '../http-boundary'
import { handleTedBridge } from './handler'

function send(res: ServerResponse, httpStatus: number, body: unknown): void {
  res.statusCode = httpStatus
  res.setHeader('Content-Type', BRIDGE_JSON_CONTENT_TYPE)
  res.end(JSON.stringify(body))
}

const ROUTES = {
  [TED_BRIDGE_SEARCH_PATH]: (value: unknown) =>
    handleTedBridge(value as TedBridgeSearchRequest | null),
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

export function tvbTedBridge(): Plugin {
  return {
    name: 'tvb-ted-bridge',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
