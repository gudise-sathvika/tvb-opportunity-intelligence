# Phase 20D Report — One Shared Grants.gov Search per Run

Status: **Complete.** The live Grants.gov funding run now issues ONE search per
run (the query is identical for every selected company) and shows the same
source pool under each selected company, explicitly labelled as a **shared,
NOT-company-matched** pool. Full `test:qa` green.

## Objective

Phase 20C ran one identical broad (or keyword) Grants.gov query **per selected
company**, so N companies produced N duplicate network calls returning the exact
same opportunity set. Phase 20D removes that duplication: the query is a run-wide
concern, so it runs once and its pool is shared across the selected companies.

## Design constraint (surfaced before implementing)

The Discovery companies are **name-only** (`src/data/company-directory-names.ts`)
and the generated data carries **zero company records** (`records.companies`
length 0). The existing deterministic `MATCH-RULES-v1` engine
(`src/automation/match-proposal.ts`) needs company `industries`/`country`/
`description`/`capabilities`, which do not exist for the real directory
companies (the `COMP-001…003` records are fictional demo fixtures). Matching
with that engine would require inventing company facts — against the honesty
boundary.

**User-approved decision:** run the search once and show the same gated pool
under every selected company, explicitly labelled as the shared broad pool and
**not company-matched**. No company fact is inferred and broad results are never
restricted by a company name.

## What changed

- **One search per run** (`src/live-source/live-grantsgov-discovery.ts`):
  `runCompany` now awaits a per-run memoized promise (`runResponses`, keyed by
  `context.runId`) instead of calling the bridge itself. The first company issues
  the single `POST`; every later company in the same run replays the same
  response through the REAL adapter + pipeline (so each candidate still carries
  its own `companyId`/provenance). The memo entry is released in `finishRun` and
  `reset`. A transport throw still becomes a REAL failure response.
- **Run-level request marker**: the shared request sends
  `companyId: GRANTS_GOV_LIVE_POOL_COMPANY_ID` (`'RUN'`) — a run-level marker,
  never a company's id — because the query belongs to the run, not a company.
- **UI labelling** (`src/components/discovery/DiscoveryResults.tsx`): new
  `grantsGovNote(outcome)` states plainly that broadcast/keyword mode issues ONE
  search for the whole run and shows the same pool for every selected company,
  not company-matched, while keeping the gate/`Open (confirmed)` explanation.
- **Tests**: added a store unit test asserting a single bridge call across three
  companies with per-company provenance preserved; updated
  `qa/funding-live.spec.ts` to expect one call for the run (keyword mode, three
  companies) and to assert the shared-pool note.

### Files changed

- `src/live-source/live-grantsgov-discovery.ts` — per-run response memo,
  `sharedResponseFor`, `GRANTS_GOV_LIVE_POOL_COMPANY_ID`, doc update.
- `src/components/discovery/DiscoveryResults.tsx` — `grantsGovNote`.
- `src/live-source/live-grantsgov-discovery.test.ts` — new shared-pool test.
- `qa/funding-live.spec.ts` — one-call-per-run assertions + shared-pool note.

## Hard boundaries honored

- No company fact inferred; the pool is never attributed to a real company.
- A blank keyword is still a broad posted search, never a company-name
  substitution; broad results are not restricted by any company name.
- Bridge/source failures remain REAL failures, never invented empty successes.
- Production Vault and `src/data/generated/opportunity-data.json` unchanged
  (md5 still `17cfae825e1de5320705b066effec15b`; fixture still
  `06713f2dcc9a680301eea64e3013e32e`).
- No stage/commit/push/clean; no new dependencies.

## Verification

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run build` | succeeded |
| `npm run test:automation` | **325 passed / 0 failed** |
| `npm run test:live` | **80 passed / 0 failed** (was 79; +1 shared-pool test) |
| `npx playwright test qa/{discovery,ted-live,funding-live}.spec.ts` | **40 passed / 0 failed** |
| `npm run test:qa` (full suite) | **366 passed / 3 skipped / 0 failed** (4.8m) |

The offline Playwright test proves the browser issues exactly **one**
`/__tvb/grantsgov/search` request for a 3-company keyword run and renders the
shared, not-company-matched note; the store unit test proves the same for a
3-company broad run with per-company provenance intact.

## Unfinished / next

- The review queue still receives one candidate set per company run (unchanged
  from before). Deduplicating the shared pool across companies in the queue is a
  candidate future phase.
- True company-matching remains deferred until real company metadata
  (industries/country/description/capabilities) exists; only then can
  `MATCH-RULES-v1` run against real companies without inventing facts.
