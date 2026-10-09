/**
 * Phase 15 — bounded, queue-free concurrency gate for the public host.
 *
 * At most `max` bridge requests may be in flight. There is NO queue: excess
 * requests are rejected immediately by the caller with a structured overload
 * response. Every acquire must be paired with a `release()` in a `finally` so a
 * completed, failed, timed-out, or aborted request always returns its slot.
 *
 * Node runs the request listener on a single thread, so `tryAcquire`/`release`
 * are atomic with respect to each other; no lock is required.
 */

export interface ConcurrencyConfig {
  readonly max: number
}

export class ConcurrencyGate {
  private readonly max: number
  private active = 0

  constructor(max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error('concurrency limit must be a positive integer')
    }
    this.max = max
  }

  tryAcquire(): boolean {
    if (this.active >= this.max) return false
    this.active += 1
    return true
  }

  release(): void {
    if (this.active > 0) this.active -= 1
  }

  /** Number of slots currently held (for tests/observability). */
  get inFlight(): number {
    return this.active
  }
}
