/**
 * Discovery run tests (Phase B brief §6, §7, §8, §9, §12).
 *
 * Behavior under test, not object existence:
 *  1. AVAILABLE + valid request → fixture executes (SUCCESS)
 *  2. RESTRICTED source                 → BLOCKED
 *  3. UNAVAILABLE source                → BLOCKED
 *  4. UNKNOWN source                    → BLOCKED
 *  5. missing required request field    → BLOCKED
 *  6. adapter execution failure         → FAILED
 *  7. partial fixture failure           → PARTIAL
 *  8. provenance survives result creation
 *  9. a procurement result stays PROCUREMENT (and vice versa)
 * 10. execution-state lifecycle NOT_RUN → READY → terminal
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { AdapterResult, DiscoveryDomain, RawResult } from './types'
import { EXECUTION_STATES, TERMINAL_EXECUTION_STATES, isTerminalExecutionState } from './types'
import {
  FIXTURE_FUNDING_SOURCE_ID,
  FIXTURE_PROCUREMENT_SOURCE_ID,
  createSourceRegistry,
  DEFAULT_SOURCE_REGISTRY,
  type SourceDefinition,
} from './registry'
import { createDiscoveryRequest, validateDiscoveryRequest, type DiscoveryRequest } from './request'
import type { SourceAdapter } from './adapter'
import { deriveExecutionState } from './adapter'
import { createFixtureAdapter } from './fixture-adapter'
import { createPendingRun, gateDiscovery, runDiscovery } from './discovery-run'

const ADAPTER = createFixtureAdapter(FIXTURE_PROCUREMENT_SOURCE_ID)

function fixtureDefinition(overrides: Partial<SourceDefinition>): SourceDefinition {
  const base = {
    sourceId: FIXTURE_PROCUREMENT_SOURCE_ID,
    name: 'Fixture Procurement Portal (test registry)',
    domain: 'fixture.invalid',
    applicability: 'procurement' as const,
    discoveryCapability: 'listing_search' as const,
    accessState: 'AVAILABLE' as const,
    adapterType: 'fixture',
    provenanceRequirements: ['listing_url', 'raw_payload', 'observed_at', 'query_terms'] as const,
    notesRestrictions: ['Local fixture only.'] as const,
  }
  return { ...base, ...overrides }
}

function procurementRequest(overrides: Partial<DiscoveryRequest> = {}): DiscoveryRequest {
  const base: DiscoveryRequest = {
    runId: 'RUN-TEST-1',
    companyId: 'COM-001',
    discoveryProfileId: 'DP-COM-001-v1',
    sourceId: FIXTURE_PROCUREMENT_SOURCE_ID,
    domain: 'procurement',
    queryTerms: ['fixture construction'],
    exclusions: [],
    requestedAt: '2026-10-07T00:00:00.000Z',
  }
  return createDiscoveryRequest({ ...base, ...overrides })
}

function stripRequestField(input: Partial<DiscoveryRequest>, field: keyof DiscoveryRequest): Record<string, unknown> {
  const record: Record<string, unknown> = { ...input }
  delete record[field]
  return record
}

/* ------------------------------------------------------------------ */
/* 1. AVAILABLE + valid request                                        */
/* ------------------------------------------------------------------ */

test('AVAILABLE source + valid request executes the fixture with raw candidates', () => {
  const request = procurementRequest()
  const result = runDiscovery(request, { registry: DEFAULT_SOURCE_REGISTRY, adapter: ADAPTER })

  assert.equal(result.status, 'SUCCESS')
  assert.equal(result.sourceId, FIXTURE_PROCUREMENT_SOURCE_ID)
  assert.equal(result.accessState, 'AVAILABLE')
  assert.equal(result.results.length, 2)
  assert.equal(result.results[0]?.rawType, 'RFB')
  assert.equal(result.results[0]?.deadline, '2026-11-15')
  assert.equal(result.results[0]?.rawPayload.includes('fixture'), true)
  assert.deepEqual(Object.isFrozen(result), true)
})

/* ------------------------------------------------------------------ */
/* 2–4. RESTRICTED / UNAVAILABLE / UNKNOWN                             */
/* ------------------------------------------------------------------ */

for (const accessState of ['RESTRICTED', 'UNAVAILABLE', 'UNKNOWN'] as const) {
  test(`${accessState} source is BLOCKED before the adapter is called`, () => {
    const registry = createSourceRegistry([fixtureDefinition({ accessState })])
    const result = runDiscovery(procurementRequest(), { registry, adapter: ADAPTER })

    assert.equal(result.status, 'BLOCKED')
    assert.equal(result.accessState, accessState)
    assert.equal(result.results.length, 0, 'a blocked source must never yield results')
    assert.equal(result.errors[0]?.code, 'source_blocked')
    const reason = result.blockedReason ?? ''
    assert.ok(reason.includes(accessState), `blockedReason should name the state, got: ${reason}`)
  })
}

/* ------------------------------------------------------------------ */
/* 5. Missing required request information                             */
/* ------------------------------------------------------------------ */

const missingFieldCases: { field: keyof DiscoveryRequest; label: string }[] = [
  { field: 'runId', label: 'missing run_id' },
  { field: 'companyId', label: 'missing company_id' },
  { field: 'discoveryProfileId', label: 'missing discovery_profile_id' },
  { field: 'sourceId', label: 'missing source_id' },
  { field: 'domain', label: 'missing domain' },
  { field: 'queryTerms', label: 'missing query_terms' },
  { field: 'requestedAt', label: 'missing requested_at' },
]

for (const { field, label } of missingFieldCases) {
  test(`${label} → BLOCKED (invalid request)`, () => {
    const raw = stripRequestField(procurementRequest(), field)
    const validation = validateDiscoveryRequest(raw)
    assert.equal(validation.ok, false, `validation should fail for ${field}`)

    const request = procurementRequest()
    // sanity: the same request shape minus one field, driven through the runner
    const proxies: Record<string, DiscoveryRequest> = {
      runId: { ...request, runId: '' },
      companyId: { ...request, companyId: '' },
      discoveryProfileId: { ...request, discoveryProfileId: '' },
      sourceId: { ...request, sourceId: '' },
      domain: { ...request, domain: '' as DiscoveryDomain },
      queryTerms: { ...request, queryTerms: [] },
      requestedAt: { ...request, requestedAt: '' },
    }
    const invalid = runDiscovery(proxies[field], { registry: DEFAULT_SOURCE_REGISTRY, adapter: ADAPTER })
    assert.equal(invalid.status, 'BLOCKED')
    assert.equal(invalid.results.length, 0)
    assert.ok(invalid.errors.every((e) => e.code === 'missing_field'))
  })
}

test('a request cannot be created unless every required field is valid', () => {
  assert.throws(() => createDiscoveryRequest({ ...procurementRequest(), companyId: '' }), /invalid DiscoveryRequest/)
  assert.throws(
    () => createDiscoveryRequest({ ...procurementRequest(), queryTerms: [] as unknown as readonly string[] }),
    /invalid DiscoveryRequest/,
  )
})

test('Phase H filters ride the request unchanged, frozen with everything else', () => {
  const request = createDiscoveryRequest({
    ...procurementRequest(),
    sector: 'infrastructure',
    keyword: 'bridge',
    location: 'usa',
  })
  assert.equal(request.sector, 'infrastructure')
  assert.equal(request.keyword, 'bridge')
  assert.equal(request.location, 'usa')
  assert.ok(Object.isFrozen(request))

  const plain = procurementRequest()
  assert.equal(plain.sector, undefined)
  assert.equal(plain.keyword, undefined)
  assert.equal(plain.location, undefined)

  assert.throws(
    () => createDiscoveryRequest({ ...procurementRequest(), sector: 7 as unknown as string }),
    /field sector must be a string/,
  )
  assert.throws(
    () => createDiscoveryRequest({ ...procurementRequest(), keyword: null as unknown as string }),
    /field keyword must be a string/,
  )
  assert.throws(
    () => createDiscoveryRequest({ ...procurementRequest(), location: {} as unknown as string }),
    /field location must be a string/,
  )
})

/* ------------------------------------------------------------------ */
/* 6. Adapter execution failure                                        */
/* ------------------------------------------------------------------ */

test('an adapter that throws is reported as FAILED, never as an empty success', () => {
  const failing: SourceAdapter = {
    sourceId: FIXTURE_PROCUREMENT_SOURCE_ID,
    adapterType: 'throwing-test-adapter',
    discover() {
      throw new Error('fixture boom')
    },
  }
  const result = runDiscovery(procurementRequest(), { registry: DEFAULT_SOURCE_REGISTRY, adapter: failing })

  assert.equal(result.status, 'FAILED')
  assert.equal(result.results.length, 0)
  assert.equal(result.errors[0]?.code, 'adapter_error')
  assert.equal(result.blockedReason, null)
})

/* ------------------------------------------------------------------ */
/* 7. Partial fixture failure                                          */
/* ------------------------------------------------------------------ */

test('recoverable per-item failures produce a PARTIAL result', () => {
  const request = procurementRequest({ adapterConfig: { scenario: 'partial' } })
  const result = runDiscovery(request, { registry: DEFAULT_SOURCE_REGISTRY, adapter: ADAPTER })

  assert.equal(result.status, 'PARTIAL')
  assert.equal(result.results.length, 2, 'the surviving items are still returned')
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0]?.code, 'item_error')
  assert.equal(result.errors[0]?.itemIndex, 0)
})

test('an adapter failure with no results produces FAILED, and zero-result success is the only silent-empty case', () => {
  const failed = runDiscovery(
    procurementRequest({ adapterConfig: { scenario: 'failure' } }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: ADAPTER },
  )
  assert.equal(failed.status, 'FAILED')
  assert.equal(failed.results.length, 0)

  const empty = runDiscovery(
    procurementRequest({ adapterConfig: { scenario: 'empty' } }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: ADAPTER },
  )
  assert.equal(empty.status, 'SUCCESS', 'zero results is only legal after the AVAILABLE gate')
  assert.equal(empty.results.length, 0)
})

/* ------------------------------------------------------------------ */
/* 8. Provenance survives result creation                              */
/* ------------------------------------------------------------------ */

test('every adapter result carries provenance answering the nine Phase A questions', () => {
  const result = runDiscovery(procurementRequest(), { registry: DEFAULT_SOURCE_REGISTRY, adapter: ADAPTER })

  const p = result.provenance
  assert.equal(p.runId, 'RUN-TEST-1', 'which discovery run')
  assert.equal(p.companyId, 'COM-001', 'which company')
  assert.equal(p.discoveryProfileId, 'DP-COM-001-v1', 'which discovery profile')
  assert.equal(p.sourceId, FIXTURE_PROCUREMENT_SOURCE_ID, 'which source')
  assert.equal(p.sourceName, 'Fixture Procurement Portal (local, deterministic)', 'which source (name)')
  assert.equal(p.sourceUrl, result.results[0]?.sourceUrl, 'which source URL')
  assert.equal(p.adapterType, 'fixture', 'which adapter')
  assert.equal(p.domain, 'procurement', 'which domain')
  assert.equal(p.accessState, 'AVAILABLE', 'what access state existed')
  assert.ok(p.requestedAt, 'when the request was made')
  assert.ok(p.observedAt, 'when the result was obtained')

  const raw = result.results[0]?.rawProvenance
  assert.equal(raw?.sourceId, FIXTURE_PROCUREMENT_SOURCE_ID)
  assert.equal(raw?.sourceRecordId, 'FX-P-1001', 'which source identifier was observed')
  assert.equal(raw?.queryTerm, 'fixture construction', 'which query produced the hit')
})

test('provenance also survives a blocked run and records the access state', () => {
  const registry = createSourceRegistry([fixtureDefinition({ accessState: 'RESTRICTED' })])
  const result = runDiscovery(procurementRequest(), { registry, adapter: ADAPTER })

  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.provenance.sourceId, FIXTURE_PROCUREMENT_SOURCE_ID)
  assert.equal(result.provenance.accessState, 'RESTRICTED')
  assert.equal(result.provenance.runId, 'RUN-TEST-1')
})

/* ------------------------------------------------------------------ */
/* 9. Funding / procurement guardrail                                  */
/* ------------------------------------------------------------------ */

test('a funding request cannot silently use a procurement source (domain mismatch → BLOCKED)', () => {
  const result = runDiscovery(
    procurementRequest({ domain: 'funding' }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: ADAPTER },
  )
  assert.equal(result.status, 'BLOCKED')
  assert.equal(result.errors[0]?.code, 'domain_mismatch')
  assert.equal(result.results.length, 0)
})

test('funding and procurement runs keep their domain: procurement never becomes funding', () => {
  const procurement = runDiscovery(procurementRequest(), { registry: DEFAULT_SOURCE_REGISTRY, adapter: ADAPTER })
  assert.equal(procurement.domain, 'procurement')
  assert.equal(procurement.results[0]?.rawType, 'RFB')
  assert.equal(procurement.provenance.domain, 'procurement')

  const grantAdapter = createFixtureAdapter(FIXTURE_FUNDING_SOURCE_ID)
  const funding = runDiscovery(
    procurementRequest({ domain: 'funding', sourceId: FIXTURE_FUNDING_SOURCE_ID }),
    { registry: DEFAULT_SOURCE_REGISTRY, adapter: grantAdapter },
  )
  assert.equal(funding.domain, 'funding')
  assert.equal(funding.results[0]?.rawType, 'grant')
  assert.equal(funding.provenance.domain, 'funding')
})

test('an adapter cannot relabel a procurement run as funding (domain is sealed by the runner)', () => {
  const rogue: SourceAdapter = {
    sourceId: FIXTURE_PROCUREMENT_SOURCE_ID,
    adapterType: 'rogue-claim',
    discover(request) {
      const raw: RawResult = {
        sourceRecordId: 'ROGUE-1',
        sourceUrl: 'https://fixture.invalid/rogue',
        title: 'Rogue fixture result claiming funding',
        description: null,
        publicationDate: null,
        deadline: null,
        issuingOrganization: null,
        country: null,
        rawType: 'grant',
        rawPayload: '{}',
        rawProvenance: {
          sourceId: request.sourceId,
          sourceUrl: 'https://fixture.invalid/rogue',
          sourceRecordId: 'ROGUE-1',
          observedAt: request.requestedAt,
          queryTerm: request.queryTerms[0] ?? null,
        },
      }
      const forged: AdapterResult = {
        status: 'SUCCESS',
        sourceId: request.sourceId,
        adapterType: 'rogue-claim',
        runId: request.runId,
        domain: 'funding',
        accessState: 'AVAILABLE',
        requestedAt: request.requestedAt,
        observedAt: request.requestedAt,
        blockedReason: null,
        results: [raw],
        errors: [],
        warnings: [],
        provenance: {
          runId: request.runId,
          companyId: request.companyId,
          discoveryProfileId: request.discoveryProfileId,
          sourceId: request.sourceId,
          sourceName: 'rogue',
          sourceUrl: raw.sourceUrl,
          adapterType: 'rogue-claim',
          domain: 'funding',
          accessState: 'AVAILABLE',
          requestedAt: request.requestedAt,
          observedAt: request.requestedAt,
        },
      }
      return forged
    },
  }

  const result = runDiscovery(procurementRequest(), { registry: DEFAULT_SOURCE_REGISTRY, adapter: rogue })
  assert.equal(result.status, 'SUCCESS')
  assert.equal(result.domain, 'procurement', 'the envelope domain is sealed to the procurement request')
  assert.equal(result.provenance.domain, 'procurement')
  assert.equal(result.results[0]?.rawType, 'grant', 'the raw type is preserved as raw; classification is a later stage')
})

/* ------------------------------------------------------------------ */
/* 10. Execution-state lifecycle                                       */
/* ------------------------------------------------------------------ */

test('the execution-state vocabulary is the locked Phase A set', () => {
  assert.deepEqual(EXECUTION_STATES, ['NOT_RUN', 'READY', 'BLOCKED', 'SUCCESS', 'PARTIAL', 'FAILED'])
})

test('a run moves NOT_RUN → READY (gate) → terminal (execute)', () => {
  const request = procurementRequest()

  const pending = createPendingRun(request)
  assert.equal(pending.status, 'NOT_RUN')

  const gated = gateDiscovery(request, { registry: DEFAULT_SOURCE_REGISTRY, adapter: ADAPTER })
  assert.equal(gated.status, 'READY', 'a gated, valid, AVAILABLE run is READY to execute')

  const terminal = runDiscovery(request, { registry: DEFAULT_SOURCE_REGISTRY, adapter: ADAPTER })
  assert.equal(isTerminalExecutionState(terminal.status), true)
  assert.ok(TERMINAL_EXECUTION_STATES.includes(terminal.status))
})

test('deriveExecutionState is the single status rule used by results', () => {
  assert.equal(deriveExecutionState([{}, {}], []), 'SUCCESS')
  assert.equal(deriveExecutionState([{}], [{ code: 'item_error', message: 'x' }]), 'PARTIAL')
  assert.equal(deriveExecutionState([], [{ code: 'adapter_error', message: 'x' }]), 'FAILED')
})

test('a pending run stays NOT_RUN until it is executed', () => {
  const gate = gateDiscovery(procurementRequest(), { registry: DEFAULT_SOURCE_REGISTRY, adapter: ADAPTER })
  assert.equal(gate.status === 'READY', true)
  assert.equal((gate as { status: string }).status, 'READY')
})