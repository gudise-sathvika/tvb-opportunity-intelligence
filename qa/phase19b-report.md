# Phase 19B Report — Grants.gov Read-Only Bridge

Status: **Complete.** Added a same-origin read-only Grants.gov bridge (contract,
handler, Vite middleware plugin, standalone-host route) and registered
`SU-GRANTS-001` as a funding-opportunity source. The bridge reuses the Phase 19A
adapter's query planner and the existing single live transport; it performs one
unauthenticated read-only POST to the official endpoint and returns the raw
status + body unchanged. No UI, Discovery store, orchestrator, Vault, generated
snapshot, or USAspending classification was changed.

Timebox: completed within the 20-minute budget.

## Files changed

- **new** `src/live-source/grantsgov-bridge/contract.ts` — dependency-free
  contract: `GRANTS_GOV_BRIDGE_SEARCH_PATH = '/__tvb/grantsgov/search'`,
  request/response types.
- **new** `src/live-source/grantsgov-bridge/handler.ts` — Node-side handler
  (mirrors the USAspending/TED handler).
- **new** `src/live-source/grantsgov-bridge/plugin.ts` — Vite dev + preview
  middleware (mirrors the USAspending plugin).
- **new** `src/live-source/grantsgov-bridge/handler.test.ts` — 9 offline bridge
  tests.
- **edited** `vite.config.ts` — mount `tvbGrantsGovBridge()`.
- **edited** `server/serve.ts` — register the route in the standalone host
  bridge allowlist + update the header comment and startup log.
- **edited** `src/automation/registry.ts` — add `GRANTS_GOV_SOURCE_ID` /
  `GRANTS_GOV_ADAPTER_TYPE` and the `SU-GRANTS-001` seed entry (access state
  `UNKNOWN`).
- **edited** `src/automation/grantsgov-adapter.ts` — import + re-export the
  source id / adapter type from the registry (single source of truth; matches
  the TED adapter convention). No behavior change.
- **edited** `src/automation/registry.test.ts` — registry size 5 → 6 and a new
  Grants.gov registration assertion.
- **edited** `package.json` — add `src/live-source/grantsgov-bridge/*.test.ts`
  to the `test:live` glob.

## What was implemented

- **Endpoint / no-auth preserved:** the handler posts to the fixed
  `GRANTS_GOV_SEARCH_ENDPOINT` (`https://api.grants.gov/v1/api/search2`) via
  `createFetchTransport` — the codebase's single live network caller. The request
  body carries no credential; the browser can never redirect the host.
- **Adapter reuse:** the query is built with the real adapter planner
  (`buildGrantsGovQueryPlan`) and body builder (`buildGrantsGovSearchBody`), so
  keyword / `oppStatuses` / `rows` limits match the adapter exactly. Validation
  defects (empty keyword, unusable status filter) return explicit `invalid_request`
  **before** any upstream call.
- **Raw relay / status preservation:** the response status + body are returned
  unchanged; normalizing `oppStatus` and provenance stays the adapter's job in
  the browser, exactly like TED/USAspending. A non-2xx source status is surfaced
  with its real status; a transport throw becomes a `502 source_failure` — never
  an empty success.
- **Registry:** `SU-GRANTS-001` registered as `applicability: 'funding'`,
  `discoveryCapability: 'listing_search'`, `domain: 'api.grants.gov'`, described
  explicitly as grant **opportunities**, not historical awards. USAspending's
  classification is untouched.
- **Access state honesty:** `accessState: 'UNKNOWN'` — the endpoint is documented
  as public, but no verified read-only search has been observed, so access is
  never assumed AVAILABLE (promote in a later phase after an observed query).

## Hard boundaries honored

- No UI, Discovery store, orchestrator, Vault, or production data changed;
  grantsgov is not wired into any discovery flow yet.
- No "open opportunity" verdict and no TVB-company eligibility is computed or
  implied; the bridge only relays the source response.
- No Vault-write route exposed; the shared boundary (`dispatchBridgeRequest`,
  body cap, timeout, origin/rate/concurrency controls) is reused unchanged.
- No credentials, no retries, no unrelated refactors.

## Verification (exact commands and results)

| Command | Result |
|---|---|
| `npx tsx --test src/live-source/grantsgov-bridge/handler.test.ts src/automation/grantsgov-adapter.test.ts src/automation/registry.test.ts` | **40 passed / 0 failed** |
| `npx tsx --test src/live-source/grantsgov-bridge/handler.test.ts` | **9 passed / 0 failed** |
| `npm run test:automation` | **319 passed / 0 failed** (was 318; +1 registry assertion) |
| `npm run test:live` | **73 passed / 0 failed** (includes the 9 new bridge tests) |
| `npm run typecheck` (`tsc -b`) | clean, no errors |
| `npm run build` | **succeeded in 4.72s** |
| `npm run test:qa` | **367 passed / 3 skipped / 0 failed** (4.8m) |

Snapshot integrity: `src/data/generated/opportunity-data.json` md5 still
`17cfae825e1de5320705b066effec15b`; fixture md5 still
`06713f2dcc9a680301eea64e3013e32e`.

All bridge tests are offline: every test injects a local transport stub; no test
makes a network call or writes to the vault. The fixture body is constructed
from the official documented `search2` schema.

Bridge test coverage: valid request → one POST to the official endpoint with raw
body back; forwarded body carries `keyword`/`rows`/default `oppStatuses`; explicit
status filter overrides the default; empty `oppHits` relayed as success, not
failure; raw body (status field) preserved; malformed/blank/missing-field
requests rejected with no upstream call; unusable status filter rejected before
any call; transport throw → `502 source_failure`; non-2xx source status surfaced
with raw status + body.

## Unfinished work / next phases (not started)

- Live store (`live-grantsgov-discovery.ts`) and Discovery UI wiring.
- Promote `SU-GRANTS-001` to `AVAILABLE` only after a verified read-only live
  search, and record the verification date as a fact.
- Future-close-date validation, timezone handling, and confirmed-vs-inferred
  eligibility gating.
- An end-to-end live smoke (requires an approved live call).

## Blockers

None. The official endpoint's rate-limit/fair-use terms remain unverified and
should be confirmed before any live Grants.gov call.
