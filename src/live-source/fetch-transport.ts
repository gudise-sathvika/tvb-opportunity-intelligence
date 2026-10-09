/**
 * Live HTTP transport for the TED adapter — Phase U.
 *
 * This is the ONE module in this codebase that performs a live network call.
 * It sits outside `src/automation/` so the side-effect-free automation
 * framework (and every boundary test that guards it) stays untouched: the
 * adapter receives this transport by injection and never contains a network
 * primitive itself.
 *
 * Behaviour is deliberately minimal: one POST, a hard timeout, no retries, no
 * caching, no authentication, no robots/access-control circumvention, no
 * document downloads. The response is returned as status + body text exactly
 * as received; interpreting it is the adapter's job.
 */

import type { TedTransport } from '../automation/ted-adapter'

export interface FetchTransportOptions {
  /** Hard per-request timeout. One bounded attempt; never retried. */
  readonly timeoutMs?: number
}

export function createFetchTransport(options: FetchTransportOptions = {}): TedTransport {
  const timeoutMs = options.timeoutMs ?? 20_000
  return (url, init) => {
    const response = globalThis.fetch(url, {
      method: init.method,
      headers: { ...init.headers },
      body: init.body,
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.then(async (pending) => ({
      status: pending.status,
      body: await pending.text(),
    }))
  }
}
