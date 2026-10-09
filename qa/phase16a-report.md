# Phase 16A Report — USAspending Time-Period Fix (HTTP 422)

Status: **Implemented and verified.** Live USAspending funding searches now send
a `time_period` window with BOTH `start_date` and `end_date`, so the source no
longer rejects them with `HTTP 422: Missing value: 'filters|time_period|end_date'
is a required field`. The fix is in the pure query planner; no dependency was
added, no external request was made from any test, and no Vault write or
generated-data change occurred.

## Root cause

`buildUsaSpendingSearchBody` built the `time_period` filter from only the
`publishedSince` lower bound:

```ts
filters.time_period = [{ start_date: plan.publishedSince }]
```

The `POST /api/v2/search/spending_by_award/` endpoint requires a bounded
`time_period` — both `start_date` and `end_date`. Every request that carried a
`publishedSince` (i.e. every selected company in the live funding run) therefore
omitted `end_date` and the source answered `422` before returning results. The
recorded fixture only captured a *response* body, so the missing request field
was never asserted against.

## Fix

In `buildUsaSpendingSearchBody` the window is now complete:

```ts
filters.time_period = [{ start_date: plan.publishedSince, end_date: plan.publishedUntil }]
```

The end bound is derived in `buildUsaSpendingQueryPlan` from the request's own
`requestedAt` (the run timestamp already carried on every `DiscoveryRequest` and
through the bridge), so the window is `publishedSince … requestedAt` and no
clock is introduced into the pure adapter. Guards are added **before** the
transport is ever invoked:

- `requestedAt` must yield a real calendar date (`YYYY-MM-DD`); otherwise the
  plan fails `invalid_request` (`…must be a valid ISO 8601 date-time to bound the
  source time_period end_date`).
- A `publishedSince` later than the request date fails `invalid_request`
  (`…the source time_period would be empty`) instead of silently expanding or
  inverting the window.
- With no `publishedSince`, no `time_period` is sent at all (the field stays
  optional and bounded only when a lower bound is supplied).

## Files changed

Changed:
- `src/automation/usaspending-adapter.ts` — docstring updated; added
  `isIsoCalendarDate` / `endDateFromRequestedAt` helpers; `UsaSpendingQueryPlan`
  gained `publishedUntil`; `buildUsaSpendingSearchBody` emits both bounds;
  `buildUsaSpendingQueryPlan` derives/validates `publishedUntil` and the window
  warning now reads `publishedSince is forwarded to the source time_period window
  (<start> to <end>)`.
- `src/live-source/usaspending-bridge/contract.ts` — comment only: `publishedSince`
  now documents that the server derives `end_date` from `requestedAt`.

Tests:
- `src/automation/usaspending-adapter.test.ts` — 4 new tests: body carries both
  bounds (`2025-10-09` → `2026-10-09`); no `time_period` when no `publishedSince`;
  future `publishedSince` → `invalid_request` with **zero** transport calls;
  unusable `requestedAt` → `invalid_request` with **zero** transport calls.
- `src/live-source/usaspending-bridge/handler.test.ts` — 1 new test: the body the
  bridge forwards to the source carries the bounded `time_period`.

Unchanged: parsing, error/access semantics, TED adapter, both bridge plugins,
`http-boundary.ts`, `fetch-transport.ts`, and the entire `server/` host. No
envelope or provenance shape changed.

## Test evidence

Exact commands and results (2026-10-09):
- focused `npx tsx --test src/automation/usaspending-adapter.test.ts src/live-source/usaspending-bridge/handler.test.ts` → **15 pass / 0 fail**.
- `npm run test:automation` → **300 pass / 0 fail**.
- `npm run test:live` → **64 pass / 0 fail** (63 prior + 1 new bridge test).
- `npm run typecheck` → exit **0**.
- `npm run build` → **✓ built in 5.17s**.
- `npm run test:qa` → **364 passed / 3 skipped / 0 failed** (unchanged).

## Assurance

- **No real source call:** every adapter and bridge test injects a recording
  transport; the external USAspending API was **not** contacted. A real-source
  smoke test was intentionally not run (requires approval).
- **No protected-data change:** `src/data/generated/opportunity-data.json` md5
  still `17cfae825e1de5320705b066effec15b`.
- **No Vault writes; Vault bridge not mounted.** No new dependency was added.

## Known limitations

- The end bound is the run timestamp (`requestedAt`), so the window is
  `publishedSince … run date`; there is deliberately no "far future" end date.
- The source still caps searches to `2007-10-01` onward (surfaced verbatim in the
  source's `messages` warnings); this fix does not alter that.
- The `publishedSince` lower bound is still optional at the request level; the
  bridge continues to forward whatever the client supplies.
