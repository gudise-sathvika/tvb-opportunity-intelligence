/**
 * Phase 14 — bounded, in-memory fixed-window rate limiter for the public host.
 *
 * Bounded memory: the number of distinct client keys retained is capped
 * (`maxKeys`); when a new key arrives at capacity, the oldest inserted key is
 * evicted (Map preserves insertion order), so memory cannot grow without limit.
 *
 * Behavior is documented and deterministic: each key is allowed `max` requests
 * per `windowMs`; the window resets on the first request after it elapses. A
 * rejected request reports `retryAfterMs`. This is an abuse guard, NOT
 * authentication.
 */

export interface RateLimitConfig {
  readonly windowMs: number
  readonly max: number
  readonly maxKeys: number
}

export interface RateLimitDecision {
  readonly allowed: boolean
  readonly remaining: number
  readonly retryAfterMs: number
}

interface WindowEntry {
  count: number
  windowStart: number
}

export class FixedWindowRateLimiter {
  private readonly config: RateLimitConfig
  private readonly hits = new Map<string, WindowEntry>()

  constructor(config: RateLimitConfig) {
    this.config = config
  }

  check(key: string, now: number = Date.now()): RateLimitDecision {
    const { windowMs, max, maxKeys } = this.config
    const existing = this.hits.get(key)
    let entry = existing
    if (entry === undefined || now - entry.windowStart >= windowMs) {
      if (existing === undefined && this.hits.size >= maxKeys) {
        const oldest = this.hits.keys().next().value
        if (oldest !== undefined) this.hits.delete(oldest)
      }
      entry = { count: 0, windowStart: now }
      this.hits.set(key, entry)
    }
    entry.count += 1
    const allowed = entry.count <= max
    return {
      allowed,
      remaining: Math.max(0, max - entry.count),
      retryAfterMs: allowed ? 0 : Math.max(0, windowMs - (now - entry.windowStart)),
    }
  }

  /** Number of distinct client keys currently retained (for tests/observability). */
  get trackedKeys(): number {
    return this.hits.size
  }
}
