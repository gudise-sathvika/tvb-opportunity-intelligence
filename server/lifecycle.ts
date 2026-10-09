/**
 * Phase 16 — process lifecycle: readiness state and bounded graceful shutdown.
 *
 * `HostLifecycle` holds the ready/shutting-down flags used by `/health/ready`.
 * `createShutdownController` performs a single, idempotent shutdown: mark not
 * ready → stop accepting connections → drain in-flight requests up to a bounded
 * deadline → close remaining connections → resolve. Duplicate signals share the
 * one in-progress promise, so no competing shutdown procedures run.
 *
 * It performs NO network calls and touches no Vault code.
 */

import type http from 'node:http'

import type { ConcurrencyGate } from './concurrency'

export class HostLifecycle {
  private ready = true
  private shuttingDown = false

  isReady(): boolean {
    return this.ready && !this.shuttingDown
  }

  isShuttingDown(): boolean {
    return this.shuttingDown
  }

  markNotReady(): void {
    this.ready = false
  }

  /** Returns true only for the first call; later calls are no-ops. */
  beginShutdown(): boolean {
    if (this.shuttingDown) return false
    this.shuttingDown = true
    this.ready = false
    return true
  }
}

export interface ShutdownEvidence {
  /** True when all in-flight requests finished before the drain deadline. */
  readonly drained: boolean
  /** True when the deadline elapsed with requests still in flight. */
  readonly forced: boolean
  readonly inFlightAtStart: number
}

export interface ShutdownControllerOptions {
  readonly server: http.Server
  readonly lifecycle: HostLifecycle
  readonly gate: ConcurrencyGate
  readonly drainMs: number
  readonly pollMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly log?: (message: string) => void
  readonly onExit?: (code: number) => void
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function createShutdownController(
  options: ShutdownControllerOptions,
): (signal?: NodeJS.Signals) => Promise<ShutdownEvidence> {
  let inProgress: Promise<ShutdownEvidence> | null = null

  async function run(signal: NodeJS.Signals | undefined): Promise<ShutdownEvidence> {
    const { server, lifecycle, gate, drainMs, pollMs = 25, sleep = defaultSleep, log, onExit } = options
    const inFlightAtStart = gate.inFlight
    lifecycle.markNotReady()
    log?.(`received ${signal ?? 'shutdown'}; refusing new connections and draining up to ${drainMs}ms`)

    const closed = new Promise<void>((resolve) => {
      server.close(() => resolve())
    })

    const deadline = Date.now() + drainMs
    while (gate.inFlight > 0 && Date.now() < deadline) {
      await sleep(pollMs)
    }
    const drained = gate.inFlight === 0
    const forced = inFlightAtStart > 0 && !drained

    // Drop idle keep-alive sockets so `server.close()` can complete; in-flight
    // requests that exceeded the deadline are also destroyed at this point.
    server.closeAllConnections()
    await closed

    if (forced) log?.('drain deadline reached; remaining connections were closed')
    else log?.('all in-flight requests drained')

    onExit?.(0)
    return { drained, forced, inFlightAtStart }
  }

  return (signal?: NodeJS.Signals): Promise<ShutdownEvidence> => {
    if (inProgress !== null) {
      options.log?.('shutdown already in progress; ignoring duplicate signal')
      return inProgress
    }
    if (!options.lifecycle.beginShutdown()) {
      // Should not happen given the guard above, but never start competing shutdowns.
      return Promise.resolve({ drained: false, forced: false, inFlightAtStart: options.gate.inFlight })
    }
    inProgress = run(signal)
    return inProgress
  }
}
