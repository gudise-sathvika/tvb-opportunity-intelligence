/**
 * GlobalTenders source adapter — Phase J first real source adapter.
 *
 * Verdict up front: GlobalTenders CANNOT be safely queried from this
 * environment, so this adapter performs no retrieval at all. It returns a
 * deterministic BLOCKED AdapterResult that documents exactly why:
 *
 *   1. The Source Registry records SU-GT-001 with access state UNKNOWN and an
 *      explicit restriction: it "must not be queried until access is observed
 *      and authorized". That observation has never happened.
 *   2. globaltenders.com is a commercial, login-gated subscription service
 *      (full listings, documents, and advanced search sit behind Login/Signup
 *      and paid tiers; no public API or authorized machine-retrieval channel
 *      is offered). Fetching listings would bypass access controls, which this
 *      project forbids.
 *   3. The Phase C safety boundary forbids every network primitive in
 *      automation modules — this module is scanned too — so a retrieving
 *      adapter cannot even be expressed here.
 *   4. The access gate (`gateDiscovery`) already BLOCKs UNKNOWN sources before
 *      any adapter call, so binding this adapter changes nothing about what
 *      the pipeline can reach.
 *
 * The adapter is still a real SourceAdapter, not a stub: it validates the
 * request targets SU-GT-001, reads the registry's access state live, and
 * returns the standard BLOCKED envelope (request identity in provenance,
 * `observedAt` from the request — no clock, no randomness, no I/O). Should the
 * registry ever record AVAILABLE out of band, retrieval still refuses: no
 * authorized transport exists in this phase, and the adapter returns BLOCKED
 * rather than fabricate listings. Binding the adapter into demo dependency
 * maps is intentionally left out — the fixture flows stay fixture-only.
 *
 * Boundary notes (Phase C boundary suite scans this module too):
 *  - no network, filesystem, clock, scheduler, or vault write of any kind;
 *  - imports are sibling `src/automation` modules only.
 */

import type { DiscoveryRequest } from './request'
import type { AdapterResult } from './types'
import type { SourceAdapter } from './adapter'
import { blockedResult } from './adapter'
import type { SourceRegistry } from './registry'
import { DEFAULT_SOURCE_REGISTRY, GLOBALTENDERS_ADAPTER_TYPE, GLOBALTENDERS_SOURCE_ID } from './registry'

function blockedUnknownAccess(request: DiscoveryRequest, accessState: string): AdapterResult {
  return blockedResult({
    request,
    sourceName: 'GlobalTenders',
    accessState: 'UNKNOWN',
    adapterType: GLOBALTENDERS_ADAPTER_TYPE,
    reason: `source access state ${accessState} is not AVAILABLE`,
    errors: [
      {
        code: 'source_blocked',
        message:
          `source ${GLOBALTENDERS_SOURCE_ID} has access state ${accessState}: access has never been observed or ` +
          `authorized, full listings require login and a paid subscription, and no public retrieval channel ` +
          `exists — unauthorized sources are never queried`,
      },
    ],
  })
}

function blockedNoTransport(request: DiscoveryRequest): AdapterResult {
  return blockedResult({
    request,
    sourceName: 'GlobalTenders',
    accessState: 'AVAILABLE',
    adapterType: GLOBALTENDERS_ADAPTER_TYPE,
    reason: 'live retrieval transport is not implemented',
    errors: [
      {
        code: 'adapter_error',
        message:
          `source ${GLOBALTENDERS_SOURCE_ID} is AVAILABLE but no authorized retrieval transport exists in this ` +
          `phase — the adapter refuses to fabricate listings`,
      },
    ],
  })
}

export function createGlobalTendersAdapter(
  registry: SourceRegistry = DEFAULT_SOURCE_REGISTRY,
): SourceAdapter {
  return {
    sourceId: GLOBALTENDERS_SOURCE_ID,
    adapterType: GLOBALTENDERS_ADAPTER_TYPE,
    discover(request: DiscoveryRequest): AdapterResult {
      if (request.sourceId !== GLOBALTENDERS_SOURCE_ID) {
        return blockedResult({
          request,
          reason: 'adapter serves GlobalTenders only',
          errors: [
            {
              code: 'adapter_not_available',
              message: `adapter for ${GLOBALTENDERS_SOURCE_ID} cannot serve request for ${request.sourceId}`,
            },
          ],
        })
      }
      const definition = registry.get(GLOBALTENDERS_SOURCE_ID)
      if (definition === undefined) {
        return blockedResult({
          request,
          reason: 'source is not registered',
          errors: [
            {
              code: 'unknown_source',
              message: `no registered source with sourceId ${GLOBALTENDERS_SOURCE_ID}`,
            },
          ],
        })
      }
      if (definition.accessState !== 'AVAILABLE') {
        return blockedUnknownAccess(request, definition.accessState)
      }
      return blockedNoTransport(request)
    },
  }
}
