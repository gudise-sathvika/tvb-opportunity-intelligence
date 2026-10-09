/**
 * Phase 15 — validated configuration for the minimal Node.js production host.
 *
 * Every value is read from the server process environment. A value that is
 * PRESENT but invalid (out of range, unparsable, unsafe) makes startup fail
 * with a clear `ConfigError`; protections are never silently disabled by a
 * typo. Unset values fall back to safe defaults.
 *
 * Safety: binds to loopback by default. A non-loopback `TVB_HOST` is rejected
 * unless the operator explicitly opts in with `TVB_ALLOW_NON_LOOPBACK=1`.
 * No secret is read or required: the read-only live bridges use no credentials.
 */

import path from 'node:path'

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export interface HostConfig {
  readonly host: string
  readonly port: number
  readonly distDir: string
  /** Explicit cross-origin allowlist; same-origin requests are always allowed. */
  readonly allowedOrigins: readonly string[]
  readonly rateLimit: {
    readonly windowMs: number
    readonly max: number
    readonly maxKeys: number
  }
  readonly maxBodyBytes: number
  readonly requestTimeoutMs: number
  readonly maxConcurrent: number
  /** Bounded time allowed for in-flight requests to drain on shutdown. */
  readonly drainMs: number
}

interface IntRange {
  readonly min: number
  readonly max: number
}

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number, range: IntRange): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value)) {
    throw new ConfigError(`${name} must be an integer, got "${raw}"`)
  }
  if (value < range.min || value > range.max) {
    throw new ConfigError(`${name} must be between ${range.min} and ${range.max}, got ${value}`)
  }
  return value
}

function readPort(env: NodeJS.ProcessEnv): number {
  const port = readInt(env, 'TVB_PORT', 4174, { min: 1, max: 65535 })
  return port
}

function readHost(env: NodeJS.ProcessEnv): string {
  const host = env['TVB_HOST']?.trim() || '127.0.0.1'
  if (host.includes('/') || host.includes(' ') || host.includes('\0')) {
    throw new ConfigError(`TVB_HOST is not a valid bind address: "${host}"`)
  }
  const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost'
  if (!loopback && env['TVB_ALLOW_NON_LOOPBACK'] !== '1') {
    throw new ConfigError(
      `TVB_HOST="${host}" is not a loopback address. Public binding requires the explicit ` +
        'opt-in TVB_ALLOW_NON_LOOPBACK=1 and an authenticated reverse proxy in front.',
    )
  }
  return host
}

function readOrigins(env: NodeJS.ProcessEnv): string[] {
  const raw = env['TVB_ALLOWED_ORIGINS']
  if (raw === undefined || raw.trim() === '') return []
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '')
    .map((origin) => {
      let url: URL
      try {
        url = new URL(origin)
      } catch {
        throw new ConfigError(`TVB_ALLOWED_ORIGINS entry is not a valid URL origin: "${origin}"`)
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new ConfigError(`TVB_ALLOWED_ORIGINS entry must use http/https: "${origin}"`)
      }
      if (origin.replace(/\/$/, '') !== url.origin) {
        throw new ConfigError(`TVB_ALLOWED_ORIGINS entry must be a bare scheme://host[:port] origin: "${origin}"`)
      }
      return url.origin
    })
}

export function readHostConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): HostConfig {
  return {
    host: readHost(env),
    port: readPort(env),
    distDir: env['TVB_DIST_DIR']?.trim() || path.join(cwd, 'dist'),
    allowedOrigins: readOrigins(env),
    rateLimit: {
      windowMs: readInt(env, 'TVB_RATE_LIMIT_WINDOW_MS', 60_000, { min: 1_000, max: 86_400_000 }),
      max: readInt(env, 'TVB_RATE_LIMIT_MAX', 30, { min: 1, max: 1_000_000 }),
      maxKeys: readInt(env, 'TVB_RATE_LIMIT_MAX_KEYS', 5_000, { min: 1, max: 1_000_000 }),
    },
    maxBodyBytes: readInt(env, 'TVB_MAX_BODY_BYTES', 64 * 1024, { min: 1, max: 1_048_576 }),
    requestTimeoutMs: readInt(env, 'TVB_REQUEST_TIMEOUT_MS', 30_000, { min: 1_000, max: 120_000 }),
    maxConcurrent: readInt(env, 'TVB_MAX_CONCURRENT', 4, { min: 1, max: 1_000 }),
    drainMs: readInt(env, 'TVB_DRAIN_MS', 5_000, { min: 100, max: 60_000 }),
  }
}
