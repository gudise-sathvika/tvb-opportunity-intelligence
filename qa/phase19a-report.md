# Phase 19A Report — Grants.gov Adapter Foundation

Status: **Complete.** Added a pure Grants.gov funding-opportunity adapter and
its offline unit tests. It uses the official no-auth `search2` endpoint, maps
official ids/titles/URLs/statuses/dates without inventing missing fields, and
computes **no** "is currently open" verdict. No bridge, store, registry entry,
UI, or orchestration wiring was added (deferred by design).

Timebox: completed within the 20-minute budget.

## Files changed

- **new** `src/automation/grantsgov-adapter.ts` — the adapter.
- **new** `src/automation/grantsgov-adapter.test.ts` — 18 focused offline tests.
- **edited** `src/automation/types.ts` — one **additive, optional** field on the
  shared `RawResult` contract: `sourceStatus?: string | null`. It records a
  source-published lifecycle status (Grants.gov `oppStatus`) when a source
  defines one; absent for USAspending/TED/fixtures. No other adapter sets it, so
  existing behavior and object shapes are unchanged (the safety-boundary test
  that pins the fixture result's exact keys still passes).

## What was implemented

- **Endpoint:** `POST https://api.grants.gov/v1/api/search2`
  (`GRANTS_GOV_SEARCH_ENDPOINT`). Documented as requiring no authentication and
  no API key; the adapter sends **no** credential (`keyword`/`rows`/`oppStatuses`
  only, asserted in tests).
- **Query plan:** keyword from `request.keyword` (falling back to
  `queryTerms[0]`); `rows` from `adapterConfig.rows|limit` clamped 1–100;
  `oppStatuses` defaults to `posted|forecasted`, overridable via
  `adapterConfig.oppStatuses` (`|`- or array-joined). An empty search term, or a
  status filter containing no recognized status, fails `invalid_request`
  **before** any source call. Unsupported filters (sector/location/exclusions)
  produce explicit warnings, never silent drops.
- **Normalization (`parseGrantsGovBody`):**
  - `id` → `sourceRecordId`; `sourceUrl` = `https://www.grants.gov/search-results-detail/<id>`
    (the official detail page; verified against live Grants.gov detail URLs).
  - `title` → `title`, falling back to the official `number`; if neither exists,
    an `item_error` (no fabricated title).
  - `agencyName` → `issuingOrganization`; missing stays `null`.
  - `openDate` → `publicationDate`; `closeDate` → `deadline`. Dates are preserved
    **verbatim** (not reformatted), and a blank/missing date is `null` — no
    invented or normalized dates at this layer.
  - `oppStatus` → `sourceStatus` via `normalizeGrantsGovStatus`: the four
    official statuses pass through; anything else (`OPEN`, blank, missing,
    non-string, array) becomes `unknown` **with a warning**, never `posted`.
  - `rawType: 'grant_opportunity'`; `country: 'US'`; full `rawPayload` +
    `rawProvenance` preserved.
  - A non-zero source `errorcode` becomes an `adapter_error` (never an empty
    success); `data.errorMsgs` and `hitCount` surface as warnings.
- **Envelope (mirrors TED/USAspending):** one read-only POST; `retrieve()`/`discover()`
  two-phase pattern for async transports; 401/403 → `BLOCKED`/`RESTRICTED`;
  429/non-2xx/transport throw → `FAILED`; empty 200 → `SUCCESS` with 0 results.
- **Registry posture:** registry lookup is optional. With an `options.registry`,
  a missing entry or non-`AVAILABLE` state is `BLOCKED`; without one (this
  foundation phase ships before the registry entry), the adapter uses the
  built-in name and treats the source as `AVAILABLE`. No registry file was
  modified.

## Hard boundaries honored

- No UI, Vault, generated snapshot, USAspending behavior, or production data
  changed. `src/data/generated/opportunity-data.json` md5 still
  `17cfae825e1de5320705b066effec15b`.
- No bridge, store, or orchestration wiring added.
- The adapter does **not** mark anything open. It records `sourceStatus` and
  close dates only; a `closed` record stays `closed` in the results, and a test
  asserts no `isOpen`/`open` field is produced. Future-close-date validation and
  final eligibility gating remain for a later phase.
- No fake opportunities, fabricated dates, or invented response fields.

## Verification (exact commands and results)

| Command | Result |
|---|---|
| `npx tsx --test src/automation/grantsgov-adapter.test.ts` | **18 passed / 0 failed** |
| `npm run test:automation` | **318 passed / 0 failed** (was 300; +18 new) |
| `npm run typecheck` (`tsc -b`) | clean, no errors |
| `npm run build` | **succeeded in 4.64s** (164 modules) |

All tests are offline: each injects a synchronous in-memory transport; no test
makes a network call or writes to the vault. The fixture payload is constructed
from the official documented `search2` schema; this phase deliberately performs
no live capture.

Test coverage: valid results (id/title/url/agency/date/status mapping); status
distinction (`posted`/`forecasted`/`closed`/`archived`); unknown/malformed status
→ `unknown`; empty results; non-JSON and unexpected-shape payloads; non-zero
`errorcode`; missing id → `item_error`; missing title → number fallback /
`item_error`; missing agency and dates → `null`; verbatim dates + blank close
date; default/custom query plans; empty-term and empty-status `invalid_request`;
one no-auth POST with provenance; wrong/unregistered/non-available → `BLOCKED`;
403 → `RESTRICTED`; transport/non-2xx → `FAILED`; async transport `retrieve()`
parity.

## Unfinished work / next phases (not started)

- Registry entry for `SU-GRANTS-001` (with a verified-read-only `AVAILABLE`
  note) — intentionally deferred so this phase stays adapter-only.
- Bridge (`src/live-source/grantsgov-bridge/`), live store, and UI wiring.
- Future-close-date validation, timezone handling, and confirmed-vs-inferred
  eligibility gating.
- A byte-for-byte recorded live `search2` response (requires an approved live
  call).

## Blockers

None. The official endpoint's rate-limit/fair-use terms were not read in full
(marked unverified in `qa/funding-discovery-audit.md`) and should be confirmed
before any live integration.
