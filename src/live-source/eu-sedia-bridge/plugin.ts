/**
 * Phase 21C EU Funding & Tenders Portal (SEDIA) bridge — Vite middleware plugin.
 *
 * Mounts one same-origin POST endpoint on both `vite dev` and `vite preview`:
 *
 *   POST /__tvb/eu/search  body { runId, companyId, keyword, limit, requestedAt }
 *                          → one real read-only source search, raw body back
 *
 * Route matching, method/Content-Type validation, the bounded body read, the
 * response timeout, and the structured error envelope are delegated to the
 * shared boundary (`../http-boundary`).
 */

import type { ServerResponse } from 'node:http'

import type { Connect, Plugin } from 'vite'

import { EU_SEDIA_BRIDGE_SEARCH_PATH } from './contract'
import type { EuSediaBridgeSearchRequest } from './contract'
import { dispatchBridgeRequest, BRIDGE_JSON_CONTENT_TYPE } from '../http-boundary'
import { handleEuSediaBridge } from './handler'

function send(res: ServerResponse, httpStatus: number, body: unknown): void {
  res.statusCode = httpStatus
  res.setHeader('Content-Type', BRIDGE_JSON_CONTENT_TYPE)
  res.end(JSON.stringify(body))
}

const ROUTES = {
  [EU_SEDIA_BRIDGE_SEARCH_PATH]: (value: unknown) =>
    handleEuSediaBridge(value as EuSediaBridgeSearchRequest | null),
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

export function tvbEuSediaBridge(): Plugin {
  return {
    name: 'tvb-eu-sedia-bridge',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
