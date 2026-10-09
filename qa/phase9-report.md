# Phase 9 — Release Readiness Audit

**Date/time:** 2026-10-09, ≈10:49–10:58 IST (audit only, no code changes)
**Scope:** evidence-based release-readiness assessment of the current repository state.
No code or test files were modified; no live external requests or Vault writes were performed.

---

## 1. Repository state

- **The project is a git repository with no commits.** `<repo-root>/.git` exists, but
  `git -C ... status -sb` reports `## No commits yet on master` and `rev-list --count HEAD` fails
  (`unknown revision`). `git status --porcelain` lists **every** file as untracked (`??`). There is
  therefore no diffable history; change attribution below uses file modification times.
- **Working directory `<production-vault>` (the Vault) is NOT a git repository**
  (`fatal: not a git repository`). The Obsidian Vault is external to the codebase.
- **Recent modification times (today):**
  - Phase 6 application/test work — `src/live-source/usaspending-bridge/plugin.ts` (09:59),
    `src/live-source/live-funding-discovery.ts` + `vite.config.ts` (10:00),
    `src/automation/usaspending-fixture.ts` (10:01), `.../handler.test.ts` (10:04),
    `qa/verify-live-funding.ts` + `src/automation/usaspending-adapter.test.ts` (10:05),
    `src/automation/registry.test.ts` (10:08), `src/automation/usaspending-adapter.ts` (10:09),
    `src/pages/Discovery.tsx` (10:13), `DiscoveryControls.tsx` + `DiscoveryResults.tsx` (10:14),
    `qa/funding-live.spec.ts` (10:15).
  - **Phase 8 test-only changes** — `qa/routes.spec.ts` (10:40), `qa/company-directory.spec.ts`
    (10:41), `qa/compact-filters.spec.ts` + `package.json` (10:42).
  - Reports/artifacts — `qa/phase7-report.md` (10:35), `qa/phase8-report.md` (10:48),
    `qa/screenshots/*` + `qa/.artifacts/*` (10:47–10:48).
- **Phase 8 changes are limited to tests and test configuration — confirmed.** The four files touched
  in Phase 8 are three `qa/*.spec.ts` files and `package.json` (a `test:live` glob only). **No
  `src/` file was modified after 10:15** (Phase 6), so Phase 8 introduced zero application-code,
  generated-data, or Vault-path changes.
- **No unexpected modifications.** `src/data/generated/opportunity-data.json` mtime remains
  `2026-10-09 01:13`, unchanged through Phases 7–9. No file under the
  production vault was written.
- **No reset/revert/stash was performed.** All user files left intact.

## 2. Bounded final verification — exact commands and results

| # | Command | Result | Notes |
|---|---------|--------|-------|
| 1 | `npm run test:vault` | **37 pass / 0 fail / 0 skip** (2.2s) | |
| 2 | `npm run test:data` | **348 pass / 0 fail / 0 skip** (5.2s) | |
| 3 | `npm run test:automation` | **296 pass / 0 fail / 0 skip** (2.5s) | |
| 4 | `npm run test:live` | **18 pass / 0 fail / 0 skip** (1.2s) | includes the 3 USAspending handler tests registered in Phase 8 |
| 5 | `npm run typecheck` (`tsc -b`) | exit 0, no errors | |
| 6 | `npm run build` (`tsc -b && vite build`) | **✓ built in 5.14s** | pre-existing ">500 kB chunk" warning only |
| 7 | `npm run test:qa` (`playwright test`) | **364 passed / 3 skipped / 0 failed** (4.8m) | run because time permitted (it also passed in Phase 8) |

Unit totals (1–4): **699 passed / 0 failed**. All six required checks plus the optional `test:qa`
completed inside the 20-minute box. Nothing was left unverified.

## 3. Critical product boundaries — evidence

1. **Obsidian Vault is the source of truth — SUPPORTED.**
   - `src/import/paths.ts` — the vault root was read from `TVB_SOURCE_VAULT` (at
     this phase, `'<production-vault>'`).
   - `src/import/cli.ts` reads that root and builds a snapshot; the generated file records
     `"generator": "tvb-frontend read-only vault importer"` and
     `"source": { "vaultDirectoryName": "TVB Opportunity Intelligence", "contentFileCount": 131,
     "recordCount": 14 }` (`src/data/generated/opportunity-data.json`).
   - `src/data/selectors.ts:18` imports that JSON as a **static, read-only** import.

2. **The frontend cannot silently write production data — SUPPORTED (structurally enforced).**
   - `src/vault-writer/boundary.test.ts` test **19a** scans every non-test `.ts/.tsx` under `src`
     for write primitives and asserts the only holders are
     `import/cli.ts`, `import/snapshot.ts`, `vault-writer/writer.ts` (`boundary.test.ts:38–71`).
   - Test **19e** asserts `components`, `pages`, `data`, `analytics`, `app`, `hooks` cannot even
     import `vault-writer` (`boundary.test.ts:134–147`).
   - The importer's snapshot is written **outside the vault** — `SNAPSHOT_DIR = <project>/.vault-snapshot`
     (`paths.ts:20`); generated data goes to `src/data/generated` (`paths.ts:33–34`) and is an offline
     build artifact (`cli.ts:126`), not a runtime write.

3. **Vault writes only through the controlled writer + approval — SUPPORTED.**
   - `src/vault-writer/writer.ts:219–229` rejects any request without a dated human approval
     (`not_approved`: requires `decisionId`, `approvedBy`, `decidedAt`).
   - The actual write is `fs.writeFileSync(targetAbs, prepared.markdown, { flag: 'wx' })`
     (`writer.ts:494`) — exclusive create, so it cannot overwrite an existing record.
   - Test **19d** asserts `writer.ts` has no network, child-process, timer, clock, `Math.random`, or
     `localStorage` primitive (`boundary.test.ts:114–132`).
   - `qa/vault-write.spec.ts:90` — preview reports and **writes nothing**; `:129` — a READY preview
     then the explicit write creates **exactly one** record and a duplicate returns `ALREADY_EXISTS`
     (runs against an isolated fixture vault under `qa/.artifacts/`).
   - `src/vault-bridge/demo-flow.ts:217` — "approval and preview mutated nothing — only 'write' can
     create a file."

4. **USAspending represented as federal awards, not open solicitations — SUPPORTED.**
   - `src/components/discovery/DiscoveryResults.tsx:81` — "Live source: USAspending (SU-US-001) —
     **US federal awards, not open grant solicitations.**"
   - `:96` — "that source returns federal award records — obligated grants, not open grant
     solicitations…"
   - Source auto-registered as `SU-US-001` (`src/automation/registry.test.ts`); `qa/funding-live.spec.ts`
     asserts the banner and live-source provenance.

5. **TED and USAspending UI tests use intercepted/recorded responses — SUPPORTED.**
   - `qa/ted-live.spec.ts:34,132` — `page.route(BRIDGE_PATH, …)`; header documents answering the
     browser request with a recorded TED body.
   - `qa/funding-live.spec.ts:37,139` — `page.route(BRIDGE_PATH, …)`; header documents a
     "byte-for-byte recorded USAspending response."
   - Both pass offline; no external service is contacted.

6. **Failures/unavailable sources are honest, never empty successes — SUPPORTED.**
   - `src/live-source/usaspending-bridge/handler.ts:136` — a transport failure → HTTP 502
     `source_failure`; `:133` — a non-2xx source status is forwarded with its real status (never an
     empty `ok`).
   - `src/live-source/ted-bridge/handler.ts:44–49` — same `failureBody`/`reject` pattern.
   - `qa/funding-live.spec.ts` and `qa/ted-live.spec.ts` each include a "bridge failure is a failed
     run with no candidates and no review handoff" test (both pass).

## 4. Readiness levels

### Local demo readiness — **READY**
All 699 unit assertions and 364 Playwright assertions pass (3 skips), typecheck is clean, and the
build succeeds. The demo is fully reproducible offline: deterministic data plus recorded/intercepted
live-source fixtures, and the approved→write flow is exercised end-to-end against an isolated fixture
vault (`qa/vault-write.spec.ts`). No live network or production Vault access is required to demo.

### Controlled live-source readiness — **PARTIAL (prior-evidence only)**
- **Previously verified (NOT re-run in this audit):** `qa/verify-live-funding.ts` documents a genuine
  USAspending run (real HTTP 200, normalized DOE awards via the production handler → real
  orchestrator); `qa/verify-live-discovery.ts` documents a genuine TED run. These are recorded in
  `qa/phase4-report.md` / `qa/phase6-report` context and the Phase 7 report — cited as prior evidence,
  not as checks executed today.
- **Still requires an operational check:** TED API stability/rate-limits and result-shape drift;
  USAspending pagination/limit behavior with non-trivial queries; the live path executed from the
  actual target environment/network; and **GlobalTenders remains `accessState: UNKNOWN` and is always
  BLOCKED** (registration-only metadata), so funding has a single live source (USAspending) and
  procurement a single live source (TED).

### Production readiness — **NOT production-ready (insufficient evidence)**
Unresolved items, each with a concrete basis:
- **No version control / no provenance.** The repo has zero commits (`No commits yet on master`);
  there is no tag, release branch, or changelog to bind a build to a revision.
- **Build is not reproducible off-machine.** `src/data/generated/` is gitignored
  (`.gitignore`: "Generated vault snapshot data … must never be committed"), yet the app
  **statically imports** `./generated/opportunity-data.json` (`src/data/selectors.ts:18`). A fresh
  clone cannot build without first running `npm run import:data`, and the importer hardcodes a
  Windows-only vault path (`src/import/paths.ts:17`, `V:\TVB\…`) — so no Linux/CI build is possible
  as configured.
- **Live bridges are Vite-only.** The Vault/TED/USAspending endpoints are mounted as **Vite plugins**
  (`vite.config.ts:5–6,18`: `tvbVaultBridge()`, `tvbTedBridge()`, `tvbUsaSpendingBridge()`), which
  exist only under `vite dev` / `vite preview`. No production server host for `/__tvb/*` is defined,
  so live-source and write features would 404 on static hosting.
- **No deployment/monitoring/ops evidence.** No CI config (no `.github`, Dockerfile, or pipeline),
  no health checks, logging, alerting, or data-freshness/refresh schedule are present in the repo.
- **No security hardening evidence** for the bridge endpoints (auth, CORS, CSP, TLS) in a deployed
  context.
- Minor: the `>500 kB` bundle-size warning persists (`index-*.js` ≈ 634 kB).

## 5. Recommended next step (single most important)
**Make the build reproducible and hostable outside the local dev machine.** Concretely: decouple the
build from the local Vault — either commit a sanitized generated snapshot (or generate it in CI from
a fixture vault) and parameterize `VAULT_ROOT`/paths — and define a production host for the
`/__tvb/*` bridges instead of relying on Vite plugins. Until that exists, the artifact cannot be
built or run from a clean checkout, which blocks any production release regardless of the green test
suite.

## 6. Safety confirmation
- No application or test code was changed; no tests were weakened or skipped.
- No live discovery or real external HTTP request was performed in this phase (the `test:qa` live
  specs still intercept the bridge with recorded fixtures).
- No Vault write occurred; `src/data/generated/opportunity-data.json` mtime unchanged
  (`2026-10-09 01:13`).
- No proposals, applications, bids, or contracts were created.
- Only this file was written: `qa/phase9-report.md`.
