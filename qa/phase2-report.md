# Phase 2 Report — Production-honest Playwright suite

## Objective
Eliminate the remaining e2e failures that expected the demo/fictional records
stripped from the production snapshot, without weakening test intent and
without restoring any fake records. Every rewritten test must describe what the
**production app actually does**: real rows on populated collections, honest
empty states on empty ones, and the designed `Record not found` page instead of
a fabricated detail.

Constraint honored throughout: `src/data/generated/opportunity-data.json` and
the production Vault (`<production-vault>`) were **not**
modified. No COMP/RFB/BID/CON records were re-added. No application code was
changed except the two renderers the tests measure against.

## Baseline
The Phase 1/2 audit recorded the full e2e inventory in a failing state
(~237 failures across 26 spec files). This phase rewrote the 15 files whose
failures were all production-honesty faults, then re-derived expected counts and
copy for the shared list/detail/filter markup via runtime probes. Final full QA:
**348 passed / 3 skipped / 0 failed.**

## Group summary (per the Phase 2 plan)

### Group A — disallowed UI red flags in e2e
Resolved by re-anchoring assertions to production markup:
app chrome (`header.topnav`, no `.sidebar`) now asserted through the
`expectAppChrome` helper; `/dashboard` redirect; boundary-note copy asserted on
`/match-review/SARVAJAL_PROPOSAL` and `/procurement-match-review/PUMP_PAIR`;
status-badge and related-group assertions rewritten against `badge--neutral`
badges and `.related__group` in the real detail pages; filter-bar combos,
`fields__raw`/`All N fields` card note, `.mini__count`, `Showing N of M` result
count, and `h1`/page-description assertions verified at runtime and applied.

### Group B — Vault/automation suites (unchanged by design)
No writes or importer changes. Verified after all spec work:
- `npm run test:data` — 348 pass, 0 fail
- `npm run test:automation` — 288 pass, 0 fail
- `npm run test:vault` — 37 pass, 0 fail

### Group C — a11y contrast fix
Verified green across the full suite.

### Group D — a11y labels/messages
Delivered in the prior batch; re-verified green.

## Files rewritten in this phase
Batch 1 (production contracts for the shared list/detail/routing primitives):
`qa/a11y`, `qa/focus`, `qa/routes`, `qa/hygiene`, `qa/responsive`,
`qa/cross-navigation`, `qa/supporting-entities`, `qa/journeys`, `qa/demo-flow`.
`qa/helpers.ts` re-based `LIST_ROUTES`/`DETAIL_ROUTES` and added the
`linkable` flag (name-only company directory rows carry no detail links).

Batch 2 (per-collection, honest empty-state suites):
`qa/notices`, `qa/bids`, `qa/contracts`, `qa/documents`, `qa/procurement`,
`qa/procurement-workflow`.

Shared honest contracts used by the rewrites:
- Empty collection → `.empty` `No records` (`The snapshot contains no rfp.` on
  /notices), `Showing 0 of 0 …`, no table, no `Fictional` badge, no checklist
  item, no fields.
- Fictional ID (`BID-*`, `RFB-*`, `CON-*`, `COMP-*`, `MATCH-*`, `APP-*`) →
  `Record not found` h1, `role="alert"` `No <type> with ID …`, single `Back to
  …` link, no relationship panels, no links to notices/bids/companies.
- Controls remain operable over empty corpora: filters render with their true
  "All"-only option set where data-derived, static sorts still selectable,
  status filter URL-syncs, clear button appears/disappears, no fabricated
  deadlines/dates/totals/win-rates.
- Populated collections keep real assertions: OPP-001 (30 fields, 4 blank /
  2 empty-list / 2 absent states, `Provider organization` and `Sources` related
  groups), ORG-001, SRC-001, the case-insensitive `EnergyX`/`Cisco` directory
  search, `?opportunityType=Fund` single-row URL sync, and the Funding/
  Procurement navigation smoke tests.
- `/procurement` minis count `0` for RFPs / bids / contracts and deep-link to
  the empty collections.

## Verification
- `npx playwright test --workers=4` (list reporter): **348 passed, 3 skipped, 0 failed**
- `npx playwright test --workers=4` (json reporter + `qa/summarize.js`):
  `TOTAL tests: 348 passed, 0 failed, 3 skipped`
- `npm run typecheck` (`tsc -b`): clean
- `npm run build`: success (`✓ built in 4.30s`; pre-existing chunk-size warning only)
- Unit suites: data 348 / automation 288 / vault 37, all 0 fail

## Intentionally skipped tests (3)
Recorded in `qa/.report-failures.txt` (the summarize.js heuristic flags skipped
tests as not-ok):
- `supporting-entities.spec.ts › Organization filter if BUG-1 is fixed`
- `supporting-entities.spec.ts › Keyboard accessibility on list links`
- `supporting-entities.spec.ts › No invented metrics on Company pages`

## Artifacts
- `qa/.report-failures.txt` — failure/skip inventory from the final run.
- Temporary probes (`.probe3..6`) and their `qa/.artifacts.*` dirs removed.

## Stop
Phase 2 is complete. Per the working agreement, do **not** begin Phase 3 or
make unrelated UI/importer/vault changes.