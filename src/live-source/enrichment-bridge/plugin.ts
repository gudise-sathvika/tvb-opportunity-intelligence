/**
 * Vite plugin exposing the Firecrawl & Company Enrichment bridge.
 *
 * Exposes:
 *   POST /__tvb/enrichment/enrich
 *   POST /__tvb/enrichment/batch
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  ENRICHMENT_BRIDGE_BATCH_PATH,
  ENRICHMENT_BRIDGE_ENRICH_PATH,
  type BatchCompanyEnrichmentRequest,
  type CompanyEnrichmentRequest,
} from './contract'
import { enrichTargetCompany, handleBatchCompanyEnrichment } from './handler'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function respondJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

export function tvbEnrichmentBridge(): Plugin {
  return {
    name: 'tvb-enrichment-bridge',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST') return next()

        if (req.url === ENRICHMENT_BRIDGE_ENRICH_PATH) {
          try {
            const raw = await readBody(req)
            const payload = JSON.parse(raw) as CompanyEnrichmentRequest
            const answer = await enrichTargetCompany(payload)
            respondJson(res, answer.status, answer)
          } catch (err) {
            respondJson(res, 500, { ok: false, status: 500, profile: null, errors: [String(err)] })
          }
          return
        }

        if (req.url === ENRICHMENT_BRIDGE_BATCH_PATH) {
          try {
            const raw = await readBody(req)
            const payload = JSON.parse(raw) as BatchCompanyEnrichmentRequest
            const answer = await handleBatchCompanyEnrichment(payload)
            respondJson(res, answer.status, answer)
          } catch (err) {
            respondJson(res, 500, { ok: false, status: 500, profiles: [], errors: [String(err)] })
          }
          return
        }

        next()
      })
    },
  }
}
