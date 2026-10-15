/**
 * Phase 01C — Discovery real/demo isolation.
 *
 * The Discovery page can drive two very different things:
 *  - REAL live-source adapters (Grants.gov, EU SEDIA, TED) — genuine read-only
 *    searches against official public sources; and
 *  - FIXTURE scenarios — local, deterministic demonstration records.
 *
 * Fixture scenarios must never be presented as genuine production discoveries,
 * so they are reachable ONLY through an explicit demo opt-in (`?demo=1`). The
 * default (no flag) is real mode, where fixture scenario controls are not
 * offered at all. This module is PURE: no network, clock, storage, or React.
 */

export const DISCOVERY_DEMO_PARAM = 'demo'
export const DISCOVERY_DEMO_VALUE = '1'

export type DiscoverySourceMode = 'real' | 'demo'

export interface DiscoverySource {
  /** `real` (default) hides fixture scenarios; `demo` enables them. */
  readonly mode: DiscoverySourceMode
  /** Whether fixture scenario runs are permitted. */
  readonly demo: boolean
}

/** Non-empty opt-in only: `1` enables demo mode; anything else stays real. */
export function isDemoDiscoveryRequest(value: string | null | undefined): boolean {
  return value === DISCOVERY_DEMO_VALUE
}

/** Resolves the Discovery mode from the raw `?demo` value. Real by default. */
export function resolveDiscoverySource(value: string | null | undefined): DiscoverySource {
  const demo = isDemoDiscoveryRequest(value)
  return Object.freeze({ mode: demo ? 'demo' : 'real', demo })
}
