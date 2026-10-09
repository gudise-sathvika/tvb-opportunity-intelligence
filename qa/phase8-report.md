# Phase 8 — Close Regression Coverage Gaps

**Date/time:** 2026-10-09, 10:35–10:48 IST (≈13 minutes, within the 20-minute timebox)
**Type:** test-hardening only. No product features, no UI redesign, no application-logic changes.

## 1. Files changed and why

| File | Change | Gap addressed |
|------|--------|---------------|
| `qa/routes.spec.ts` | Added test `home presents the three product cards (Funding, Procurement, Companies) with their routes`: asserts `.landing__cards .landing-card` count is 3, each card's heading text, and each CTA's `href` (`/funding`, `/procurement`, `/companies`), plus the data-driven `189 companies are currently tracked` copy. | Task 1 — Landing cards |
| `qa/compact-filters.spec.ts` | (a) Extended the keyboard test to open the popup with Enter and assert **Escape closes it**, then kept the existing Enter-toggle and Space-toggle coverage. (b) Added test `Funding Opportunities sort control reorders rows by ID and by title`: selects `#filter-sort` → `id` and `title` and asserts the rendered IDs/titles are in the expected order and that re-selecting `id` is stable. | Task 2 (Escape) + Task 3 (filter-bar sorting) |
| `qa/company-directory.spec.ts` | Replaced the first-row-only sort check with full first-page ordering assertions: after `desc`, the 5 rendered names are non-increasing under the same `localeCompare(..., 'en', { sensitivity: 'base' })` the app uses (first = `Zeronsec`); after `asc`, they are non-decreasing (first = `1839 Ventures`). | Task 3 — ascending **and** descending ordering |
| `package.json` | `test:live` glob extended to `src/live-source/*.test.ts src/live-source/ted-bridge/*.test.ts src/live-source/usaspending-bridge/*.test.ts`. | Task 4 — handler-test registration |

No files under `src/` were modified. No existing assertions were weakened, deleted, or skipped.

## 2. Exact commands executed and actual results

| # | Command | Result |
|---|---------|--------|
| 1 | `npm run test:live` | **18 passed / 0 failed / 0 skipped** (was 15 before registration; +3 = the USAspending handler tests) |
| 2 | `npm run typecheck` (`tsc -b`) | exit 0, no errors |
| 3 | `npm run build` (`tsc -b && vite build`) | ✓ built in 5.29s (pre-existing >500 kB chunk warning only) |
| 4 | `npx playwright test routes.spec.ts compact-filters.spec.ts company-directory.spec.ts` | **15 passed / 0 failed** (incl. new card test, Escape step, sort test) |
| 5 | `npm run test:qa` (`playwright test`) | **364 passed / 3 skipped / 0 failed** (4.8m) — was 362 passed before this phase; +2 net new tests (1 in routes, 1 in compact-filters; company-directory modified an existing test in place) |

## 3. Gap closure status

1. **Landing-page three cards — genuinely closed.** New `routes.spec.ts` test asserts all three cards render with the correct headings and `href`s, and it passed in both the focused run and full `test:qa`. (Previously only `.landing` + h1 were asserted.)
2. **Escaping compact filters — genuinely closed.** The keyboard test now opens the popup, confirms it is visible, presses Escape, and confirms it closes; it passed. Enter/Space toggle coverage was kept.
3. **Sorting — genuinely closed, with a note.** Ascending **and** descending ordering are now verified on real deterministic rows: Companies via the strengthened `company-directory.spec.ts` (full first page in asc/desc order), and the filter-bar sort via the new `compact-filters.spec.ts` ID/title ordering test. One honest caveat: the filter-bar `GRANT_SORTS` offers only ascending keys (`id`, `title`, `type`, `country`, `deadline`) — there is no descending filter-bar sort in the product, so descending coverage is asserted on Companies (which does have asc/desc). No production-data ordering was hardcoded; assertions check ordering invariants using the app's own comparator against the live/demo dataset.
4. **USAspending handler test registration — genuinely closed.** `src/live-source/usaspending-bridge/handler.test.ts` is now matched by `test:live`. It is the only `*.test.ts` in that directory, so the new glob does not double-count it (no other script matches it either). `npm run test:live` reports 18 pass, up exactly 3 from the previous 15, confirming inclusion.

## 4. Build and typecheck
- `npm run typecheck`: PASS (exit 0).
- `npm run build`: PASS (built in 5.29s; the ">500 kB chunk" message is a pre-existing warning, unchanged).

## 5. Checks not completed within the timebox
- None of the required checks were skipped. All five validation steps (focused specs, `typecheck`, `build`, full `test:qa`, and the registered `test:live` suite) completed within ≈13 minutes.
- Not re-run in this phase (unchanged code, out of scope): `test:data`, `test:automation`, `test:vault`. They were green in Phase 7 and no `src/` file changed here.

## 6. Safety confirmation
- **No live discovery ran and no live external HTTP request was sent.** The added Playwright assertions are pure UI/DOM checks; `test:qa`'s live specs still intercept the bridge with recorded fixtures.
- **No production Vault write.** `opportunity-data.json` mtime is unchanged (`2026-10-09 01:13`); no file under the production Vault was written.
- **No proposals, applications, bids, or contracts were created.**
- Only test files (`qa/*.spec.ts`), `package.json`, and this report were written.
