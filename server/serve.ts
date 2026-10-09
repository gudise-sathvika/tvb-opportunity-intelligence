/**
 * Phase 14 — minimal Node.js production host entrypoint.
 *
 *   npm run serve            # serves dist/ + the read-only live bridges
 *
 * It binds to loopback by default (`TVB_HOST=127.0.0.1`). The Vault-write
 * bridge is deliberately NOT registered here: this process imports no
 * vault-writer code and exposes no filesystem-write route. Only the TED,
 * USAspending, and Grants.gov read-only handlers are wired in.
 *
 * Run with the project's existing `tsx` runtime (no new dependency, no build
 * step); the project's tsconfigs are `noEmit`, so a TS-to-JS server build is
 * out of scope for this timebox.
 */

import http from 'node:http'
import { pathToFileURL } from 'node:url'

import { handleTedBridge } from '../src/live-source/ted-bridge/handler'
import { TED_BRIDGE_SEARCH_PATH } from '../src/live-source/ted-bridge/contract'
import type { TedBridgeSearchRequest } from '../src/live-source/ted-bridge/contract'
import { handleUsaSpendingBridge } from '../src/live-source/usaspending-bridge/handler'
import { USA_BRIDGE_SEARCH_PATH } from '../src/live-source/usaspending-bridge/contract'
import type { UsaSpendingBridgeSearchRequest } from '../src/live-source/usaspending-bridge/contract'
import { handleGrantsGovBridge } from '../src/live-source/grantsgov-bridge/handler'
import { GRANTS_GOV_BRIDGE_SEARCH_PATH } from '../src/live-source/grantsgov-bridge/contract'
import type { GrantsGovBridgeSearchRequest } from '../src/live-source/grantsgov-bridge/contract'
import { createRequestListener } from './app'
import { ConfigError, readHostConfig } from './config'
import type { HostConfig } from './config'
import { ConcurrencyGate } from './concurrency'
import { createShutdownController, HostLifecycle } from './lifecycle'
import type { ShutdownEvidence } from './lifecycle'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

export interface ProductionHost {
  readonly server: http.Server
  readonly lifecycle: HostLifecycle
  readonly gate: ConcurrencyGate
  shutdown(signal?: NodeJS.Signals): Promise<ShutdownEvidence>
}

export function createProductionServer(config: HostConfig): ProductionHost {
  const lifecycle = new HostLifecycle()
  const gate = new ConcurrencyGate(config.maxConcurrent)
  const listener = createRequestListener({
    distDir: config.distDir,
    bridges: {
      [TED_BRIDGE_SEARCH_PATH]: (value) => handleTedBridge(value as TedBridgeSearchRequest | null),
      [USA_BRIDGE_SEARCH_PATH]: (value) => handleUsaSpendingBridge(value as UsaSpendingBridgeSearchRequest | null),
      [GRANTS_GOV_BRIDGE_SEARCH_PATH]: (value) => handleGrantsGovBridge(value as GrantsGovBridgeSearchRequest | null),
    },
    allowedOrigins: config.allowedOrigins,
    rateLimit: config.rateLimit,
    maxBodyBytes: config.maxBodyBytes,
    timeoutMs: config.requestTimeoutMs,
    lifecycle,
    gate,
  })

  const server = http.createServer(listener)
  server.requestTimeout = config.requestTimeoutMs + 5_000
  server.headersTimeout = config.requestTimeoutMs + 5_000

  const shutdown = createShutdownController({
    server,
    lifecycle,
    gate,
    drainMs: config.drainMs,
    log: (message) => console.log(`[tvb-host] ${message}`),
    onExit: (code) => {
      // Let the event loop finish closing sockets before forcing termination;
      // an immediate exit can abort mid-teardown (notably on Windows).
      process.exitCode = code
      setTimeout(() => process.exit(code), 250)
    },
  })

  return { server, lifecycle, gate, shutdown }
}

function main(): void {
  let config: HostConfig
  try {
    config = readHostConfig()
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : String(error)
    console.error(`[tvb-host] invalid configuration: ${message}`)
    process.exitCode = 1
    return
  }
  const { server, shutdown } = createProductionServer(config)

  server.listen(config.port, config.host, () => {
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : config.port
    console.log(`[tvb-host] listening on http://${config.host}:${port}`)
    console.log(`[tvb-host] serving static assets from ${config.distDir}`)
    console.log(
      `[tvb-host] read-only bridges: ${TED_BRIDGE_SEARCH_PATH}, ${USA_BRIDGE_SEARCH_PATH}, ${GRANTS_GOV_BRIDGE_SEARCH_PATH}`,
    )
    console.log(
      `[tvb-host] limits: maxConcurrent=${config.maxConcurrent}, rateLimit=${config.rateLimit.max}/` +
        `${config.rateLimit.windowMs}ms (in-memory, per-process), maxBodyBytes=${config.maxBodyBytes}, drainMs=${config.drainMs}`,
    )
    if (!LOOPBACK_HOSTS.has(config.host)) {
      console.warn(
        '[tvb-host] WARNING: bound to a non-loopback address. Origin allowlisting and rate ' +
          'limiting are the ONLY controls; there is no authentication. This host is not suitable ' +
          'for public exposure without an authenticated reverse proxy in front.',
      )
    }
  })

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
