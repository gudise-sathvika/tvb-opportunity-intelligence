# Phase 7 — Final Integrated Regression Report

**Date/time:** 2026-10-09 10:35 IST
**Scope:** verification only. No application code or tests were modified. No live discovery was run
and no real external HTTP request was sent.

## Exact commands executed

| # | Command | Result |
|---|---------|--------|
| 1 | `npm run test:vault` | 37 passed / 0 failed / 0 skipped |
| 2 | `npm run test:data` | 348 passed / 0 failed / 0 skipped |
| 3 | `npm run test:automation` | 296 passed / 0 failed / 0 skipped |
| 4 | `npm run test:live` | 15 passed / 0 failed / 0 skipped |
| 5 | `npm run typecheck` (`tsc -b`) | exit 0, no errors |
| 6 | `npm run build` (`tsc -b && vite build`) | ✓ built in 4.60s (pre-existing >500 kB chunk-size warning only) |
| 7 | `npx playwright test routes.spec.ts navigation.spec.ts focus.spec.ts compact-filters.spec.ts ted-live.spec.ts funding-live.spec.ts discovery.spec.ts` | 108 passed / 0 failed |
| 8 | `npx tsx --test src/live-source/usaspending-bridge/handler.test.ts` (see orphan note) | 3 passed / 0 failed |
| 9 | `npm run test:qa` (`playwright test`) | 362 passed / 3 skipped / 0 failed (4.8m) |

Unit totals (checks 1–4): **696 passed / 0 failed**.
Playwright full suite (check 9): **362 passed / 3 skipped / 0 failed** (the 3 skips are pre-existing,
unchanged from the Phase 5 baseline).

## 1. Landing page and navigation — PASS (with one coverage gap)
- `routes.spec.ts` home test passes: `/` renders `.landing`, the level-1 heading "Discover
  opportunities.", and `/dashboard` redirects to `/`.
- `navigation.spec.ts` passes at mobile-375 / tablet-768 / desktop-1440, 200% text size, route
  preservation, and no horizontal scroll; `focus.spec.ts` keyboard-focus order passes.
- **Gap:** no test asserts the three landing cards. `grep` over `qa/*.spec.ts` finds **no** reference
  to `.landing-card` / `.landing__cards` / "Explore Funding|Procurement|Companies". The Funding /
  Procurement / Companies three-column card layout and its stacking are covered only by the Phase 6
  build + the earlier manual change, **not** by an existing interaction test. Reported, not fixed.

## 2. Compact filters and workspace controls — PASS (with coverage caveats)
`compact-filters.spec.ts` passes. Actual interactions exercised (Funding Opportunities test):
- hover reveal of the category popup — asserted (`:27–31`);
- click-to-pin — asserted (`:38–43`);
- click-to-unpin — asserted (`:53–55`);
- active-filter clearing + badge removal — asserted (`:57–62`);
- URL synchronization (`?country=India`, then cleared) — asserted (`:47`, `:61`).

Caveats (presence-only or untested — reported, not fixed):
- **Escape-to-close is not actually exercised.** The test title says "Escape to close"
  (`compact-filters.spec.ts:200`) but the body only toggles with Enter/Space (`:205–220`).
- **Sorting is presence-only.** `#filter-sort` visibility is asserted (`:16`); there is no
  sort-ordering interaction test anywhere (Funding/Procurement lists or Matches/Applications).
- **Tests 2–6** (Notices, Bids, Contracts, Funding Matches, Funding Applications) assert that the
  primary axes/category labels are present; only test 1 walks the full hover/pin/unpin/clear flow.
- Procurement Matches `All / Approved / Rejected` faithful filtering is covered
  (`procurement-match-review.spec.ts:47`).

## 3. Live discovery UI — offline only — PASS
- `ted-live.spec.ts` (3) and `funding-live.spec.ts` (4) pass, and the Discovery regression tests
  pass within the 108-test focused batch and the full `test:qa` run.
- **Interception confirmed:** both specs register `page.route` on the same-origin bridge
  (`**/__tvb/ted/search`, `**/__tvb/usaspending/search`) and fulfil with byte-for-byte recordings
  (`TED_SEARCH_RESPONSE_RECORDING`, `USA_SPENDING_SEARCH_RESPONSE_RECORDING`) **before** the request
  reaches the preview server. The full run passed with the "no external requests" assertions intact,
  so no external service was contacted.
- **USAspending labeling verified:** a live funding run shows the banner "Live source: USAspending
  (SU-US-001) — US federal awards, not open grant solicitations." and the note "…Results are federal
  award records — obligated grants, not open grant solicitations…".
- **Provenance:** `SU-US-001` + "USAspending" source rows and the "Real source" chip are asserted.
- **Run history:** `RUN-F-0001` / "Grants" / "3 companies" / "9 candidates" / "Completed" asserted.
- **Review handoff:** "Review 9 candidates" → `/review` with 13 rows (4 seeded + 9 awards) asserted.
- **Failure state:** a bridge `ok:false` 502 yields `Failed`, 0 candidates, 1 failed source, no review
  link, and the honest source error text.

## 4. Automated suites — PASS
Checks 1–6 and 9 above. `test:qa` deliberately re-runs the focused Playwright specs, so check 7 is
partly subsumed by check 9; both were run per the task.

## Known limitations / untested interactions
1. No automated assertion of the three Landing cards (Section 1 gap).
2. Escape-to-close for compact category filters is not exercised despite the test title.
3. No sort-ordering interaction test (presence-only).
4. Compact-filter tests 2–6 are presence-level, not full interaction.
5. **Orphaned test:** `src/live-source/usaspending-bridge/handler.test.ts` is not matched by any npm
   script — `test:live` globs only `src/live-source/*.test.ts` and `src/live-source/ted-bridge/*.test.ts`,
   and `test:automation` globs only `src/automation/*.test.ts`. It was run manually (check 8: 3/3 pass)
   but will silently not run under the CI scripts. Reported, not changed.
6. `qa/.artifacts` is wiped by Playwright at the start of a run (pre-existing); on-disk intermediate
   evidence does not survive.

## Safety confirmation
- No command performed live discovery or a real external HTTP request (checks 7 and 9 intercept the
  bridge with recorded fixtures; no `verify-ted` / `verify-live-funding` script was run).
- **No write was made to the production Obsidian Vault** (`<production-vault>`).
  `vault-write.spec.ts` exercises isolated test vaults only.
- `src/data/generated/opportunity-data.json` was not modified.
- No proposals, applications, bids, or contracts were created.
- Only file written this phase: this report (`qa/phase7-report.md`).
