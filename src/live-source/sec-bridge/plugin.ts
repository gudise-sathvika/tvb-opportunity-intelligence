/**
 * Phase 08 SEC bridge — Vite middleware plugin (dev + preview servers).
 *
 * Mounts one same-origin POST endpoint on both `vite dev` and `vite preview`:
 *
 *   POST /__tvb/sec/enrich  body { runId, companyId, legalName, [cik], requestedAt }
 *                           → raw EDGAR ticker-file and/or submissions bodies back
 *
 * The live SEC GETs happen only in `handler.ts` on THIS server; the browser
 * never talks to sec.gov directly. Route matching, validation, the bounded
 * body read, the response timeout, and the structured error envelope are all
 * delegated to the shared host-independent boundary (`../http-boundary`).
 */

import type { ServerResponse } from 'node:http'

import type { Connect, Plugin } from 'vite'

import { SEC_BRIDGE_ENRICH_PATH } from './contract'
import type { SecBridgeEnrichRequest } from './contract'
import { dispatchBridgeRequest, BRIDGE_JSON_CONTENT_TYPE } from '../http-boundary'
import { handleSecEnrichBridge } from './handler'

function send(res: ServerResponse, httpStatus: number, body: unknown): void {
  res.statusCode = httpStatus
  res.setHeader('Content-Type', BRIDGE_JSON_CONTENT_TYPE)
  res.end(JSON.stringify(body))
}

const ROUTES = {
  [SEC_BRIDGE_ENRICH_PATH]: (value: unknown) => handleSecEnrichBridge(value as SecBridgeEnrichRequest | null),
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

export function tvbSecBridge(): Plugin {
  return {
    name: 'tvb-sec-bridge',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
