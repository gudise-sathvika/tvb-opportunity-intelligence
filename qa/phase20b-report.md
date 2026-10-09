# Phase 20B Report — Connect Grants.gov to the Live Funding Search

Status: **Complete.** The **Run Live Funding Search** button now queries the real
Grants.gov source (`SU-GRANTS-001`) through the already-mounted same-origin
read-only bridge (`/__tvb/grantsgov/search`), replays the returned source body
through the REAL Grants.gov adapter + Phase D orchestrator + Phase E review
queue, and produces grant **opportunity** candidates that preserve the
source-published `oppStatus`. USAspending is no longer wired to the funding
button (it remains available as historical award context). The UI never claims a
record is confirmed open or eligible.

Timebox: exceeded while resolving one access-gate decision (see Decision below).

## Decision (recorded, per the Phase 20B boundary)

The Phase D access gate (`src/automation/discovery-run.ts:84`) blocks every run
unless the **registry** reports the source `AVAILABLE`. `SU-GRANTS-001` is
`UNKNOWN`, so a live run against the static registry is BLOCKED for every
company.

Per the user's explicit choice, the live surface builds a **run-scoped registry
view** in which ONLY `SU-GRANTS-001` is presented as `AVAILABLE`
(`grantsGovLiveRegistry()` in `src/live-source/live-grantsgov-discovery.ts`),
because the in-app, same-origin, fixed-endpoint, no-auth bridge IS the read-only
access path. This mirror of the USAspending live store:

- does **not** mutate `DEFAULT_SOURCE_REGISTRY` — the static `SU-GRANTS-001`
  entry remains `accessState: 'UNKNOWN'` (asserted in test);
- does **not** leak into any other run, adapter, or registry consumer;
- keeps the "one live source, one fixed endpoint, no credentials" posture.

Global promotion of `SU-GRANTS-001` to `AVAILABLE` still requires an observed
verified live query and was NOT performed. This is the key risk to review.

## Files changed

- **new** `src/live-source/live-grantsgov-discovery.ts` — live Grants.gov store
  (`createLiveGrantsGovDiscovery`, `liveGrantsGovDiscoveryStore`,
  `grantsGovLiveRegistry`, `defaultGrantsGovBridgeClient`); mirrors the
  USAspending live store (`beginRun`/`runCompany`/`finishRun`/`history`/`reset`).
  Consts: run-id prefix `RUN-G`, profile `DP-LIVE-003`, default limit 10,
  default statuses `posted|forecasted`.
- **new** `src/live-source/live-grantsgov-discovery.test.ts` — 4 offline store
  tests (registry override, end-to-end + `sourceStatus` preservation, keyword
  filtering, bridge failure).
- **edited** `src/automation/candidate.ts` — added
  `sourceStatus: { original; normalized }` to `NormalizationMetadata` and
  `sourceStatus: string | null` to `DiscoveryCandidate`.
- **edited** `src/automation/transform.ts` — maps `raw.sourceStatus` through to
  the candidate (previously dropped).
- **edited** `src/automation/normalize.ts` — normalizes/carries `sourceStatus`.
- **edited** `src/automation/classify.ts` — added `grant_opportunity: 'Grant'`
  to `FUNDING_RAW_TYPE_ALIASES` so Grants.gov opportunities classify as Grant.
- **edited** `src/automation/review-fixture.ts` — construct `sourceStatus` in the
  fixture normalization/candidate helpers.
- **edited** `src/pages/Discovery.tsx` — the live funding run now uses
  `liveGrantsGovDiscoveryStore`; history merges Grants.gov + USAspending runs.
- **edited** `src/components/discovery/DiscoveryControls.tsx` — funding button
  text now describes Grants.gov grant opportunities and states records are not
  confirmed open/eligible.
- **edited** `src/components/discovery/DiscoveryResults.tsx` — the live funding
  banner and note are now **source-driven** (Grants.gov opportunity text vs
  USAspending award text vs generic), never a hardcoded source.
- **rewritten** `qa/funding-live.spec.ts` — offline Playwright coverage of the
  new Grants.gov funding path (was USAspending).

## What was implemented / honesty rules

- **Real pipeline, no reimplementation:** each selected company is one read-only
  live search; the source body is replayed through the real adapter,
  orchestrator, normalization, classification, dedup, provenance, and review
  handoff.
- **Status preserved, no verdict:** `oppStatus` (`posted|forecasted|closed|
  archived|unknown`) is carried as evidence on `candidate.sourceStatus` /
  `normalization.sourceStatus`. No adapter or UI computes "is currently open" and
  no TVB-company eligibility is implied; the banner explicitly says a record is
  not confirmed open or eligible until the open-opportunity gate is implemented.
- **Truthful provenance:** the funding banner and explanatory note derive from
  the actual `sourceId`/`sourceName` in the run result; a USAspending-labelled
  banner can no longer appear for a Grants.gov run.
- **Failures stay failures:** a bridge/source failure is a real FAILED result; a
  genuine empty response is `Completed (no results)`. Neither is dressed up.

## Hard boundaries honored

- No Vault, `src/data/generated/opportunity-data.json`, or fixture data changed.
- No delete/stage/commit/push/reset/clean; no new dependencies.
- `SU-GRANTS-001` was NOT globally promoted to `AVAILABLE`.
- Server security controls and the shared bridge boundary were not weakened.
- No unrelated features or refactors.

## Verification (exact commands and results)

| Command | Result |
|---|---|
| `npm run typecheck` (`tsc -b`) | clean, no errors |
| `npm run build` | succeeded (2.08s) |
| `npm run test:automation` | **319 passed / 0 failed** |
| `npm run test:live` | **77 passed / 0 failed** (was 73; +4 new store tests) |
| `npx playwright test qa/funding-live.spec.ts` | **4 passed / 0 failed** |
| `npx playwright test qa/discovery.spec.ts qa/ted-live.spec.ts qa/funding-live.spec.ts` | **40 passed / 0 failed** |

Snapshot integrity: `src/data/generated/opportunity-data.json` md5 still
`17cfae825e1de5320705b066effec15b`.

All tests are offline: every test injects a local transport/bridge stub or
intercepts the same-origin bridge with `page.route`; no test makes a network call
or writes to the vault.

New Playwright coverage (`qa/funding-live.spec.ts`): button presence and
separation; a 3-company run intercepting `/__tvb/grantsgov/search` shows
Grants.gov provenance (`SU-GRANTS-001`, "Grants.gov", "Real source"), a
source-driven opportunity banner with the "not confirmed open or eligible" note,
one bridge call per company carrying `RUN-G-0001` / keyword / `posted|forecasted`,
no USAspending fallback, and no console/page/network errors; an empty response is
`Completed (no results)`; a `502 source_failure` is a FAILED run with no review
handoff.

## Unfinished work / next phases (not started)

- **Full `npm run test:qa` suite was NOT re-run** this phase (timebox); focused
  suites above were run instead. Re-run `test:qa` before release.
- Promote static `SU-GRANTS-001` to `AVAILABLE` globally only after a verified
  live read-only query, recording the verification date as a fact.
- Explicit open-opportunity gate (future-close-date validation, timezone
  handling, confirmed-vs-inferred eligibility) — the "not confirmed open"
  caveat stays until then.
- Confirm the official endpoint's rate-limit / fair-use terms before any live
  Grants.gov call.

## Blockers

None outstanding. The run-scoped access override is the key decision to review;
it is scoped to a single live run and never mutates the global registry.
