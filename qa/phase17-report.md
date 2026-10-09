# Phase 17 Report — Controlled Live-Source Verification

Status: **Verified.** Part A issued **exactly one** live, read-only USAspending
request through the production bridge handler; it returned **HTTP 200** and was
classified honestly as **NO_RESULTS** (a valid empty completion), with the
corrected `time_period` — both `start_date` and `end_date` — confirmed in the
payload. Part B re-confirmed TED blank-keyword semantics from Phase 16B and the
existing offline tests; **no live TED request was made**. No code, candidate,
Vault, or generated data was changed.

Timebox: completed within the 15-minute budget.

## Part A — USAspending live smoke test

### A1. Code inspection (both date bounds present)

`src/automation/usaspending-adapter.ts` now builds the window from both bounds:

- `buildUsaSpendingSearchBody` emits
  `filters.time_period = [{ start_date: plan.publishedSince, end_date: plan.publishedUntil }]`
  when a `publishedSince` is supplied.
- `buildUsaSpendingQueryPlan` derives `publishedUntil` from the request's
  `requestedAt` and fails (`invalid_request`) before any request if it is not a
  valid ISO date or if the range would invert. No firmware range (`start_date`
  only) is ever sent.

### A2. The one live request

The committed verification script `qa/verify-live-funding.ts` hardcodes
`publishedSince: ''`, which sends no `time_period` and would therefore **not**
exercise the Phase 16A fix. To verify the fix against a bounded window I invoked
the *same production handler* (`handleUsaSpendingBridge` → `createFetchTransport`
→ one read-only POST) with the UI's real default window
(`USA_LIVE_WINDOW_DAYS = 365`, `src/live-source/live-funding-discovery.ts:44`),
keyword `solar energy`, company `COM-001`, limit `10`. This was a temporary
one-off script that was deleted immediately (no repo change).

Command (run once): `npx tsx ._phase17-verify.ts` (temporary; removed after).

Actual live result:

```
OFFLINE payload.filters.time_period = [{"start_date":"2025-10-09","end_date":"2026-10-09"}]
LIVE bridge HTTP = 200 | ok = true
LIVE source status = 200 (481 bytes raw, one live POST)
RUN outcome = NO_RESULTS | profile = DP-LIVE-002 | domain = funding
RUN received = 0 | created = 0 | dupes = 0 | blocked = 0 | failed = 0
RUN review = 0
CANDIDATES = 0
EXIT=0
```

- **HTTP / result status:** bridge HTTP `200`, source status `200`.
- **Candidates received:** `0` (`received 0`, `created 0`, `blocked 0`,
  `failed 0`).
- **Returned award identifiers / provenance:** none — there were zero results, so
  no award IDs and no candidate provenance were produced.
- **Honest classification:** `NO_RESULTS`. The source result was `SUCCESS` with
  zero candidate results, which the orchestrator maps to the distinct empty-
  success signal `NO_RESULTS` (`src/automation/orchestrator.ts:245,267`). It was
  **not** reported as `FAILED`, and an HTTP error is never turned into an empty
  success (`usaspending-adapter.ts:340-352`).

### A3. Evidence the corrected date bounds were sent

- **Offline (deterministic, from the same planner the bridge uses):** the payload
  for these exact inputs contains
  `time_period = [{"start_date":"2025-10-09","end_date":"2026-10-09"}]` — both
  bounds present.
- **Live (inferred):** the same request shape that previously returned
  `HTTP 422 Missing value: 'filters|time_period|end_date'` now returns `HTTP 200`.
  Because a `422` would have produced a `FAILED` run and a `200` is the only
  path to `NO_RESULTS`, the live `200` is consistent with the corrected, bounded
  payload being accepted. No second (broken-payload) request was sent to prove
  the counterfactual.

## Part B — TED query behavior (offline only)

No live TED request was made. Verified against Phase 16B and the existing offline
tests:

1. **Blank keyword ⇒ company name is the title-search term.**
   `searchTermFor` returns `context.keyword !== '' ? context.keyword : companyId`
   (`src/live-source/live-discovery.ts:172-174`), and the query is
   `notice-title~"<term>" AND publication-date>=<YYYYMMDD>`
   (`src/automation/ted-adapter.ts:168-169`). Pinned by the offline test
   *"an empty keyword falls back to the company name as the honest search term"*
   (`src/live-source/live-discovery.test.ts:118-124`, asserts `keyword === 'Aavo'`).

2. **A successful empty TED response is distinguished from failures.** The
   offline tests pin every distinct case:
   - `ted-adapter.test.ts:254` *"request failures stay failures — never SUCCESS
     with zero results"*;
   - `ted-adapter.test.ts:290-319` *"malformed, unexpected, and truncated
     responses stay observable"* — non-JSON (`not valid JSON`), missing
     `notices` array (`unexpected shape`), and a source-side timeout that matched
     `totalNoticeCount: 43` but returned `notices: []` (`truncated by a
     source-side timeout`), while a `timedOut` response **with** results stays
     `SUCCESS` + a warning;
   - `live-discovery.test.ts:126-173` — a bridge failure, a throwing bridge, and
     a non-2xx status all surface as `FAILED`, never an invented empty success.
   - The bridge handler tests (`ted-bridge/handler.test.ts`) pin the same
     boundary (empty keyword cannot build a search; non-2xx forwarded with its
     real status; transport rejection → `502`).

3. **UI explanation — documented gap.** The UI is honest about *what happened*
   but not *why*:
   - The result note for a live TED run reads only *"This run queried the real
     TED source. Each listing is stored once per company run…"*
     (`DiscoveryResults.tsx:97-98`), and an empty company run shows *"This
     company run produced no candidates."* (`DiscoveryResults.tsx:135-136`). It
     does not state that the match is **title-only** or that a blank keyword
     searches the **company name**.
   - The keyword field is a bare text input with placeholder `e.g. bridge`
     (`DiscoveryFilters.tsx:51-62`); its doc comment says "empty means no keyword
     filter" but that is not surfaced to the user, and it is misleading — an
     empty keyword does **not** mean "no term", it means "use the company name".
   **Exact UX gap:** nothing in the Discovery panel tells the operator that (a)
   the term is matched against the notice *title only*, and (b) leaving Keyword
   blank substitutes the selected company's name as that title term. This is the
   same gap identified in `qa/phase16b-report.md`.

## Assurance / scope confirmation

- **Exactly one live USAspending request** was made (the `LIVE … one live POST`
  line above); it was not retried or repeated.
- **No live TED request** was made in this phase.
- **No code or test changes were committed**: the temporary verification script
  was deleted (`ls ._phase17-verify.ts` → not found). The committed
  `qa/verify-live-funding.ts` was left untouched.
- **No production data or Vault records changed**:
  `src/data/generated/opportunity-data.json` md5 still
  `17cfae825e1de5320705b066effec15b`. No proposals, applications, bids, or
  contracts were created. No credentials or raw response bodies were logged.

## Distinguishing evidence types

- **Actual live evidence (this phase):** one USAspending POST → HTTP 200, source
  status 200, 481 raw bytes, `NO_RESULTS`, 0 candidates.
- **Offline/deterministic evidence (this phase):** the reconstructed payload
  showing both `start_date` and `end_date`; the TED behavioral re-checks via the
  offline test suite (26 tests, all pass) and source inspection.
- **Prior reports:** Phase 16A (the fix and its offline tests), Phase 16B (the
  TED zero-results diagnosis), Phase 4 (the recorded TED success using the
  thematic keyword `solar energy`).
