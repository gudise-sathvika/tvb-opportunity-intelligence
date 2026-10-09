# Phase 18 Report — Explicit Live-Search Semantics in the Discovery UI

Status: **Complete.** The Discovery panel now states, before a live run, that a
blank keyword makes each live search use the selected **company's own name** as
the search term, and that `Live TED` matches **tender titles only** (not buyer
names, supplier names, or every tender field), while `Live Funding` matches
federal award records. Empty results are now distinguished from failures. The
changes are **presentation and test only** — no source adapter, query plan,
request count, date filter, result behavior, Vault, or generated data changed.

Timebox: completed within the 20-minute budget.

## Files changed

- `src/components/discovery/DiscoveryFilters.tsx`
  - Corrected the misleading doc comment ("empty means no keyword filter") to
    describe the real behavior: a live search uses the keyword as the source
    search term, and a blank keyword substitutes the company name.
  - Added a compact hint under the keyword input
    (`#dg-keyword-hint`, wired via `aria-describedby`):
    "Live searches send this term to the source. Leave it blank to search each
    company's name instead."
- `src/components/discovery/DiscoveryControls.tsx`
  - Added a live-scope note (`.dg-scope-note`, `role="note"`) that updates as the
    keyword changes and explains the match scope.
- `src/components/discovery/DiscoveryResults.tsx`
  - Added `emptyMessage(company)` and used it for the per-company empty state to
    separate "completed with no matching results" from "the source request
    failed".
- `src/styles/components.css`
  - Added `.dg-filter__hint` and `.dg-scope-note` styling (small print + a subtle
    left rule). No layout behavior changed.
- `qa/ted-live.spec.ts`, `qa/funding-live.spec.ts`
  - New deterministic, offline tests (bridge intercepted with byte-for-byte
    recorded / empty responses) and one strengthened failure assertion.

## Final UI wording

Scope note (blank keyword):

> No keyword entered: each live search uses the selected company's own name as
> its search term. Live TED matches tender titles only — not buyer names,
> supplier names, or every tender field. Live Funding (USAspending) matches
> federal award records.

Scope note (keyword entered):

> Keyword "&#8203;<term>" is used as the search term for every selected company
> instead of the company name. Live TED matches tender titles only — not buyer
> names, supplier names, or every tender field. Live Funding (USAspending)
> matches federal award records.

Keyword field hint:

> Live searches send this term to the source. Leave it blank to search each
> company's name instead.

Completed-empty result (per company):

> Search completed with no matching results. Try a relevant keyword or adjust the
> supported filters. No matches does not prove no opportunities exist.

Failed request (per company):

> The source request failed — this is not an empty result. See the source errors
> above.

The USAspending funding banner ("US federal awards, not open grant
solicitations.") and the real-source provenance chips are unchanged; the empty
funding test additionally asserts the federal-award wording is still shown.

## Tests and exact results

All new tests intercept the browser's same-origin bridge request with
`page.route` and answer recorded/empty payloads, so **no real source is
contacted**; assertions flow through the real adapter and orchestrator.

- Focused live specs: `npx playwright test qa/ted-live.spec.ts qa/funding-live.spec.ts`
  → **10 passed** (0 failed).
- Related Discovery specs (`discovery`, `discovery-filters`, `discovery-workflow`,
  `demo-flow`) → **67 passed** (0 failed).
- `npm run typecheck` → clean (`tsc -b`, no errors).
- `npm run build` → succeeded in 5.17s (164 modules).
- `npm run test:qa` (full Playwright suite) → **367 passed, 3 skipped, 0 failed**.

New/changed assertions:

1. `ted-live.spec.ts` — *"the panel explains the live search term before running
   (blank vs entered keyword)"*: blank state names the company-name substitution
   and the title-only scope; typing a keyword rewrites the term for every
   company.
2. `ted-live.spec.ts` — *"a successful empty TED response is Completed (no
   results), distinct from a failed request"*: an empty `notices: []` response
   yields `Overall outcome = Completed (no results)`, `Candidates found = 0`,
   `Failed sources = 0`, and the completed-empty copy (not the failure copy).
3. `ted-live.spec.ts` — failure case strengthened: a `502` bridge error shows
   "The source request failed" and does **not** show the completed-empty copy.
4. `funding-live.spec.ts` — *"a successful empty USAspending response is
   Completed (no results), not a failure"*: `results: []` yields the completed-
   empty state while the federal-award banner remains visible.

## Assurance / scope confirmation

- **No source semantics changed.** `src/automation/ted-adapter.ts` and
  `src/automation/usaspending-adapter.ts` are untouched; the query string,
  `time_period` bounds, search-term fallback, filters, request count (one request
  per selected company), and result behavior are identical.
- **No new dependencies** were added.
- **No live requests** were made; every test is offline/mocked.
- **No production data or Vault records changed:**
  `src/data/generated/opportunity-data.json` md5 still
  `17cfae825e1de5320705b066effec15b`. No proposals, applications, bids, or
  contracts were created.
- **Accessibility:** the keyword input references the hint via
  `aria-describedby`; the scope note carries `role="note"` and is a stable text
  node rather than a color-only signal.
